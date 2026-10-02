/**
 * js/protocolos.js
 * Simulador Educacional de TC — Tela de Protocolos.
 *
 * Protocolo de crânio fixo, apresentado em uma única região, e
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

    // ---- O REGISTRO E O MODELO TIPADO ------------------------------------
    //
    // Ate a ETAPA 5, o que se gravava era a forma plana, em texto:
    //
    //     kv: "120"   pitch: "0,55"   fov: "220-250 mm"
    //     dose: "~55 mGy (ref.)"
    //     espessura: "5,0 mm encefalo / 1,25 mm osso"
    //
    // O modelo tipado existia em core/model/protocol.js, mas era calculado sob
    // demanda por cada consumidor e descartado — nunca era o que ficava no
    // banco. Dai vinham dois parsers divergentes, um FOV que era uma faixa num
    // campo de valor unico, uma espessura com dois valores no mesmo campo, e
    // uma dose digitada que reaparecia no arquivo do exame depois de a Fase 6
    // ter passado a calcula-la.
    //
    // Agora o registro E o modelo tipado. Esta tela ganha uma camada de
    // apresentacao explicita: `paraFormulario` formata numeros para os campos
    // e `doFormulario` os le de volta. Nada mais interpreta texto.

    // Valor para input[type=number]: js/ui/formatar.js. A regra de por que e
    // PONTO e nao virgula esta la, com o defeito que a originou.
    function mostrar(n) { return SimTC.fmt.paraCampo(n); }

    /** Texto do campo -> numero, ou null. Aceita virgula e ponto. */
    function ler(v) {
      if (v == null) return null;
      var s = String(v).trim().replace(",", ".");
      if (!s) return null;
      var n = parseFloat(s);
      return isFinite(n) ? n : null;
    }

    function tipado(cru) {
      return window.SimTCCore.model.normalizarProtocolo(cru || {});
    }

    // Orientacao padrao do topograma por regiao: lateral em cranio/coluna
    // (perfil), frontal (AP) na maioria dos demais exames.
    function defaultScout(regiao) {
      return (regiao === "Cranio" || regiao === "Cr\u00e2nio" ||
              regiao === "Coluna") ? "lateral" : "frontal";
    }
    function inputEl(f) { return document.getElementById("ws-param-" + f); }

    var protocols = [];
    var currentRegion = null;
    var currentId = null;
    var mode = "view";
    var memoryFallback = false;

    /** Protocolo novo: tipado, com os campos clinicos em branco de proposito. */
    function blank(id, nome, regiao) {
      var p = tipado({ id: id, nome: nome, regiao: regiao,
                       scout: defaultScout(regiao), modo: "helicoidal" });
      p.id = id; p.nome = nome; p.regiao = regiao;
      p.esquema = ESQUEMA;
      return p;
    }

    /**
     * Um protocolo esta "em branco" quando faltam os quatro parametros sem os
     * quais o exame nao pode existir. Pitch, colimacao e rotacao tem padrao de
     * equipamento; kV, mAs, espessura e FOV nao tem — e sao exatamente os que
     * o motor de validacao cobra.
     */
    function isClinicallyBlank(p) {
      var aq = (p && p.aquisicao) || {};
      var r = (p && p.reconstrucoes && p.reconstrucoes[0]) || {};
      return aq.kv == null && aq.mas == null && r.espessuraMm == null && r.fovMm == null;
    }

    /** Aplica um remendo tipado sobre o protocolo. */
    function aplicar(p, patch) {
      var aq = p.aquisicao, r = p.reconstrucoes[0];
      if (patch.modo) aq.modo = patch.modo;
      if (patch.kv != null) aq.kv = patch.kv;
      if (patch.mas != null) aq.mas = patch.mas;
      if (patch.pitch !== undefined) aq.pitch = (aq.modo === "sequencial") ? null : patch.pitch;
      if (patch.rotacaoS != null) aq.tempoRotacaoS = patch.rotacaoS;
      if (patch.tiltDeg != null) aq.tiltGantryDeg = patch.tiltDeg;
      if (patch.direcao) aq.direcao = patch.direcao;
      if (patch.colimacao) {
        aq.colimacao = { nDetectores: patch.colimacao[0], larguraMm: patch.colimacao[1],
                         totalMm: patch.colimacao[0] * patch.colimacao[1] };
      }
      if (patch.scout) p.scout.orientacao = patch.scout;
      if (patch.espessuraMm != null) { r.espessuraMm = patch.espessuraMm; r.incrementoMm = patch.espessuraMm; }
      if (patch.kernel) r.kernel = patch.kernel;
      if (patch.fovMm != null) r.fovMm = patch.fovMm;
      // Bandeira derivada: recalculada a cada remendo.
      aq.pitchIgnorado = aq.modo === "sequencial" && patch.pitch != null;
      return p;
    }

    // Referencias DIDATICAS (AAPM / DRL) para TC de cranio. Editaveis: quem
    // define o parametro final do servico e o responsavel tecnico.
    //
    // O cranio e a unica entrada do catalogo que ja nasce com valores, e por
    // isso nasce TRAVADA. Ate a ETAPA 5 essa trava nunca chegava a ser
    // aplicada: `p.bloqueado = true` estava dentro de um `if (isClinicallyBlank)`
    // que era falso justamente para o cranio, que nasce preenchido. Medido:
    // zero de dezesseis protocolos travados, em qualquer caminho de carga.
    //
    // O pitch some daqui: o cranio e sequencial, e no step-and-shoot a mesa
    // fica parada durante a rotacao. O catalogo trazia "0,55" ao lado de
    // "sequencial" — a contradicao exata que o motor de validacao existe para
    // acusar, e que ele nao conseguia ver.
    function cranioDefaults() {
      return {
        kv: 120, mas: 300, modo: "sequencial", pitch: null,
        rotacaoS: 1.0, tiltDeg: 0, direcao: "caudocranial", scout: "lateral",
        colimacao: [64, 0.6], espessuraMm: 5.0, kernel: "liso", fovMm: 240
      };
    }
    function cranioObs() {
      return "Valores did\u00e1ticos de refer\u00eancia (AAPM/DRL). Ajuste conforme o servi\u00e7o. " +
             "A dose n\u00e3o \u00e9 digitada: CTDIvol e DLP saem do c\u00e1lculo.";
    }

    // Valores de PARTIDA para as demais entradas do catalogo.
    //
    // Antes so o cranio vinha preenchido e as outras quinze ficavam em branco:
    // o aluno escolhia o protocolo, chegava a confirmacao e recebia "Tensao do
    // tubo (kV) nao definida" — impedimentos que ele nao tinha como saber que
    // precisava preencher.
    //
    // Sao referencias DIDATICAS de adulto medio, editaveis, e preenchem apenas
    // entradas em branco: nada que o usuario tenha digitado e sobrescrito.
    var PADROES = {
      face:      { kv: 120, mas: 200, pitch: 0.8, espessuraMm: 1.0, kernel: "nitido", fovMm: 200, scout: "lateral" },
      saf:       { kv: 120, mas: 150, pitch: 0.8, espessuraMm: 1.0, kernel: "nitido", fovMm: 200, scout: "lateral" },
      orbitas:   { kv: 120, mas: 200, pitch: 0.8, espessuraMm: 1.0, kernel: "nitido", fovMm: 180, scout: "lateral" },
      atm:       { kv: 120, mas: 200, pitch: 0.8, espessuraMm: 0.6, kernel: "nitido", fovMm: 160, scout: "lateral" },
      pescoco:   { kv: 120, mas: 250, pitch: 0.8, espessuraMm: 2.0, kernel: "liso",   fovMm: 220, scout: "lateral" },
      torax:     { kv: 120, mas: 150, pitch: 1.0, espessuraMm: 2.0, kernel: "liso",   fovMm: 450, scout: "frontal" },
      torax_ar:  { kv: 120, mas: 200, pitch: 1.0, espessuraMm: 1.0, kernel: "nitido", fovMm: 450, scout: "frontal" },
      abd_total: { kv: 120, mas: 250, pitch: 0.9, espessuraMm: 3.0, kernel: "liso",   fovMm: 450, scout: "frontal" },
      abd_sup:   { kv: 120, mas: 250, pitch: 0.9, espessuraMm: 3.0, kernel: "liso",   fovMm: 450, scout: "frontal" },
      pelve:     { kv: 120, mas: 250, pitch: 0.9, espessuraMm: 3.0, kernel: "liso",   fovMm: 450, scout: "frontal" },
      col_cerv:  { kv: 120, mas: 250, pitch: 0.8, espessuraMm: 1.0, kernel: "nitido", fovMm: 450, scout: "lateral" },
      col_tor:   { kv: 120, mas: 300, pitch: 0.8, espessuraMm: 2.0, kernel: "nitido", fovMm: 450, scout: "lateral" },
      col_lomb:  { kv: 120, mas: 300, pitch: 0.8, espessuraMm: 2.0, kernel: "nitido", fovMm: 450, scout: "lateral" },
      memb_sup:  { kv: 120, mas: 150, pitch: 0.8, espessuraMm: 1.0, kernel: "nitido", fovMm: 200, scout: "frontal" },
      memb_inf:  { kv: 120, mas: 200, pitch: 0.8, espessuraMm: 1.0, kernel: "nitido", fovMm: 250, scout: "frontal" }
    };
    var COMUNS = { modo: "helicoidal", direcao: "caudocranial", tiltDeg: 0,
                   rotacaoS: 0.5, colimacao: [64, 0.6] };
    function padroesObs() {
      return "Valores did\u00e1ticos de refer\u00eancia para adulto m\u00e9dio. " +
             "Ajuste conforme o servi\u00e7o e o porte do paciente. " +
             "O FOV precisa CONTER o paciente: neste motor o recorte de campo " +
             "acontece antes da proje\u00e7\u00e3o, ent\u00e3o um FOV menor trunca de verdade " +
             "\u2014 n\u00e3o \u00e9 reconstru\u00e7\u00e3o dirigida.";
    }

    function aplicarPadroesSeEmBranco() {
      protocols.forEach(function (p) {
        var d = PADROES[p.id];
        if (!d || !isClinicallyBlank(p)) return;
        aplicar(p, COMUNS);
        aplicar(p, d);
        if (!p.obs) p.obs = padroesObs();
        persist(p);
      });
    }

    function applyCranioDefaultsIfBlank() {
      protocols.forEach(function (p) {
        if (p.id !== "cranio") return;
        var mudou = false;
        if (isClinicallyBlank(p)) {
          aplicar(p, cranioDefaults());
          if (!p.obs) p.obs = cranioObs();
          mudou = true;
        }
        // A trava vale para o cranio SEMPRE, nao so quando ele nasce em
        // branco — ver o comentario em cranioDefaults().
        if (p.bloqueado !== true) { p.bloqueado = true; mudou = true; }
        if (mudou) persist(p);
      });
    }

    // O simulador usa somente o protocolo de Crânio. O catálogo fica limitado
    // a essa referência, inclusive para bancos criados em versões anteriores.
    var CATALOGO = [
      { id: "cranio", nome: "Crânio", regiao: "Crânio" }
    ];

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
    }
    function cranioSeed() {
      var p = aplicar(blank("cranio", "Crânio", "Crânio"), cranioDefaults());
      p.obs = cranioObs();
      p.bloqueado = true;   // referencia didatica: duplique para variar
      return p;
    }
    function seedDefaults() { return [cranioSeed()]; }
    function persist(o) { if (memoryFallback) return Promise.resolve(); return SimTC.dbStorePut("protocolos", o).catch(function () { memoryFallback = true; }); }

    /**
     * Normaliza preservando o que e desta tela e do gestor.
     *
     * normalizarProtocolo devolve a forma canonica do dominio e nada alem —
     * nao conhece favorito, historico nem derivadoDe. Passar um registro por
     * ele sem reatar esses campos apagaria o historico de versoes do aluno.
     */
    function normalizarPreservando(cru) {
      var n = tipado(cru);
      n.id = cru.id || n.id;
      n.nome = cru.nome || n.nome;
      n.regiao = cru.regiao || n.regiao;
      n.favorito = !!cru.favorito;
      n.bloqueado = !!cru.bloqueado;
      if (cru.historico) n.historico = cru.historico;
      if (cru.derivadoDe) n.derivadoDe = cru.derivadoDe;
      return n;
    }

    /**
     * Migracao para o modelo tipado, idempotente.
     *
     * Roda em banco de aluno, entao nao pode assumir nada: converte o que
     * ainda esta na forma plana e deixa quieto o que ja esta tipado. Um
     * registro tipado se reconhece por ter `aquisicao`.
     */
    // Versao do formato do REGISTRO. Sobe quando a forma gravada muda de um
    // jeito que exige conserto no que ja esta em disco.
    //
    //   1  forma plana em texto (kv: "120", fov: "220-250 mm")
    //   2  modelo tipado
    var ESQUEMA = 2;

    function migrarParaTipado(lista) {
      var convertidos = 0, reparados = 0;
      var saida = lista.map(function (r) {
        var jaTipado = r && r.aquisicao && r.reconstrucoes;
        var n = r;
        if (!jaTipado) { convertidos++; n = normalizarPreservando(r); }

        // O registro so e considerado migrado quando carrega a versao. Sem
        // isto, um banco convertido por uma versao intermediaria ficava a meio
        // caminho para sempre: `aquisicao` ja existia, a migracao pulava, e o
        // conserto abaixo nunca era aplicado.
        if (n.esquema !== ESQUEMA) {
          // Um pitch declarado em modo sequencial nao e um erro do OPERADOR: e
          // uma sobra do formato antigo, em que o catalogo trazia "0,55" ao
          // lado de "sequencial" e o valor nunca chegava a fisica. Mantida, a
          // marca faria a validacao travar o exame num protocolo de referencia
          // que o aluno nem pode editar — um beco sem saida herdado.
          //
          // Daqui em diante o editor impede a combinacao (o campo se desabilita
          // no sequencial) e a validacao acusa o que vier de fora, por
          // importacao — que e onde a incoerencia significa alguma coisa.
          if (n.aquisicao.modo === "sequencial" && n.aquisicao.pitch == null) {
            n.aquisicao.pitchIgnorado = false;
          }
          n.esquema = ESQUEMA;
          if (jaTipado) reparados++;
        }
        return n;
      });
      if (convertidos || reparados) {
        Promise.all(saida.map(persist)).then(function () {
          if (convertidos) {
            SimTC.showMessage(convertidos + " protocolo(s) convertidos para o formato " +
              "num\u00e9rico: os par\u00e2metros deixaram de ser texto livre.", "info");
          }
        });
      }
      return saida;
    }

    function inRegion() { return protocols.filter(function (p) { return p.regiao === currentRegion; }); }
    function byId(id) { for (var i = 0; i < protocols.length; i++) if (protocols[i].id === id) return protocols[i]; return null; }

    function highlightZones() {
      for (var i = 0; i < zones.length; i++) {
        zones[i].classList.toggle("is-active", zones[i].getAttribute("data-region") === currentRegion);
      }
    }
    // Campos do editor, na ordem em que aparecem.
    var CAMPOS = ["kv", "mas", "pitch", "scout", "direcao", "modo", "tilt",
                  "rot", "colim-n", "colim-w", "thick", "kernel", "fov"];

    /** Modelo tipado -> campos do formulario. */
    function fillFields(p) {
      var aq = (p && p.aquisicao) || {};
      var r = (p && p.reconstrucoes && p.reconstrucoes[0]) || {};
      var col = aq.colimacao || {};
      var v = {
        kv: mostrar(aq.kv), mas: mostrar(aq.mas), pitch: mostrar(aq.pitch),
        scout: (p && p.scout && p.scout.orientacao) || defaultScout(p ? p.regiao : null),
        direcao: aq.direcao || "caudocranial",
        modo: aq.modo || "helicoidal",
        tilt: mostrar(aq.tiltGantryDeg), rot: mostrar(aq.tempoRotacaoS),
        "colim-n": mostrar(col.nDetectores), "colim-w": mostrar(col.larguraMm),
        thick: mostrar(r.espessuraMm), kernel: r.kernel || "padrao", fov: mostrar(r.fovMm)
      };
      CAMPOS.forEach(function (f) { var el = inputEl(f); if (el) el.value = v[f]; });
      atualizarCamposDoModo();
    }

    /**
     * Pitch nao se aplica ao sequencial. Em vez de aceitar o valor e descarta-lo
     * em silencio — que foi o que deixou o catalogo carregar "0,55" ao lado de
     * "sequencial" —, o campo se desabilita e se esvazia.
     */
    function atualizarCamposDoModo() {
      var modoEl = inputEl("modo"), pitchEl = inputEl("pitch");
      if (!modoEl || !pitchEl) return;
      var seq = modoEl.value === "sequencial";
      pitchEl.disabled = seq || mode !== "edit";
      pitchEl.placeholder = seq ? "não se aplica ao sequencial" : "0,1–3";
      if (seq) pitchEl.value = "";
    }

    /** Campos do formulario -> modelo tipado, sobre o protocolo dado. */
    function doFormulario(p) {
      var val = function (f) { var el = inputEl(f); return el ? el.value : ""; };
      aplicar(p, {
        modo: val("modo") || "helicoidal",
        direcao: val("direcao") || "caudocranial",
        scout: val("scout") || defaultScout(p.regiao),
        kv: ler(val("kv")), mas: ler(val("mas")),
        pitch: ler(val("pitch")),
        rotacaoS: ler(val("rot")), tiltDeg: ler(val("tilt")),
        espessuraMm: ler(val("thick")), kernel: val("kernel") || "padrao",
        fovMm: ler(val("fov"))
      });
      var nDet = ler(val("colim-n")), larg = ler(val("colim-w"));
      if (nDet != null && larg != null) aplicar(p, { colimacao: [nDet, larg] });
      // Campo apagado significa APAGADO: sem isto, limpar o kV no editor
      // deixava o valor antigo no banco e o operador acreditava te-lo removido.
      var aq = p.aquisicao, r = p.reconstrucoes[0];
      if (ler(val("kv")) == null) aq.kv = null;
      if (ler(val("mas")) == null) aq.mas = null;
      if (ler(val("thick")) == null) { r.espessuraMm = null; r.incrementoMm = null; }
      if (ler(val("fov")) == null) r.fovMm = null;
      return p;
    }

    function setMode(m) {
      mode = m;
      var editing = (m === "edit");
      CAMPOS.forEach(function (f) { var el = inputEl(f); if (el) el.disabled = !editing; });
      atualizarCamposDoModo();
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
    // `paraPlano` foi embora com a ETAPA 5: o gestor do nucleo e esta tela
    // trabalham na MESMA forma agora, e nao ha mais o que converter entre elas.
    // Restou apenas reatar o que o gestor nao conhece (favorito, historico).

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
      if (!a || !b) { cmpCorpo.replaceChildren(SimTC.ui.campo.vazio("Escolha um protocolo para comparar.", "ws-note")); return; }
      var difs = Gestor().comparar(normalizado(a), normalizado(b));
      if (!difs.length) {
        cmpCorpo.replaceChildren(SimTC.ui.campo.vazio("Os dois protocolos coincidem em todos os parâmetros que governam a aquisição.", "ws-note"));
        return;
      }
      var mostra = function (v, u) {
        if (v == null || v === "") return "<em>—</em>";
        if (v === true) return "ligado"; if (v === false) return "desligado";
        return String(v).replace(".", ",") + (u ? " " + u : "");
      };
      var linhas = difs.map(function (d) {
        return {
          parametro: d.rotulo,
          valorA: mostra(d.de, d.unidade),
          valorB: mostra(d.para, d.unidade),
          temDiferenca: true
        };
      });
      var tabela = SimTC.ui.lista.tabelaComparacao("Parâmetro", a.nome, b.nome, linhas);
      var aviso = SimTC.ui.campo.vazio(difs.length + " diferença(s). O que não aparece aqui é igual nos dois.", "ws-note");
      cmpCorpo.replaceChildren(tabela, aviso);
    }

    // Escape de HTML — em js/shared.js. A copia que existia aqui nao escapava
    // a apostrofe; a compartilhada escapa.
    function esc(t) { return SimTC.esc(t); }

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
      SimTC.pedirEntrada("Nome da cópia:", p.nome + " (cópia)").then(function (nome) {
        if (nome === null) return;
        nome = nome.trim(); if (!nome) return;
        var copia = Gestor().duplicar(normalizado(p), { nome: nome });
      copia.nome = nome;
      copia.regiao = p.regiao;
      copia.favorito = false;
      protocols.push(copia);
        persist(copia).then(function () {
          selectProtocol(copia.id);
          SimTC.showMessage("Cópia \"" + nome + "\" criada e destravada. " +
            "O protocolo de referência continua intacto.", "success");
        });
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
      cmpSel.replaceChildren();
      outros.forEach(function (x) {
        var opt = document.createElement("option");
        opt.value = x.id;
        opt.textContent = x.nome + " · " + x.regiao;
        cmpSel.appendChild(opt);
      });
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
          var novos = r.aceitos.map(function (n) { return normalizarPreservando(n); });
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

    // Trocar o modo no editor reavalia o campo de pitch na hora.
    var modoSel = inputEl("modo");
    if (modoSel) modoSel.addEventListener("change", atualizarCamposDoModo);

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
      doFormulario(p);
      persist(p).then(function () { closeEditor(); SimTC.showMessage("Protocolo \"" + p.nome + "\" salvo" + (memoryFallback ? " (temporário)." : "."), "success"); });
    });
    if (btnNew) btnNew.addEventListener("click", function () {
      if (!currentRegion) { SimTC.showMessage("Selecione uma região no modelo primeiro.", "warning"); return; }
      SimTC.pedirEntrada("Nome do novo protocolo (" + currentRegion + "):", "").then(function (nome) {
        if (nome === null) return; nome = nome.trim(); if (!nome) return;
        var novo = blank("p_" + Date.now(), nome, currentRegion);
        protocols.push(novo);
        persist(novo).then(function () { selectProtocol(novo.id); openEditor(); });
      });
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
      // Protocolos antigos continuam intactos no armazenamento local, mas não
      // fazem parte deste simulador de Crânio e não são disponibilizados aqui.
      protocols = migrarParaTipado(list).filter(function (p) { return p.id === "cranio"; });
      ensureCatalog();
      selectRegion("Crânio");
      selectProtocol("cranio");
    });
  }

  window.SimTC = window.SimTC || {};
  SimTC.Protocolos = { init: initWorkstationProtocols };

})();
