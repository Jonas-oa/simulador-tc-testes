"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var CTExamSession = require("../js/exam-session.js");

function makeController(overrides) {
  var tick = 0;
  var archived = [];
  var controller = CTExamSession.create(Object.assign({
    now: function () { return Date.UTC(2026, 6, 13, 12, 0, tick++); },
    makeId: function (stamp) { return "exam_" + stamp; },
    persist: function (exam) { archived.push(exam); return Promise.resolve(); }
  }, overrides || {}));
  return { controller: controller, archived: archived };
}

var patient = { id: "pac_1", nome: "Paciente Teste", regiao: "Crânio" };
var protocol = {
  id: "cranio", nome: "Crânio", regiao: "Crânio",
  kv: "120", mas: "300", pitch: "1,2", colimacao: "64 × 0,6 mm"
};

test("cria uma sessão única com snapshots independentes", function () {
  var api = makeController().controller;
  var sourcePatient = Object.assign({}, patient);
  var sourceProtocol = Object.assign({}, protocol);
  api.setPatient(sourcePatient);
  api.setProtocol(sourceProtocol);
  sourcePatient.nome = "Nome alterado fora da sessão";
  sourceProtocol.kv = "999";

  assert.equal(api.getPatient().nome, "Paciente Teste");
  assert.equal(api.getProtocol().kv, "120");
  assert.equal(api.getState().status, "preparacao");
});

test("bloqueia aquisição sem os pré-requisitos", function () {
  var api = makeController().controller;
  var result = api.validateForAcquisition({ onTable: false });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map(function (e) { return e.code; }), [
    "patient_required", "protocol_required", "position_required"
  ]);
});

test("bloqueia região incompatível e protocolo sem técnica", function () {
  var api = makeController().controller;
  api.setPatient({ id: "pac_2", nome: "Teste", regiao: "Tórax" });
  api.setProtocol({ id: "face", nome: "Face", regiao: "Crânio" });
  var result = api.validateForAcquisition({ onTable: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(function (e) { return e.code === "region_mismatch"; }));
  assert.ok(result.errors.some(function (e) { return e.code === "protocol_incomplete"; }));
});

test("bloqueia protocolo sem série de imagens correspondente", function () {
  var api = makeController({ supportedProtocolIds: ["cranio"] }).controller;
  api.setPatient(patient);
  api.setProtocol(Object.assign({}, protocol, { id: "face", nome: "Face" }));
  var result = api.validateForAcquisition({ onTable: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(function (e) { return e.code === "unsupported_protocol"; }));
});

test("bloqueia técnica preenchida com valor não numérico", function () {
  var api = makeController().controller;
  api.setPatient(patient);
  api.setProtocol(Object.assign({}, protocol, { pitch: "não definido" }));
  var result = api.validateForAcquisition({ onTable: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(function (e) { return e.code === "protocol_invalid"; }));
});

test("bloqueia técnica com valor negativo", function () {
  var api = makeController().controller;
  api.setPatient(patient);
  api.setProtocol(Object.assign({}, protocol, { mas: "-10" }));
  var result = api.validateForAcquisition({ onTable: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(function (e) { return e.code === "protocol_invalid"; }));
});

test("libera aquisição craniana completa com paciente na mesa", function () {
  var api = makeController().controller;
  api.setPatient(patient);
  api.setProtocol(protocol);
  api.setPosition({ onTable: true, decubito: "dorsal", entrada: "cabeca", isoOffsetCm: 0.5 });
  assert.equal(api.validateForAcquisition().ok, true);
});

test("bloqueia mudanças de paciente e protocolo durante o exame", function () {
  var api = makeController().controller;
  api.setPatient(patient);
  api.setProtocol(protocol);
  api.setPhase("topoAcq");
  assert.equal(api.setPatient({ id: "pac_9" }).code, "exam_locked");
  assert.equal(api.setProtocol({ id: "outro" }).code, "exam_locked");
  assert.equal(api.getPatient().id, "pac_1");
  assert.equal(api.getProtocol().id, "cranio");
});

test("mantém o bloqueio também durante o planejamento", function () {
  var api = makeController().controller;
  api.setPatient(patient);
  api.setProtocol(protocol);
  api.setPhase("plan");
  assert.equal(api.isLocked(), true);
  assert.equal(api.setProtocol({ id: "outro" }).code, "exam_locked");
});

test("arquiva o exame e prepara nova sessão sem editar o histórico", async function () {
  var fixture = makeController();
  var api = fixture.controller;
  api.setPatient(patient);
  api.setProtocol(protocol);
  api.setPosition({ onTable: true, decubito: "dorsal", entrada: "cabeca" });
  var firstId = api.getState().id;
  api.setPhase("review");
  var closed = await api.close("finalizado", { lastSlice: 75 }, {
    retainPatient: true, retainProtocol: true, retainPosition: true
  });

  assert.equal(fixture.archived.length, 1);
  assert.equal(closed.id, firstId);
  assert.equal(closed.status, "encerrado");
  assert.equal(closed.details.lastSlice, 75);
  assert.notEqual(api.getState().id, firstId);
  assert.equal(api.getState().status, "preparacao");
  assert.equal(api.getPatient().id, "pac_1");
  assert.equal(api.getProtocol().id, "cranio");
});

test("libera uma nova sessão mesmo quando o arquivo persistente falha", async function () {
  var api = makeController({ persist: function () { return Promise.reject(new Error("falha simulada")); } }).controller;
  api.setPatient(patient);
  api.setProtocol(protocol);
  api.setPhase("review");
  await assert.rejects(api.close("finalizado", null, { retainPatient: true, retainProtocol: true }), /falha simulada/);
  assert.equal(api.getState().phase, "idle");
  assert.equal(api.getPatient().id, "pac_1");
  assert.equal(api.isLocked(), false);
});
