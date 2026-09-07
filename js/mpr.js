/**
 * js/mpr.js
 * Simulador Educacional de TC — Tela de MPR (Reconstrucao Multiplanar).
 *
 * Gerencia o iframe do leitor DICOM (dicom-viewer/index.html), a ponte
 * postMessage para transferir o volume reconstruido e o status do leitor.
 * Inicializa SimTC.mprApi apos o volume ficar disponivel.
 *
 * Depende de: js/shared.js (SimTC), js/aquisicao.js (SimTC.mprApi)
 * Script classico — sem ES modules, sem bundler.
 */
(function () {
  "use strict";

  function initMprTab() {
    var pane = document.getElementById("pane-mpr");
    var frame = document.getElementById("mpr-workstation");
    var status = document.getElementById("mpr-status");
    if (!pane || !frame || !status) return;
    var ready = false;

    function setStatus(text, kind) {
      status.textContent = text;
      status.classList.toggle("is-ready", kind === "ready");
      status.classList.toggle("is-warning", kind === "warning");
    }

    function sendVolume() {
      if (!ready || !frame.contentWindow) return;
      if (!(SimTC.mprApi && SimTC.mprApi.hasVolume && SimTC.mprApi.hasVolume())) {
        setStatus("Adquira um exame ou abra uma série DICOM no leitor", "warning");
        return;
      }
      try {
        setStatus("Transferindo exame reconstruído…", "warning");
        var payload = SimTC.mprApi.exportVolume();
        frame.contentWindow.postMessage(
          { type: "ct-simulator:volume", payload: payload },
          location.origin,
          [payload.buffer]
        );
      } catch (error) {
        setStatus("Falha ao enviar o volume: " + (error.message || error), "warning");
      }
    }

    // Handshake idempotente. O "ready" do leitor podia ser emitido ANTES
    // deste listener existir (iframe já carregado, ou carga muito rápida) —
    // postMessage não tem buffer, e a mensagem se perdia para sempre: o
    // status ficava preso em "Aguardando o leitor…". Agora o pai também
    // chama: envia "hello" periodicamente até o leitor responder.
    var helloTimer = null, helloTentativas = 0;
    function pararHello() {
      if (helloTimer) { clearInterval(helloTimer); helloTimer = null; }
    }
    function chamarLeitor() {
      pararHello();
      helloTentativas = 0;
      helloTimer = setInterval(function () {
        if (ready || helloTentativas >= 20) { pararHello(); return; }
        helloTentativas++;
        try {
          if (frame.contentWindow) {
            frame.contentWindow.postMessage({ type: "ct-simulator:hello" }, location.origin);
          }
        } catch (e) { /* iframe ainda não navegável */ }
      }, 250);
    }

    frame.addEventListener("load", function () {
      ready = false;
      setStatus("Inicializando o ambiente de processamento…", "warning");
      chamarLeitor();
    });
    // O iframe pode já ter carregado antes deste módulo inicializar.
    chamarLeitor();

    window.addEventListener("message", function (event) {
      if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
      var data = event.data || {};
      if (data.type === "ct-dicom-viewer:ready") {
        pararHello();
        if (ready) return; // reenvio do leitor — nada a fazer, e NÃO reacusar
                           // (acusar a cada "ready" gera ping-pong infinito)
        ready = true;
        // Acusa uma única vez: sem isto o leitor seguiria reanunciando por
        // alguns segundos, já que ele só se cala ao ouvir o pai.
        try {
          if (frame.contentWindow) {
            frame.contentWindow.postMessage({ type: "ct-simulator:hello" }, location.origin);
          }
        } catch (e) { /* ignora */ }
        setStatus("Leitor pronto — aguardando exame", "ready");
        sendVolume();
      } else if (data.type === "ct-dicom-viewer:volume-applied") {
        var dims = data.dims && data.dims.join ? data.dims.join(" × ") : "volume";
        setStatus("Exame disponível para processamento — " + dims, "ready");
      } else if (data.type === "ct-dicom-viewer:error") {
        setStatus("Leitor: " + (data.message || "não foi possível abrir o volume"), "warning");
      }
    });

    SimTC.aoMudarFase(function (fase) {
      if (fase === "review") sendVolume();
      if (fase === "idle" && !(SimTC.mprApi && SimTC.mprApi.hasVolume && SimTC.mprApi.hasVolume())) {
        setStatus("Adquira um exame ou abra uma série DICOM no leitor", "warning");
      }
    });
  }

  window.SimTC = window.SimTC || {};
  SimTC.MPR = { init: initMprTab };

})();