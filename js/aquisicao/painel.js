/**
 * js/aquisicao/painel.js
 * Painel de etapas e de parametros da tela de aquisicao.
 *
 * Sai de js/aquisicao.js na ETAPA 6. Ja era uma funcao separada dentro do
 * mesmo IIFE — so nao tinha arquivo. Nao guarda estado do exame: escuta a fase
 * no barramento do nucleo (SimTC.aoMudarFase) e le o protocolo TIPADO para
 * formatar o painel de parametros.
 *
 * Script classico. Carrega antes de js/aquisicao.js.
 */
(function () {
  "use strict";

  var esc = function (v) { return (window.SimTC && SimTC.esc) ? SimTC.esc(v) : String(v == null ? "" : v); };

  function initAcqQuadrants() {
    var seqEl = document.getElementById("acq-seq");
    var paramsEl = document.getElementById("acq-params");

    // Passos do fluxo atual e a fase em que cada um fica ativo.
    var STEPS = [
      { name: "Topograma", sub: "scout", active: ["topoAcq"] },
      { name: "Planejamento da faixa", sub: "linhas FOV / CC", active: ["plan", "moving"] },
      { name: "Volume — aquisição", sub: "helicoidal", active: ["volAcq"] },
      { name: "Revisão / Relatório", sub: "cortes + dose", active: ["review"] }
    ];
    var ORDER = ["idle", "topoAcq", "plan", "moving", "volAcq", "review"];

    function stepState(step, phase) {
      if (step.active.indexOf(phase) >= 0) return "active";
      // "concluído" se a fase atual está adiante da última fase ativa do passo.
      var pi = ORDER.indexOf(phase);
      var maxActive = Math.max.apply(null, step.active.map(function (a) { return ORDER.indexOf(a); }));
      return pi > maxActive ? "done" : "pending";
    }

    // Subtítulo do passo de volume reflete o modo do protocolo em exame
    // (axial sequencial × helicoidal), em vez de um rótulo fixo.
    function stepSub(s) {
      if (s.name === "Topograma") {
        var pt = (SimTC.examProtocol && SimTC.examProtocol.data) || null;
        return "scout " + ((pt && pt.scout === "frontal") ? "frontal/AP" : "lateral");
      }
      if (s.name.indexOf("Volume") === 0) {
        var p = (SimTC.examProtocol && SimTC.examProtocol.data) || null;
        return (p && p.modo === "sequencial") ? "axial sequencial" : "helicoidal";
      }
      return s.sub;
    }
    function renderSeq(phase) {
      if (!seqEl) return;
      phase = ORDER.indexOf(phase) >= 0 ? phase : "idle";
      
      var items = STEPS.map(function (s, i) {
        var st = stepState(s, phase);
        var label = st === "active" ? "em curso" : (st === "done" ? "concluído" : "aguardando");
        return SimTC.ui.lista.passoDeAquisicao(
          st === "done" ? "✓" : (i + 1),
          s.name,
          stepSub(s),
          st,
          label
        );
      });
      
      seqEl.replaceChildren.apply(seqEl, items);
    }

    function dirTxt(d) {
      return d === "craniocaudal" ? "Crânio-caudal (mesa entra)" : "Caudo-cranial (mesa sai)";
    }
    function modoTxt(m) {
      return m === "sequencial" ? "Axial sequencial" : "Helicoidal";
    }
    function renderParams() {
      if (!paramsEl) return;
      var p = (SimTC.examProtocol && SimTC.examProtocol.data) || null;
      var html = "";
      if (!p) {
        paramsEl.replaceChildren(SimTC.ui.campo.vazio("Nenhum protocolo selecionado."));
        return;
      }
      
      var n = window.SimTCCore.model.normalizarProtocolo(p);
      var aq = n.aquisicao, r = n.reconstrucoes[0] || {};
      var F = SimTC.fmt;
      
      var campos = [
        SimTC.ui.campo.par("kV", F.n(aq.kv)),
        SimTC.ui.campo.par("mAs", F.n(aq.mas)),
        SimTC.ui.campo.par("Pitch", aq.modo === "sequencial" ? "não se aplica" : F.n(aq.pitch)),
        SimTC.ui.campo.par("FOV", F.mm(r.fovMm, 0)),
        SimTC.ui.campo.par("Colimação", aq.colimacao ? (aq.colimacao.nDetectores + " × " + F.mm(aq.colimacao.larguraMm)) : null),
        SimTC.ui.campo.par("Esp. corte", F.mm(r.espessuraMm)),
        SimTC.ui.campo.par("Kernel", r.kernel),
        SimTC.ui.campo.par("Rotação", F.s(aq.tempoRotacaoS)),
        SimTC.ui.campo.par("Modo", modoTxt(aq.modo)),
        SimTC.ui.campo.par("Tilt", F.graus(aq.tiltGantryDeg)),
        SimTC.ui.campo.par("Direção", dirTxt(aq.direcao), "acq-param", true)
      ];
      
      paramsEl.replaceChildren.apply(paramsEl, campos);
    }

    var curPhase = "idle";
    SimTC.aoMudarFase(function (p) {
      curPhase = p;
      renderSeq(p);
      renderParams();
    });
    // O protocolo em exame pode mudar sem evento — atualização leve periódica.
    setInterval(renderParams, 1200);
    renderSeq("idle");
    renderParams();
  }

  window.SimTC = window.SimTC || {};
  SimTC.PainelAquisicao = { init: initAcqQuadrants };

})();
