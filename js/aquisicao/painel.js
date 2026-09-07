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
      var html = "";
      STEPS.forEach(function (s, i) {
        var st = stepState(s, phase);
        var label = st === "active" ? "em curso" : (st === "done" ? "concluído" : "aguardando");
        html += '<li class="acq-step is-' + st + '">' +
          '<span class="acq-step__num">' + (st === "done" ? "✓" : (i + 1)) + '</span>' +
          '<span class="acq-step__body"><span class="acq-step__name">' + s.name + '</span>' +
          '<span class="acq-step__sub">' + stepSub(s) + '</span></span>' +
          '<span class="acq-step__state">' + label + '</span></li>';
      });
      seqEl.innerHTML = html;
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
        paramsEl.innerHTML = '<p class="acq-params__empty">Nenhum protocolo selecionado.</p>';
        return;
      }
      // O painel lê o modelo TIPADO e formata na hora, com unidade. Antes lia
      // os campos planos em texto e repetia o que estivesse gravado — inclusive
      // "≈55 mGy (ref.)" no lugar de um CTDIvol, e um pitch ao lado de
      // "sequencial". A dose saiu daqui: ela é calculada e aparece na
      // confirmação, com a faixa do exame, que é o que ela depende.
      var n = window.SimTCCore.model.normalizarProtocolo(p);
      var aq = n.aquisicao, r = n.reconstrucoes[0] || {};
      var un = function (v, u) { return v == null ? null : String(v).replace(".", ",") + (u || ""); };
      var rows = [
        ["kV", un(aq.kv)], ["mAs", un(aq.mas)],
        ["Pitch", aq.modo === "sequencial" ? "não se aplica" : un(aq.pitch)],
        ["FOV", un(r.fovMm, " mm")],
        ["Colimação", aq.colimacao ? (aq.colimacao.nDetectores + " × " +
          String(aq.colimacao.larguraMm).replace(".", ",") + " mm") : null],
        ["Esp. corte", un(r.espessuraMm, " mm")],
        ["Kernel", r.kernel], ["Rotação", un(aq.tempoRotacaoS, " s")],
        ["Modo", modoTxt(aq.modo)], ["Tilt", un(aq.tiltGantryDeg, "°")]
      ];
      rows.forEach(function (linha) {
        html += '<div class="acq-param"><span class="acq-param__k">' + linha[0] + '</span>' +
          '<span class="acq-param__v">' + (linha[1] ? esc(linha[1]) : "—") + '</span></div>';
      });
      html += '<div class="acq-param acq-param--full"><span class="acq-param__k">Direção</span>' +
        '<span class="acq-param__v">' + dirTxt(aq.direcao) + '</span></div>';
      paramsEl.innerHTML = html;
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
