/**
 * js/shared.js
 * Simulador Educacional de TC — infraestrutura compartilhada.
 *
 * Define window.SimTC com utilitários usados por todos os módulos:
 *   • Tema claro/escuro
 *   • Painel de mensagens + indicadores
 *   • Banco IndexedDB (protocolos e pacientes)
 *   • Ponteiros de API entre módulos (tableDriveApi, examSessionApi, etc.)
 *
 * DEVE ser carregado ANTES de todos os outros módulos.
 * Script clássico — sem ES modules, sem bundler.
 */
(function () {
  "use strict";

  window.SimTC = window.SimTC || {};

  // =================================================================
  // 1) TEMA CLARO/ESCURO
  // =================================================================
  var THEMES = ["dark", "light"];
  var currentTheme = "dark";

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.body.setAttribute("data-theme", theme);
    var metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute("content", theme === "dark" ? "#0a0e14" : "#e9edf2");
    }
  }

  function initTheme() {
    applyTheme(currentTheme);
    var toggleButton = document.getElementById("theme-toggle");
    if (toggleButton) {
      toggleButton.addEventListener("click", function () {
        var idx = THEMES.indexOf(currentTheme);
        currentTheme = THEMES[(idx + 1) % THEMES.length];
        applyTheme(currentTheme);
      });
    }
  }

  // =================================================================
  // 2) PAINEL DE MENSAGENS + INDICADORES DE STATUS
  // =================================================================
  var MESSAGE_ICONS = { info: "ℹ", warning: "⚠", error: "⛔", success: "✔" };

  function showMessage(text, type) {
    type = type || "info";
    var el = document.getElementById("message-text");
    if (!el) return;
    var panel = el.closest(".message-panel");
    var icon = panel ? panel.querySelector(".message-panel__icon") : null;
    el.textContent = text;
    el.style.color = ""; // limpa eventual cor de erro anterior
    if (icon) icon.textContent = MESSAGE_ICONS[type] || MESSAGE_ICONS.info;
    if (panel) panel.setAttribute("data-message-type", type);
  }

  function setIndicator(name, on) {
    var el = document.querySelector('[data-indicator="' + name + '"]');
    if (el) el.setAttribute("data-state", on ? "on" : "off");
  }

  // =================================================================
  // 3) BANCO DO APP (IndexedDB) + REGIOES ANATOMICAS
  // Banco unico "simuladorTC" (v2) com stores "protocolos" e "pacientes".
  // =================================================================
  var REGIOES = ["Cranio", "Pescoco", "Torax", "Abdome", "Pelve", "Coluna", "Membros"];
  // Nomes com acentos para exibicao na UI
  var REGIOES_DISPLAY = ["Crânio", "Pescoço", "Tórax", "Abdome", "Pelve", "Coluna", "Membros"];
  // v3: acrescenta "estudos" — o arquivo dos exames já realizados. Antes o
  // exame não deixava rastro: encerrar apagava o paciente e não havia como
  // rever nem editar o que foi feito.
  var APP_DB_NAME = "simuladorTC", APP_DB_VER = 3;

  function openAppDB() {
    return new Promise(function (resolve, reject) {
      if (!("indexedDB" in window) || !window.indexedDB) { reject(new Error("IndexedDB indisponível")); return; }
      var req = window.indexedDB.open(APP_DB_NAME, APP_DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("protocolos")) db.createObjectStore("protocolos", { keyPath: "id" });
        if (!db.objectStoreNames.contains("pacientes")) db.createObjectStore("pacientes", { keyPath: "id" });
        if (!db.objectStoreNames.contains("estudos")) db.createObjectStore("estudos", { keyPath: "studyUID" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("Falha ao abrir IndexedDB")); };
    });
  }

  function dbStoreAll(store) {
    return openAppDB().then(function (db) {
      return new Promise(function (res, rej) {
        var r = db.transaction(store, "readonly").objectStore(store).getAll();
        r.onsuccess = function () { res(r.result || []); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }

  function dbStorePut(store, o) {
    return openAppDB().then(function (db) {
      return new Promise(function (res, rej) {
        var r = db.transaction(store, "readwrite").objectStore(store).put(o);
        r.onsuccess = function () { res(); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }

  function dbStoreDel(store, id) {
    return openAppDB().then(function (db) {
      return new Promise(function (res, rej) {
        var r = db.transaction(store, "readwrite").objectStore(store).delete(id);
        r.onsuccess = function () { res(); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }

  // =================================================================
  // 4) FASE DO EXAME — um canal só
  //
  // A aquisição anunciava a fase por um CustomEvent no `document`
  // ("ct:phase"), em paralelo ao barramento do núcleo. Eram dois canais de
  // evento para o mesmo fato, e o do DOM não deixava rastro no estado da
  // sessão: quem quisesse saber em que pé estava o exame tinha de escutar a
  // tela, não o domínio.
  //
  // Agora o anúncio é um só: `Core.sessao.mudarFase()` grava no ScanRun e
  // emite FASE_MUDOU no barramento. Este módulo oferece a tradução do
  // vocabulário do domínio para o da tela e a assinatura pronta, para que
  // nenhum consumidor precise conhecer o mapa.
  // =================================================================
  var FASE_DA_TELA = {
    ocioso: "idle",
    scout: "topoAcq",
    planejando: "plan",
    posicionando: "moving",
    adquirindo: "volAcq",
    // A tela mantém "Volume" ativo durante a reconstrução: para o operador é
    // o mesmo passo do console, e o painel de etapas não deve piscar.
    reconstruindo: "volAcq",
    revisao: "review",
    abortado: "idle"
  };

  /**
   * Assina a mudança de fase do exame, já no vocabulário da tela.
   * @param {function(string):void} fn recebe "idle"|"topoAcq"|"plan"|"moving"|"volAcq"|"review"
   */
  function aoMudarFase(fn) {
    var Core = window.SimTCCore;
    if (!Core || !Core.bus || !Core.EVENTOS) return;
    Core.bus.on(Core.EVENTOS.FASE_MUDOU, function (d) {
      var daTela = FASE_DA_TELA[d && d.estado];
      if (daTela) fn(daTela);
    });
  }

  // =================================================================
  // 5) PONTEIROS DE API COMPARTILHADOS ENTRE MODULOS
  // Cada módulo preenche o ponteiro que lhe cabe; outros o consomem.
  // =================================================================
  // Ponte entre cadastro e aquisição: UM exame por vez, sem memória.
  SimTC.examSessionApi = null;
  // Protocolo selecionado para o exame (nome exibido na tela de aquisição).
  SimTC.examProtocol = { name: "", data: null, refresh: null };
  // Preenchida pela sala 3D: aquisição dirigida pela mesa.
  SimTC.tableDriveApi = null;
  // Preenchida pelo console guiado: modo/etapa atuais.
  SimTC.consoleUiApi = null;
  // Preenchida pelo viewer: reformatações do volume para a aba MPR.
  SimTC.mprApi = null;

  // =================================================================
  // EXPORTS — disponíveis via window.SimTC para todos os módulos
  // =================================================================
  /**
   * Escape de HTML.
   *
   * Existia DUAS vezes, com coberturas diferentes: a copia da aquisicao
   * escapava a apostrofe e a dos protocolos nao. Duas respostas para a mesma
   * pergunta de seguranca e uma a mais. Fica a mais estrita.
   */
  var ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(v) {
    if (v == null) return "";
    return String(v).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }

  SimTC.esc             = esc;
  SimTC.initTheme       = initTheme;
  SimTC.showMessage     = showMessage;
  SimTC.setIndicator    = setIndicator;
  SimTC.aoMudarFase     = aoMudarFase;
  SimTC.FASE_DA_TELA    = FASE_DA_TELA;
  SimTC.REGIOES         = REGIOES_DISPLAY;
  SimTC.openAppDB       = openAppDB;
  SimTC.dbStoreAll      = dbStoreAll;
  SimTC.dbStorePut      = dbStorePut;
  SimTC.dbStoreDel      = dbStoreDel;

})();
