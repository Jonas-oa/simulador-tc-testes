/**
 * script.js
 * Simulador Educacional de Tomografia Computadorizada — orquestrador.
 *
 * Este arquivo inicializa todos os módulos na ordem correta. A lógica
 * de cada tela foi extraída para arquivos separados em js/:
 *
 *   js/shared.js              — tema, mensagens, IndexedDB, API refs
 *   js/sala-exame.js          — cena 3D, mesa, laser, controles físicos
 *   js/cadastro-pacientes.js  — formulário e lista de pacientes
 *   js/protocolos.js          — mapa corporal, CRUD de protocolos
 *   js/aquisicao.js           — topograma, volume, MPR, relatório
 *   js/mpr.js                 — aba MPR / iframe leitor DICOM
 *   js/ui-layout.js           — console, divisórias, mobile, PiP
 *
 * Script CLÁSSICO (sem "type=module", sem bundler) — mesma decisão
 * arquitetural do projeto original (ES modules falhavam silenciosamente
 * em alguns navegadores/redes de usuários reais).
 */
(function () {
  "use strict";

  // Diagnóstico: captura erros antes do bootstrap e reporta na UI.
  // (Mantido do script original para compatibilidade com a detecção
  //  automática de falha de carga do index.html.)
  function reportError(text) {
    window.__ctSimulatorErrorReported = true;
    var el = document.getElementById("message-text");
    var loading = document.getElementById("viewport-loading");
    if (el) {
      el.textContent = "ERRO DE DIAGNÓSTICO: " + text;
      el.style.color = "#ff6b6b";
    }
    if (loading) {
      var span = loading.querySelector("span:last-child");
      if (span) span.textContent = "Erro: " + text;
    }
  }

  window.addEventListener("error", function (event) {
    var msg = event.message || (event.error && event.error.message) || "erro desconhecido";
    var src = event.filename ? " (" + event.filename + ":" + event.lineno + ")" : "";
    reportError(msg + src);
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason && event.reason.message ? event.reason.message : String(event.reason);
    reportError("promise rejeitada: " + reason);
  });

  // =================================================================
  // BOOTSTRAP PRINCIPAL
  // Inicializa todos os módulos na ordem de dependência correta.
  // =================================================================
  function main() {
    // 1) Infraestrutura compartilhada (já executada ao carregar shared.js,
    //    mas initTheme precisa do DOM pronto)
    if (window.SimTC && SimTC.initTheme) SimTC.initTheme();

    // 2) Sala de Exame (3D + controles físicos + tableDriveApi)
    if (window.SimTC && SimTC.Sala) SimTC.Sala.init();

    // 3) Telas de dados (independentes entre si)
    if (window.SimTC && SimTC.Protocolos) SimTC.Protocolos.init();
    if (window.SimTC && SimTC.Pacientes)  SimTC.Pacientes.init();

    // 4) Tela de Aquisição de Imagens (depende de tableDriveApi da Sala)
    if (window.SimTC && SimTC.Aquisicao) SimTC.Aquisicao.init();

    // 5) Tela de MPR / iframe DICOM (depende de mprApi da Aquisição)
    if (window.SimTC && SimTC.MPR) SimTC.MPR.init();

    // 6) Layout e infraestrutura de UI (depende de consoleUiApi)
    if (window.SimTC && SimTC.Layout) SimTC.Layout.init();

    // Mescla em vez de sobrescrever: a sala já publicou aqui as referências
    // de cena/câmera/renderer para diagnóstico, e atribuir um objeto novo as
    // descartava silenciosamente.
    window.__ctSimulator = window.__ctSimulator || {};
    window.__ctSimulator.version = "core-20260830a";
    window.__ctSimulator.core = window.SimTCCore || null;

    // 7) Confere os contratos entre modulos. Antes, um modulo que falhasse no
    //    meio do init deixava um ponteiro nulo e as guardas defensivas
    //    (`if (SimTC.x)`) escondiam o buraco: sumia uma funcionalidade sem
    //    nenhum sinal. Agora o boot diz o que faltou.
    if (window.SimTC && SimTC.contratos) {
      var r = SimTC.contratos.verificar();
      if (!r.ok) {
        reportError("contratos nao cumpridos: " +
          (r.ausentes.length ? "ausentes " + r.ausentes.join("; ") + ". " : "") +
          (r.incompletos.length ? "incompletos " + r.incompletos.join("; ") + "." : ""));
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }

})();