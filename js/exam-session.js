(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CTExamSession = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var KNOWN_PHASES = ["idle", "topoAcq", "plan", "moving", "volAcq", "review"];
  var LOCKED_PHASES = ["topoAcq", "plan", "moving", "volAcq", "review"];

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function defaultId(now) {
    return "exam_" + now + "_" + Math.random().toString(36).slice(2, 8);
  }

  function create(options) {
    options = options || {};
    var now = typeof options.now === "function" ? options.now : Date.now;
    var makeId = typeof options.makeId === "function" ? options.makeId : defaultId;
    var persist = typeof options.persist === "function" ? options.persist : function () { return Promise.resolve(); };
    var supportedRegions = options.supportedRegions || ["Crânio"];
    var supportedProtocolIds = options.supportedProtocolIds || null;
    var listeners = [];
    var state = null;

    function fresh() {
      var stamp = now();
      return {
        id: makeId(stamp),
        status: "preparacao",
        phase: "idle",
        patient: null,
        protocol: null,
        positioning: { onTable: false, decubito: null, entrada: null, isoOffsetCm: null },
        createdAt: new Date(stamp).toISOString(),
        updatedAt: new Date(stamp).toISOString(),
        closedAt: null,
        outcome: null,
        details: null
      };
    }

    function ensure() {
      if (!state) state = fresh();
      return state;
    }

    function emit(reason) {
      var snapshot = getState();
      listeners.slice().forEach(function (listener) {
        try { listener(snapshot, reason); } catch (error) { /* listener isolado */ }
      });
    }

    function touch(reason) {
      state.updatedAt = new Date(now()).toISOString();
      emit(reason);
    }

    function isLocked() {
      return !!(state && LOCKED_PHASES.indexOf(state.phase) >= 0);
    }

    function editableResult() {
      if (!isLocked()) return null;
      return { ok: false, code: "exam_locked", message: "O exame em andamento está bloqueado para alterações." };
    }

    function setPatient(patient) {
      var blocked = editableResult();
      if (blocked) return blocked;
      var s = ensure();
      s.patient = patient ? clone(patient) : null;
      touch("patient");
      return { ok: true, state: getState() };
    }

    function setProtocol(protocol) {
      var blocked = editableResult();
      if (blocked) return blocked;
      var s = ensure();
      s.protocol = protocol ? clone(protocol) : null;
      touch("protocol");
      return { ok: true, state: getState() };
    }

    function setPosition(positioning) {
      if (!state) return { ok: false, code: "no_session", message: "Selecione um paciente antes de posicioná-lo." };
      var blocked = editableResult();
      if (blocked) return blocked;
      positioning = positioning || {};
      state.positioning = {
        onTable: !!positioning.onTable,
        decubito: positioning.decubito || null,
        entrada: positioning.entrada || null,
        isoOffsetCm: typeof positioning.isoOffsetCm === "number" ? positioning.isoOffsetCm : null
      };
      touch("positioning");
      return { ok: true, state: getState() };
    }

    function setPhase(phase) {
      if (KNOWN_PHASES.indexOf(phase) < 0) {
        return { ok: false, code: "unknown_phase", message: "Fase de exame desconhecida: " + phase };
      }
      if (!state && phase === "idle") return { ok: true, state: null };
      var s = ensure();
      s.phase = phase;
      s.status = phase === "review" ? "revisao" : (phase === "idle" ? "preparacao" : "em_andamento");
      touch("phase");
      return { ok: true, state: getState() };
    }

    function technicalErrors(protocol) {
      var required = [
        ["kv", "kV"],
        ["mas", "mAs"],
        ["pitch", "pitch"],
        ["colimacao", "colimação"]
      ];
      var missing = required.filter(function (field) {
        return !String(protocol[field[0]] == null ? "" : protocol[field[0]]).trim();
      }).map(function (field) { return field[1]; });
      if (!missing.length) return [];
      return [{
        code: "protocol_incomplete",
        message: "Complete a técnica do protocolo: " + missing.join(", ") + "."
      }];
    }

    function numericTechnicalErrors(protocol) {
      function numberFrom(value) {
        var match = String(value == null ? "" : value).replace(/,/g, ".").match(/[-+]?\d+(\.\d+)?/);
        return match ? parseFloat(match[0]) : NaN;
      }
      var invalid = [];
      if (!(numberFrom(protocol.kv) > 0)) invalid.push("kV");
      if (!(numberFrom(protocol.mas) > 0)) invalid.push("mAs");
      if (!(numberFrom(protocol.pitch) > 0)) invalid.push("pitch");
      if (!(numberFrom(protocol.colimacao) > 0)) invalid.push("colimação");
      if (!invalid.length) return [];
      return [{ code: "protocol_invalid", message: "Revise os valores numéricos da técnica: " + invalid.join(", ") + "." }];
    }

    function validateForAcquisition(positioning) {
      var errors = [];
      var patient = state && state.patient;
      var protocol = state && state.protocol;
      var position = positioning || (state && state.positioning) || {};

      if (!patient) errors.push({ code: "patient_required", message: "Selecione um paciente antes de iniciar o exame." });
      if (!protocol) errors.push({ code: "protocol_required", message: "Selecione um protocolo antes de iniciar o exame." });
      if (patient && protocol && patient.regiao && protocol.regiao && patient.regiao !== protocol.regiao) {
        errors.push({
          code: "region_mismatch",
          message: "A região do paciente (" + patient.regiao + ") não corresponde ao protocolo (" + protocol.regiao + ")."
        });
      }
      if (protocol && supportedRegions.indexOf(protocol.regiao) < 0) {
        errors.push({
          code: "unsupported_region",
          message: "A aquisição de " + protocol.regiao + " ainda não possui volume de imagens neste simulador."
        });
      }
      if (protocol && supportedProtocolIds && supportedProtocolIds.indexOf(protocol.id) < 0) {
        errors.push({
          code: "unsupported_protocol",
          message: "O protocolo " + protocol.nome + " ainda não possui uma série de imagens correspondente neste simulador."
        });
      }
      if (protocol) {
        var missingTechnique = technicalErrors(protocol);
        errors = errors.concat(missingTechnique);
        if (!missingTechnique.length) errors = errors.concat(numericTechnicalErrors(protocol));
      }
      if (!position.onTable) errors.push({ code: "position_required", message: "Posicione o paciente na mesa antes de iniciar a aquisição." });

      return { ok: errors.length === 0, errors: errors, state: getState() };
    }

    function close(outcome, details, closeOptions) {
      if (!state) return Promise.resolve(null);
      closeOptions = closeOptions || {};
      var patient = clone(state.patient);
      var protocol = clone(state.protocol);
      var positioning = clone(state.positioning);
      state.status = "encerrado";
      state.closedAt = new Date(now()).toISOString();
      state.updatedAt = state.closedAt;
      state.outcome = outcome || "finalizado";
      state.details = details ? clone(details) : null;
      var archived = clone(state);
      function prepareNext() {
        state = null;
        emit("closed");
        if (closeOptions.retainPatient && patient) setPatient(patient);
        if (closeOptions.retainProtocol && protocol) setProtocol(protocol);
        if (closeOptions.retainPosition && positioning) setPosition(positioning);
      }
      return Promise.resolve(persist(archived)).then(function () {
        prepareNext();
        return archived;
      }, function (error) {
        prepareNext();
        throw error;
      });
    }

    function getState() { return clone(state); }
    function getPatient() { return clone(state && state.patient); }
    function getProtocol() { return clone(state && state.protocol); }

    function subscribe(listener) {
      if (typeof listener !== "function") return function () {};
      listeners.push(listener);
      return function () { listeners = listeners.filter(function (item) { return item !== listener; }); };
    }

    return {
      getState: getState,
      getPatient: getPatient,
      getProtocol: getProtocol,
      get: getPatient,
      setPatient: setPatient,
      setProtocol: setProtocol,
      setPosition: setPosition,
      setPhase: setPhase,
      validateForAcquisition: validateForAcquisition,
      isLocked: isLocked,
      close: close,
      end: function (details) { return close("finalizado", details, { retainPatient: true, retainProtocol: true, retainPosition: true }); },
      subscribe: subscribe
    };
  }

  return { create: create };
});
