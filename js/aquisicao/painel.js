/**
 * js/aquisicao/painel.js
 * Painel de etapas da tela de aquisição.
 *
 * Sai de js/aquisicao.js na ETAPA 6. Ja era uma funcao separada dentro do
 * mesmo IIFE — so nao tinha arquivo. Nao guarda estado do exame: escuta a fase
 * no barramento do núcleo (SimTC.aoMudarFase).
 *
 * Script classico. Carrega antes de js/aquisicao.js.
 */
(function () {
  "use strict";

  function initAcqQuadrants() {
    var seqEl = document.getElementById("acq-seq");

    // Apenas as duas aquisições ficam visíveis neste quadrante. Planejamento,
    // movimento e revisão continuam no fluxo do exame, sem criar itens extras.
    var STEPS = [
      { name: "Topograma", sub: "scout", active: ["topoAcq"] },
      { name: "Volume", sub: "helicoidal", active: ["volAcq"] }
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

    SimTC.aoMudarFase(function (p) {
      renderSeq(p);
    });
    renderSeq("idle");
  }

  window.SimTC = window.SimTC || {};
  SimTC.PainelAquisicao = { init: initAcqQuadrants };

})();
