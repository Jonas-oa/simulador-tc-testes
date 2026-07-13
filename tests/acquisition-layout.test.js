"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function idExists(id) {
  return new RegExp("\\bid=[\\\"']" + id + "[\\\"']").test(html);
}

test("a aquisição possui exatamente os quatro quadrantes aprovados", function () {
  var quadrants = html.match(/<section class="acq-quadrant\b/g) || [];
  assert.equal(quadrants.length, 4);
  ["Topograma", "Aquisição", "Sequências do exame", "Técnica do protocolo"].forEach(function (title) {
    assert.ok(html.includes(">" + title + "</h3>"), "quadrante ausente: " + title);
  });
});

test("preserva os controles e visualizadores críticos", function () {
  [
    "ws-slice-viewer", "ws-topo", "ws-topo-box", "ws-slice-img",
    "ws-slice-slider", "ws-exam-start", "ws-exam-stop", "ws-exam-move",
    "ws-exam-report", "ws-report", "ws-patient-list"
  ].forEach(function (id) { assert.ok(idExists(id), "ID ausente: " + id); });
});

test("mantém a sequência mínima do exame", function () {
  ["topogram", "volume", "review"].forEach(function (stage) {
    assert.ok(html.includes('data-acq-stage="' + stage + '"'), "etapa ausente: " + stage);
  });
});

test("exibe os seis campos essenciais da técnica", function () {
  [
    "acq-tech-kv", "acq-tech-mas", "acq-tech-pitch",
    "acq-tech-colim", "acq-tech-thick", "acq-tech-direction"
  ].forEach(function (id) { assert.ok(idExists(id), "campo técnico ausente: " + id); });
});
