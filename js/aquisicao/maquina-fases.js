/**
 * js/aquisicao/maquina-fases.js
 * Gerencia a máquina de estados da aquisição, separando do controle de UI.
 */
(function () {
  "use strict";

  // Estados: idle → topoAcq (varredura) → plan (linhas) → volAcq (mesa+cortes) → review
  var phase = "idle";
  var topoAnim = null;
  var volTimer = null;

  var FASE_NO_NUCLEO = {
    idle: "ocioso", 
    topoAcq: "scout", 
    plan: "planejando",
    volAcq: "adquirindo", 
    recon: "reconstruindo", 
    review: "revisao"
  };

  /** Muda a fase da tela e leva a mudança ao núcleo. */
  function definirFase(nome) {
    phase = nome;
    var C = window.SimTCCore;
    if (C && C.sessao && FASE_NO_NUCLEO[nome]) {
      try { C.sessao.mudarFase(FASE_NO_NUCLEO[nome]); } catch (e) { /* estado desconhecido: ignora */ }
    }
  }

  function getFase() {
    return phase;
  }

  function setTopoAnim(handle) { topoAnim = handle; }
  function getTopoAnim() { return topoAnim; }
  function clearTopoAnim() {
    if (topoAnim) cancelAnimationFrame(topoAnim);
    topoAnim = null;
  }

  function setVolTimer(handle) { volTimer = handle; }
  function getVolTimer() { return volTimer; }
  function clearVolTimer() {
    if (volTimer) clearInterval(volTimer);
    volTimer = null;
  }

  window.SimTC = window.SimTC || {};
  SimTC.MaquinaFases = {
    definirFase: definirFase,
    atual: getFase,
    setTopoAnim: setTopoAnim,
    getTopoAnim: getTopoAnim,
    clearTopoAnim: clearTopoAnim,
    setVolTimer: setVolTimer,
    getVolTimer: getVolTimer,
    clearVolTimer: clearVolTimer
  };

})();
