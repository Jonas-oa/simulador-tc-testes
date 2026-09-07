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
    // Gestor de protocolos (Fase 9): duplicar, favoritar, comparar,
    // exportar e importar.
    var gestorBar = document.getElementById("proto-gestor");
    var btnDup = document.getElementById("proto-dup");
    var btnFav = document.getElementById("proto-fav");
    var btnLock = document.getElementById("proto-lock");
    var btnCmp = document.getElementById("proto-cmp");
    var btnExp = document.getElementById("proto-exp");
    var btnImp = document.getElementById("proto-imp");
    var fileImp = document.getElementById("proto-file");
    var cmpBox = document.getElementById("proto-compare");
    var cmpSel = document.getElementById("proto-cmp-alvo");
    var cmpCorpo = document.getElementById("proto-cmp-corpo");
    var cmpFechar = document.getElementById("proto-cmp-fechar");
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

    // Valores de PARTIDA para as demais entradas do catálogo.
    //
    // Antes só o crânio vinha preenchido e as outras quinze ficavam em branco.
    // Enquanto o acervo tinha volume só para crânio e tórax isso passava
    // despercebido; com abdome, pelve e coluna cobertos, o efeito ficou
    // evidente e imediato: o aluno escolhia o protocolo, chegava até a
    // confirmação e recebia "Tensão do tubo (kV) não definida" — cinco
    // impedimentos que ele não tinha como saber que precisava preencher. Um
    // simulador que só examina cabeça não é um simulador de tomógrafo.
    //
    // São referências DIDÁTICAS de adulto médio, na mesma linha das do crânio,
    // e continuam editáveis: quem define o parâmetro final do serviço é o
    // responsável técnico. Preenchem apenas entradas em branco — nada que o
    // usuário tenha digitado é sobrescrito.
    var PADROES = {
      face:      { kv: "120", mas: "200", pitch: "0,8",  espessura: "1,0 mm", kernel: "Osso (nítido)",    fov: "200 mm", scout: "lateral" },
      saf:       { kv: "120", mas: "150", pitch: "0,8",  espessura: "1,0 mm", kernel: "Osso (nítido)",    fov: "200 mm", scout: "lateral" },
      orbitas:   { kv: "120", mas: "200", pitch: "0,8",  espessura: "1,0 mm", kernel: "Osso (nítido)",    fov: "180 mm", scout: "lateral" },
      atm:       { kv: "120", mas: "200", pitch: "0,8",  espessura: "0,6 mm", kernel: "Osso (nítido)",    fov: "160 mm", scout: "lateral" },
      pescoco:   { kv: "120", mas: "250", pitch: "0,8",  espessura: "2,0 mm", kernel: "Partes moles",     fov: "220 mm", scout: "lateral" },
      torax:     { kv: "120", mas: "150", pitch: "1,0",  espessura: "2,0 mm", kernel: "Partes moles",     fov: "450 mm", scout: "frontal" },
      torax_ar:  { kv: "120", mas: "200", pitch: "1,0",  espessura: "1,0 mm", kernel: "Pulmão (nítido)",  fov: "450 mm", scout: "frontal" },
      abd_total: { kv: "120", mas: "250", pitch: "0,9",  espessura: "3,0 mm", kernel: "Partes moles",     fov: "450 mm", scout: "frontal" },
      abd_sup:   { kv: "120", mas: "250", pitch: "0,9",  espessura: "3,0 mm", kernel: "Partes moles",     fov: "450 mm", scout: "frontal" },
      pelve:     { kv: "120", mas: "250", pitch: "0,9",  espessura: "3,0 mm", kernel: "Partes moles",     fov: "450 mm", scout: "frontal" },
      col_cerv:  { kv: "120", mas: "250", pitch: "0,8",  espessura: "1,0 mm", kernel: "Osso (nítido)",    fov: "450 mm", scout: "lateral" },
      col_tor:   { kv: "120", mas: "300", pitch: "0,8",  espessura: "2,0 mm", kernel: "Osso (nítido)",    fov: "450 mm", scout: "lateral" },
      col_lomb:  { kv: "120", mas: "300", pitch: "0,8",  espessura: "2,0 mm", kernel: "Osso (nítido)",    fov: "450 mm", scout: "lateral" },
      memb_sup:  { kv: "120", mas: "150", pitch: "0,8",  espessura: "1,0 mm", kernel: "Osso (nítido)",    fov: "200 mm", scout: "frontal" },
      memb_inf:  { kv: "120", mas: "200", pitch: "0,8",  espessura: "1,0 mm", kernel: "Osso (nítido)",    fov: "250 mm", scout: "frontal" }
    };
    var COMUNS = { modo: "helicoidal", direcao: "caudocranial",
                   tilt: "0", rotacao: "0,5", colimacao: "64 × 0,6 mm" };
    function padroesObs() {
      return "Valores didáticos de referência para adulto médio. " +
             "Ajuste conforme o serviço e o porte do paciente. " +
             "O FOV precisa CONTER o paciente: neste motor o recorte de campo " +
             "acontece antes da projeção, então um FOV menor trunca de verdade " +
             "— não é reconstrução dirigida.";
    }

    function aplicarPadroesSeEmBranco() {
      protocols.forEach(function (p) {
        var d = PADROES[p.id];
        if (!d || !isClinicallyBlank(p)) return;
        for (var k in COMUNS) { if (COMUNS.hasOwnProperty(k) && !p[k]) p[k] = COMUNS[k]; }
        for (var j in d) { if (d.hasOwnProperty(j)) p[j] = d[j]; }
        if (!p.obs) p.obs = padroesObs();
        persist(p);
      });
    }
    function isClinicallyBlank(p) {
      return !(p.kv || p.mas || p.pitch || p.colimacao || p.espessura || p.kernel || p.fov || p.dose);
    }
    function applyCranioDefaultsIfBlank() {
      protocols.forEach(function (p) {
        if (p.id === "cranio" && isClinicallyBlank(p)) {
          var d = cranioDefaults();
          for (var k in d) { if (d.hasOwnProperty(k)) p[k] = d[k]; }
          if (!p.obs) p.obs = cranioObs();
          // O cranio e a unica entrada do catalogo que ja vem com valores de
          // referencia (AAPM/DRL). Nasce travado para nao ser sobrescrito sem
          // querer; as demais entradas estao em branco e precisam ser editaveis.
          if (p.bloqueado === undefined) p.bloqueado = true;
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
      aplicarPadroesSeEmBranco();
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

    // ---- gestor de protocolos --------------------------------------------
    // O modulo de nucleo (core/protocol/gestor.js) trabalha sobre o protocolo
    // NORMALIZADO; esta tela guarda a forma legada, plana e em texto. As duas
    // funcoes abaixo sao a unica ponte entre elas.
    function Gestor() {
      return window.SimTCCore && window.SimTCCore.gestorProtocolos;
    }
    function normalizado(p) {
      return window.SimTCCore.model.normalizarProtocolo(p);
    }
    /** Traz um protocolo normalizado de volta a forma plana desta tela. */
    function paraPlano(n, regiao) {
      var r = (n.reconstrucoes && n.reconstrucoes[0]) || {};
      var num = function (v) { return v == null ? "" : String(v).replace(".", ","); };
      return {
        id: n.id, nome: n.nome || "Protocolo importado",
        regiao: n.regiao || regiao || currentRegion || "",
        kv: num(n.aquisicao.kv), mas: num(n.aquisicao.mas), pitch: num(n.aquisicao.pitch),
        scout: (n.scout && n.scout.orientacao) || "lateral",
        direcao: n.aquisicao.direcao, modo: n.aquisicao.modo,
        tilt: num(n.aquisicao.tiltGantryDeg), rotacao: num(n.aquisicao.tempoRotacaoS),
        colimacao: n.aquisicao.colimacao ? (n.aquisicao.colimacao.nDetectores + "x" +
                   String(n.aquisicao.colimacao.larguraMm).replace(".", ",")) : "",
        espessura: num(r.espessuraMm), kernel: r.kernel || "", fov: num(r.fovMm),
        dose: "", obs: n.indicacao || "",
        bloqueado: !!n.bloqueado, favorito: !!n.favorito,
        derivadoDe: n.derivadoDe || null, versao: n.versao || 1
      };
    }

    function atualizarGestor() {
      var p = byId(currentId);
      if (gestorBar) gestorBar.hidden = !p;
      if (!p) { if (cmpBox) cmpBox.hidden = true; return; }
      if (btnFav) {
        btnFav.setAttribute("aria-pressed", p.favorito ? "true" : "false");
        btnFav.textContent = (p.favorito ? "★" : "☆") + " Favorito";
      }
      // Protocolo travado nao se edita: duplica-se. E o comportamento de um
      // tomografo real, onde os protocolos de fabrica sao somente leitura, e
      // impede que a referencia didatica seja sobrescrita sem querer.
      if (btnLock) {
        btnLock.setAttribute("aria-pressed", p.bloqueado ? "true" : "false");
        btnLock.textContent = (p.bloqueado ? "🔒 Destravar" : "🔓 Travar");
      }
      if (btnEdit) {
        btnEdit.disabled = !!p.bloqueado;
        btnEdit.title = p.bloqueado
          ? "Protocolo de referencia: duplique para editar"
          : "Editar este protocolo";
      }
    }

    function baixarArquivo(nome, texto) {
      var blob = new Blob([texto], { type: "application/json;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = nome;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    function renderComparacao() {
      if (!cmpCorpo) return;
      var a = byId(currentId), b = byId(cmpSel && cmpSel.value);
      if (!a || !b) { cmpCorpo.innerHTML = "<p class=\"ws-note\">Escolha um protocolo para comparar.</p>"; return; }
      var difs = Gestor().comparar(normalizado(a), normalizado(b));
      if (!difs.length) {
        cmpCorpo.innerHTML = "<p class=\"ws-note\">Os dois protocolos coincidem em todos os " +
          "parametros que governam a aquisicao.</p>";
        return;
      }
      var mostra = function (v, u) {
        if (v == null || v === "") return "<em>—</em>";
        if (v === true) return "ligado"; if (v === false) return "desligado";
        return String(v).replace(".", ",") + (u ? " " + u : "");
      };
      var html = "<table class=\"proto-cmp__tab\"><thead><tr>" +
        "<th>Parâmetro</th><th>" + esc(a.nome) + "</th><th>" + esc(b.nome) + "</th>" +
        "</tr></thead><tbody>";
      difs.forEach(function (d) {
        html += "<tr><th scope=\"row\">" + esc(d.rotulo) + "</th><td>" +
          mostra(d.de, d.unidade) + "</td><td class=\"is-dif\">" +
          mostra(d.para, d.unidade) + "</td></tr>";
      });
      html += "</tbody></table><p class=\"ws-note\">" + difs.length +
        " diferença(s). O que não aparece aqui é igual nos dois.</p>";
      cmpCorpo.innerHTML = html;
    }

    function esc(t) {
      return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c];
      });
    }

    function renderList() {
      listEl.innerHTML = "";
      var items = inRegion().slice().sort(function (a, b) {
        // Favoritos primeiro: numa lista de 16 entradas, o que o usuario marcou
        // deve estar visivel sem rolar.
        if (!!a.favorito !== !!b.favorito) return a.favorito ? -1 : 1;
        return String(a.nome).localeCompare(String(b.nome), "pt-BR");
      });
      if (emptyEl) emptyEl.hidden = items.length !== 0;
      items.forEach(function (p) {
        var li = document.createElement("li");
        li.className = "proto-list__item" + (p.id === currentId ? " is-active" : "") +
          (p.favorito ? " is-favorito" : "") + (p.bloqueado ? " is-travado" : "");
        li.textContent = (p.favorito ? "★ " : "") + p.nome + (p.bloqueado ? " 🔒" : "");
        if (p.bloqueado) li.title = "Protocolo de referência — duplique para editar";
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
      if (gestorBar) gestorBar.hidden = true;
      if (cmpBox) cmpBox.hidden = true;
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
      // O núcleo também precisa saber. Sem isto, Core.sessao.protocolo ficava
      // eternamente null e pendenciasParaIniciar() acusava "Selecionar o
      // protocolo" mesmo com um escolhido — o que tornava a única checagem
      // confiável de pré-requisitos do exame inútil para a tela.
      var Core = window.SimTCCore;
      if (Core && Core.sessao) {
        try { Core.sessao.selecionarProtocolo(p || null); } catch (e) { /* protocolo ilegível: o validador dirá */ }
      }
      atualizarGestor();
    }

    // ---- acoes do gestor -------------------------------------------------
    if (btnDup) btnDup.addEventListener("click", function () {
      var p = byId(currentId);
      if (!p) return;
      var nome = window.prompt("Nome da cópia:", p.nome + " (cópia)");
      if (nome === null) return;
      nome = nome.trim(); if (!nome) return;
      var copia = paraPlano(Gestor().duplicar(normalizado(p), { nome: nome }), p.regiao);
      copia.nome = nome;
      copia.regiao = p.regiao;
      protocols.push(copia);
      persist(copia).then(function () {
        selectProtocol(copia.id);
        SimTC.showMessage("Cópia \"" + nome + "\" criada e destravada. " +
          "O protocolo de referência continua intacto.", "success");
      });
    });

    if (btnLock) btnLock.addEventListener("click", function () {
      var p = byId(currentId); if (!p) return;
      p.bloqueado = !p.bloqueado;
      persist(p).then(function () {
        renderList(); atualizarGestor();
        SimTC.showMessage("Protocolo \"" + p.nome + "\" " +
          (p.bloqueado ? "travado — duplique para criar variações."
                       : "destravado."), "info");
      });
    });

    if (btnFav) btnFav.addEventListener("click", function () {
      var p = byId(currentId); if (!p) return;
      p.favorito = !p.favorito;
      persist(p).then(function () { renderList(); atualizarGestor(); });
    });

    if (btnCmp) btnCmp.addEventListener("click", function () {
      var p = byId(currentId); if (!p || !cmpBox || !cmpSel) return;
      if (!cmpBox.hidden) { cmpBox.hidden = true; return; }
      var outros = protocols.filter(function (x) { return x.id !== p.id; });
      if (!outros.length) {
        SimTC.showMessage("Só há um protocolo — não há com o que comparar. " +
          "Duplique este e altere um parâmetro.", "info");
        return;
      }
      cmpSel.innerHTML = outros.map(function (x) {
        return "<option value=\"" + esc(x.id) + "\">" + esc(x.nome) +
               " · " + esc(x.regiao) + "</option>";
      }).join("");
      cmpBox.hidden = false;
      renderComparacao();
    });
    if (cmpSel) cmpSel.addEventListener("change", renderComparacao);
    if (cmpFechar) cmpFechar.addEventListener("click", function () { cmpBox.hidden = true; });

    if (btnExp) btnExp.addEventListener("click", function () {
      var lista = currentRegion ? inRegion() : protocols;
      if (!lista.length) { SimTC.showMessage("Nada a exportar nesta região.", "warning"); return; }

      // Exporta so o que pode ser EXECUTADO. As entradas do catalogo que ainda
      // estao em branco (sem kV, sem mAs, sem espessura) nao sao protocolos:
      // sao lugares reservados. Se fossem para o arquivo, a importacao teria
      // de recusa-las na volta, e quem recebesse veria uma lista de avisos em
      // vez do conjunto que esperava.
      var prontos = [], embranco = [];
      lista.forEach(function (p) {
        var n = normalizado(p);
        var v = window.SimTCCore.validacao.validar(n, {});
        if (v.podeExecutar) prontos.push(n); else embranco.push(p.nome);
      });
      if (!prontos.length) {
        SimTC.showMessage("Nenhum protocolo desta região está preenchido o bastante " +
          "para ser exportado. Faltam parâmetros em: " + embranco.join(", ") + ".", "warning");
        return;
      }
      var texto = Gestor().exportar(prontos, { origem: "Simulador Educacional de TC" });
      var quando = new Date().toISOString().slice(0, 10);
      baixarArquivo("protocolos-" + (currentRegion || "todos").toLowerCase().replace(/[^a-z0-9]+/g, "-") +
                    "-" + quando + ".json", texto);
      SimTC.showMessage(prontos.length + " protocolo(s) exportado(s)." +
        (embranco.length ? " Fora: " + embranco.length + " ainda em branco (" +
         embranco.join(", ") + ")." : ""), "success");
    });

    if (btnImp && fileImp) {
      btnImp.addEventListener("click", function () { fileImp.value = ""; fileImp.click(); });
      fileImp.addEventListener("change", function () {
        var f = fileImp.files && fileImp.files[0];
        if (!f) return;
        var leitor = new FileReader();
        leitor.onload = function () {
          var r = Gestor().importar(String(leitor.result));
          if (r.erro) { SimTC.showMessage("Importação recusada: " + r.erro, "error"); return; }
          // Recusa NAO e silencio: o que ficou de fora e dito, com motivo.
          if (r.recusados.length) {
            SimTC.showMessage(r.recusados.length + " protocolo(s) recusado(s) — " +
              r.recusados.map(function (x) { return x.nome + ": " + x.motivo; }).join(" | "),
              "warning");
          }
          if (!r.aceitos.length) return;
          var novos = r.aceitos.map(function (n) { return paraPlano(n); });
          novos.forEach(function (x) { protocols.push(x); });
          Promise.all(novos.map(persist)).then(function () {
            var reg = novos[0].regiao;
            if (reg) selectRegion(reg); else renderList();
            selectProtocol(novos[0].id);
            SimTC.showMessage(novos.length + " protocolo(s) importado(s).", "success");
          });
        };
        leitor.onerror = function () { SimTC.showMessage("Não foi possível ler o arquivo.", "error"); };
        leitor.readAsText(f, "utf-8");
      });
    }

    if (btnEdit) btnEdit.addEventListener("click", function () { if (currentId) openEditor(); });
    if (btnCancel) btnCancel.addEventListener("click", function () { fillFields(byId(currentId)); closeEditor(); });
    if (btnSave) btnSave.addEventListener("click", function () {
      var p = byId(currentId); if (!p) { closeEditor(); return; }
      // Defesa em profundidade: o botao Editar ja fica desabilitado, mas se a
      // gravacao for alcancada por outro caminho, a trava vale aqui tambem.
      if (p.bloqueado) {
        SimTC.showMessage("\"" + p.nome + "\" está travado. Use Duplicar para " +
          "criar uma variação editável.", "warning");
        closeEditor(); return;
      }
      // Guarda o estado ANTERIOR antes de sobrescrever: permite voltar atras.
      try {
        var n = normalizado(p);
        Gestor().registrarVersao(n, "edição no editor");
        p.versao = n.versao;
        p.historico = n.historico;
      } catch (e) { /* versionamento e conveniencia: nao impede salvar */ }
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