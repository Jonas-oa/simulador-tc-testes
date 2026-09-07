/**
 * js/aquisicao/som.js
 * Som do equipamento durante a aquisicao — sintetizado, sem arquivo de audio.
 *
 * Sai de js/aquisicao.js na ETAPA 6. Estava dentro da funcao de 1.766 linhas
 * que desenha a tela de aquisicao, sem nenhuma relacao com ela: e WebAudio
 * puro, nao toca no DOM e nao sabe o que e um exame. Aqui, o que ele faz e
 * legivel de uma vez.
 *
 * Sintetizado de proposito: o projeto e um site estatico servido por GitHub
 * Pages, e um arquivo de audio seria mais um asset para versionar, carregar e
 * cachear. Dois osciladores e um filtro fazem o zumbido do tubo.
 *
 * Script classico. Carrega antes de js/aquisicao.js.
 */
(function () {
  "use strict";

  var audio = { ctx: null, master: null, nodes: [] };
  function soundStart(mode, rotTimeS) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio.ctx) audio.ctx = new AC();
      var ctx = audio.ctx;
      if (ctx.state === "suspended") ctx.resume();
      soundStop();
      var t = ctx.currentTime;
      var master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, t);
      master.gain.exponentialRampToValueAtTime(mode === "vol" ? 0.13 : 0.06, t + 0.5);
      master.connect(ctx.destination);
      // zumbido grave (motor da mesa / rotor do gantry)
      var osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = mode === "vol" ? 52 : 36;
      var oscGain = ctx.createGain(); oscGain.gain.value = 0.5;
      osc.connect(oscGain); oscGain.connect(master); osc.start();
      // ruído filtrado (ventilação/atrito)
      var len = ctx.sampleRate * 2;
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      var noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
      var bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.8;
      bp.frequency.value = mode === "vol" ? 420 : 200;
      var nGain = ctx.createGain(); nGain.gain.value = 0.35;
      noise.connect(bp); bp.connect(nGain); nGain.connect(master); noise.start();
      if (mode === "vol" && rotTimeS > 0) {
        // "whoosh" periódico: uma modulação por rotação do gantry
        var lfo = ctx.createOscillator(); lfo.frequency.value = 1 / rotTimeS;
        var lfoGain = ctx.createGain(); lfoGain.gain.value = 0.22;
        lfo.connect(lfoGain); lfoGain.connect(nGain.gain); lfo.start();
        audio.nodes.push(lfo);
      }
      audio.master = master;
      audio.nodes.push(osc, noise);
    } catch (e) { /* áudio indisponível — segue sem som */ }
  }
  function soundStop() {
    try {
      var nodes = audio.nodes, m = audio.master, c = audio.ctx;
      audio.nodes = []; audio.master = null;
      if (m && c) {
        m.gain.cancelScheduledValues(c.currentTime);
        m.gain.setTargetAtTime(0.0001, c.currentTime, 0.08);
      }
      setTimeout(function () {
        nodes.forEach(function (n) { try { n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} });
        if (m) { try { m.disconnect(); } catch (e) {} }
      }, 350);
    } catch (e) { /* nada a fazer */ }
  }

  window.SimTC = window.SimTC || {};
  SimTC.SomDoEquipamento = { iniciar: soundStart, parar: soundStop };

})();
