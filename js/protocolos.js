/**
 * js/protocolos.js
 * Simulador Educacional de TC — Tela de Protocolos.
 *
 * Mapa corporal SVG interativo, CRUD de protocolos (catalogo canonico
 * com 16 entradas + criacao livre), editor em quadrante completo e
 * persistencia em IndexedDB. Atualiza SimTC.examProtocol que e consumido
 * pela tela de Aquisicao.
 *
 * Depende de: js/shared.js (SimTC)
 * Script classico — sem ES modules, sem bundler.
 */
(function () {
  "use strict";

  function initWorkstationProtocols() {
    var regionLabel = document.getElementById("proto-region-label");
    var listEl = document.getElementById("proto-list");
    var emptyEl = document.getElementById("proto-empty");
    var btnNew = document.getElementById("proto-new");
    var editor = document.getElementById("proto-editor");
    var actionsView = document.getElementById("ws-actions-view");
    var actionsEdit = document.getElementById("ws-actions-edit");
    var btnEdit = document.getElementById("ws-protocol-edit");
    var btnSave = document.getElementById("ws-protocol-save");
    var btnCancel = document.getElementById("ws-protocol-cancel");
    // Layout PC — editor em quadrante inteiro (classe is-editing no pane)
    var protoPane = document.getElementById("pane-proto");
    var editorTitle = document.getElementById("proto-editor-title");
    var zones = document.querySelectorAll("[data-region]");
    if (!listEl || !editor || !regionLabel) return;

    var FIELDS = ["kv", "mas", "pitch", "scout", "direcao", "modo", "tilt", "rot", "colim", "thick", "kernel", "fov", "dose"];
    var FIELD_KEYS = { kv: "kv", mas: "mas", pitch: "pitch", scout: "scout", direcao: "direcao", modo: "modo", tilt: "tilt", rot: "rotacao", colim: "colimacao", thick: "espessura", kernel: "kernel", fov: "fov", dose: "dose" };
    // Orientação padrão do topograma por região: lateral em crânio/coluna
    // (perfil), frontal (AP) na maioria dos demais exames.
    function defaultScout(regiao) {
      return (regiao === "Crânio" || regiao === "Coluna") ? "lateral" : "frontal";
    }
    function inputEl(f) { return document.getElementById("ws-param-" + f); }

    var protocols = [];
    var currentRegion = null;
    var currentId = null;
    var mode = "view";
    var memoryFallback = false;

    function blank(id, nome, regiao) {
      return { id: id, nome: nome, regiao: regiao, kv: "", mas: "", pitch: "", scout: defaultScout(regiao), direcao: "caudocranial", modo: "helicoidal", tilt: "", rotacao: "", colimacao: "", espessura: "", kernel: "", fov: "", dose: "", obs: "" };
    }

    // Etapa D — valores DIDÁTICOS de referência (AAPM / DRLs) para TC de crânio.
    // Editáveis pelo usuário; ele é o responsável técnico pelos parâmetros finais.
    function cranioDefaults() {
      return {
        kv: "120",
        mas: "300",
        pitch: "0,55",
        scout: "lateral",
        direcao: "caudocranial",
        modo: "sequencial",
        tilt: "0",
        rotacao: "1,0",
        colimacao: "64 × 0,6 mm",
        espessura: "5,0 mm encéfalo / 1,25 mm osso",
        kernel: "Encéfalo (liso) + Osso (nítido)",
        fov: "220–250 mm",
        dose: "≈55 mGy (ref.)"
      };
    }
    function cranioObs() { return "Valores didáticos de referência (AAPM/DRL). Ajuste conforme o serviço."; }
    function isClinicallyBlank(p) {
      return !(p.kv || p.mas || p.pitch || p.colimacao || p.espessura || p.kernel || p.fov || p.dose);
    }
    function applyCranioDefaultsIfBlank() {
      protocols.forEach(function (p) {
        if (p.id === "cranio" && isClinicallyBlank(p)) {
          var d = cranioDefaults();
          for (var k in d) { if (d.hasOwnProperty(k)) p[k] = d[k]; }
          if (!p.obs) p.obs = cranioObs();
          persist(p);
        }
      });
    }

    // Catálogo canônico de protocolos por região (fixos — NÃO podem ser
    // apagados). Nomes didáticos definidos pelo operador; parâmetros dos
    // demais ficam em branco até ele preencher/validar. ensureCatalog roda
    // a cada carga: recria o que faltar e re-preenche o crânio se vier em
    // branco (auto-recuperação contra estados antigos do banco).
    var CATALOGO = [
      { id: "cranio",   nome: "Crânio",           regiao: "Crânio" },
      { id: "face",     nome: "Face",             regiao: "Crânio" },
      { id: "saf",      nome: "Seios da face",    regiao: "Crânio" },
      { id: "orbitas",  nome: "Órbitas",          regiao: "Crânio" },
      { id: "atm",      nome: "ATM",              regiao: "Crânio" },
      { id: "pescoco",  nome: "Pescoço",          regiao: "Pescoço" },
      { id: "torax",    nome: "Tórax",            regiao: "Tórax" },
      { id: "torax_ar", nome: "Tórax AR (HRCT)",  regiao: "Tórax" },
      { id: "abd_total", nome: "Abdome total",    regiao: "Abdome" },
      { id: "abd_sup",  nome: "Abdome superior",  regiao: "Abdome" },
      { id: "pelve",    nome: "Pelve",            regiao: "Pelve" },
      { id: "col_cerv", nome: "Coluna cervical",  regiao: "Coluna" },
      { id: "col_tor",  nome: "Coluna torácica",  regiao: "Coluna" },
      { id: "col_lomb", nome: "Coluna lombar",    regiao: "Coluna" },
      { id: "memb_sup", nome: "Membro superior",  regiao: "Membros" },
      { id: "memb_inf", nome: "Membro inferior",  regiao: "Membros" }
    ];
    // Migração: campos estruturados (modo/tilt/rotacao) adicionados depois.
    // Garante-os em protocolos salvos por versões anteriores. O crânio ganha
    // os padrões didáticos (sequencial, tilt 0, rotação 1,0); os demais,
    // helicoidal por padrão. Só persiste quando de fato completou algo.
    function ensureStructuredFields() {
      protocols.forEach(function (p) {
        var changed = false;
        if (p.modo === undefined || p.modo === "") {
          p.modo = (p.id === "cranio") ? "sequencial" : "helicoidal"; changed = true;
        }
        if (p.tilt === undefined) { p.tilt = (p.id === "cranio") ? "0" : ""; changed = true; }
        if (p.rotacao === undefined) { p.rotacao = (p.id === "cranio") ? "1,0" : ""; changed = true; }
        if (p.scout === undefined || p.scout === "") { p.scout = defaultScout(p.regiao); changed = true; }
        if (changed) persist(p);
      });
    }
    function ensureCatalog() {
      CATALOGO.forEach(function (c) {
        if (!byId(c.id)) {
          var novo = blank(c.id, c.nome, c.regiao);
          protocols.push(novo);
          persist(novo);
        }
      });
      applyCranioDefaultsIfBlank();
      ensureStructuredFields();
    }
    function cranioSeed() {
      var p = blank("cranio", "Crânio", "Crânio");
      var d = cranioDefaults();
      for (var k in d) { if (d.hasOwnProperty(k)) p[k] = d[k]; }
      p.obs = cranioObs();
      return p;
    }
    function seedDefaults() { return [cranioSeed(), blank("torax", "Tórax", "Tórax")]; }
    function persist(o) { if (memoryFallback) return Promise.resolve(); return SimTC.dbStorePut("protocolos", o).catch(function () { memoryFallback = true; }); }

    function inRegion() { return protocols.filter(function (p) { return p.regiao === currentRegion; }); }
    function byId(id) { for (var i = 0; i < protocols.length; i++) if (protocols[i].id === id) return protocols[i]; return null; }

    function highlightZones() {
      for (var i = 0; i < zones.length; i++) {
        zones[i].classList.toggle("is-active", zones[i].getAttribute("data-region") === currentRegion);
      }
    }
    function fillFields(p) {
      FIELDS.forEach(function (f) { var el = inputEl(f); if (el) el.value = p ? (p[FIELD_KEYS[f]] || "") : ""; });
      var dirEl = inputEl("direcao");
      if (dirEl && !dirEl.value) dirEl.value = "caudocranial"; // protocolos antigos sem o campo
      var modoEl = inputEl("modo");
      if (modoEl && !modoEl.value) modoEl.value = "helicoidal"; // idem
      var scoutEl = inputEl("scout");
      if (scoutEl && !scoutEl.value) scoutEl.value = defaultScout(p ? p.regiao : null); // idem
    }
    function setMode(m) {
      mode = m;
      var editing = (m === "edit");
      FIELDS.forEach(function (f) { var el = inputEl(f); if (el) el.disabled = !editing; });
      if (actionsView) actionsView.hidden = editing;
      if (actionsEdit) actionsEdit.hidden = !editing;
    }

    // Editor ocupa o quadrante inteiro (esconde mapa/lista via is-editing);
    // Salvar/Cancelar voltam à visão padrão. Evita a barra de rolagem.
    function openEditor() {
      var p = byId(currentId);
      if (!p) return;
      fillFields(p);
      if (editorTitle) editorTitle.textContent = p.nome + " — " + p.regiao;
      editor.hidden = false;
      if (protoPane) protoPane.classList.add("is-editing");
      setMode("edit");
    }
    function closeEditor() {
      editor.hidden = true;
      if (protoPane) protoPane.classList.remove("is-editing");
      setMode("view");
    }

    function renderList() {
      listEl.innerHTML = "";
      var items = inRegion();
      if (emptyEl) emptyEl.hidden = items.length !== 0;
      items.forEach(function (p) {
        var li = document.createElement("li");
        li.className = "proto-list__item" + (p.id === currentId ? " is-active" : "");
        li.textContent = p.nome;
        li.setAttribute("data-id", p.id);
        li.addEventListener("click", function () { selectProtocol(p.id); });
        listEl.appendChild(li);
      });
    }
    function selectRegion(region) {
      currentRegion = region;
      currentId = null;
      highlightZones();
      regionLabel.textContent = region;
      if (btnNew) btnNew.hidden = false;
      if (btnEdit) btnEdit.hidden = true;
      closeEditor();
      renderList();
    }
    function selectProtocol(id) {
      currentId = id;
      renderList();
      var p = byId(id);
      fillFields(p);
      // O editor só abre pelo botão Editar (quadrante inteiro).
      if (btnEdit) btnEdit.hidden = !p;
      // Este é o protocolo que será usado no exame (aparece na aquisição).
      SimTC.examProtocol.name = p ? p.nome : "";
      SimTC.examProtocol.data = p || null;
      if (SimTC.examProtocol.refresh) SimTC.examProtocol.refresh();
    }

    if (btnEdit) btnEdit.addEventListener("click", function () { if (currentId) openEditor(); });
    if (btnCancel) btnCancel.addEventListener("click", function () { fillFields(byId(currentId)); closeEditor(); });
    if (btnSave) btnSave.addEventListener("click", function () {
      var p = byId(currentId); if (!p) { closeEditor(); return; }
      FIELDS.forEach(function (f) { var el = inputEl(f); if (el) p[FIELD_KEYS[f]] = el.value.trim(); });
      persist(p).then(function () { closeEditor(); SimTC.showMessage("Protocolo \"" + p.nome + "\" salvo" + (memoryFallback ? " (temporário)." : "."), "success"); });
    });
    if (btnNew) btnNew.addEventListener("click", function () {
      if (!currentRegion) { SimTC.showMessage("Selecione uma região no modelo primeiro.", "warning"); return; }
      var nome = window.prompt("Nome do novo protocolo (" + currentRegion + "):", "");
      if (nome === null) return; nome = nome.trim(); if (!nome) return;
      var novo = blank("p_" + Date.now(), nome, currentRegion);
      protocols.push(novo);
      persist(novo).then(function () { selectProtocol(novo.id); openEditor(); });
    });

    for (var z = 0; z < zones.length; z++) {
      (function (el) {
        el.style.cursor = "pointer";
        el.addEventListener("click", function () { selectRegion(el.getAttribute("data-region")); });
      })(zones[z]);
    }

    SimTC.dbStoreAll("protocolos").then(function (list) {
      if (!list || list.length === 0) {
        var d = seedDefaults();
        return Promise.all(d.map(function (x) { return SimTC.dbStorePut("protocolos", x); })).then(function () { return d; });
      }
      return list;
    }).catch(function (err) {
      memoryFallback = true;
      SimTC.showMessage("Protocolos em modo temporário: " + err.message, "info");
      return seedDefaults();
    }).then(function (list) {
      protocols = list;
      ensureCatalog();
      selectRegion("Crânio");
    });
  }

  window.SimTC = window.SimTC || {};
  SimTC.Protocolos = { init: initWorkstationProtocols };

})();