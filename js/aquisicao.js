/**
 * js/aquisicao.js
 * Simulador Educacional de TC — Tela de Aquisicao de Imagens.
 *
 * Gerencia todo o fluxo de aquisicao:
 *   • Topograma (scout) com varredura sincronizada com a mesa 3D real
 *   • Planejamento da faixa (linhas FOV/CC arrastaveis)
 *   • Botao MOVER (posiciona a mesa no inicio da faixa planejada)
 *   • Volume helicoidal e axial sequencial (arco + som WebAudio)
 *   • Reconstrucao MPR in-browser (coronal/sagital a partir da pilha axial)
 *   • Relatorio didatico (DLP, dose estimada, checklist pre-aquisicao)
 *   • Painel de sequencia de passos e parametros do protocolo
 *   • Exportacao do volume para o leitor DICOM via SimTC.mprApi
 *
 * Depende de: js/shared.js (SimTC), js/phantoms.js (CTPhantom)
 * Script classico — sem ES modules, sem bundler.
 */
(function () {
  "use strict";

  // Escape de HTML. O relatório, a confirmação e o painel de parâmetros são
  // montados com innerHTML e recebem texto digitado pelo operador (nome e
  // prontuário do paciente, campos livres do protocolo). Sem escapar, esse
  // texto é interpretado como marcação.
  var ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(v) {
    if (v == null) return "";
    return String(v).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }

  function initWorkstationViewer() {
    var box = document.getElementById("ws-slice-viewer");
    var img = document.getElementById("ws-slice-img");
    var placeholder = document.getElementById("ws-viewer-placeholder");
    var ctrl = document.getElementById("ws-viewer-ctrl");
    var slider = document.getElementById("ws-slice-slider");
    var counter = document.getElementById("ws-slice-counter");
    var startBtn = document.getElementById("ws-exam-start");
    var stopBtn = document.getElementById("ws-exam-stop");
    var moveBtn = document.getElementById("ws-exam-move");
    var reportBtn = document.getElementById("ws-exam-report");
    var reportEl = document.getElementById("ws-report");
    var caption = document.getElementById("ws-viewer-caption");
    var topo = document.getElementById("ws-topo");
    var topoImg = document.getElementById("ws-topo-img");
    var topoBox = document.getElementById("ws-topo-box");
    var readout = document.getElementById("ws-topo-readout");
    var lines = topoBox ? topoBox.querySelectorAll(".ws-topo__line") : [];
    if (!box || !img || !slider || !startBtn) return;

    var BASE = "assets/volumes/cranio/";
    var REV = "20260713a"; // bump ao trocar assets — quebra cache do GitHub Pages
    function bust(path) { return BASE + path + (path.indexOf("?") < 0 ? "?v=" + REV : "&v=" + REV); }
    var manifest = null;

    // ---- Origem das imagens do exame (fantoma SIMULADO ou arquivos) --------
    // Contrato mínimo trocável por DICOM no futuro: manifest / axial(i) /
    // scout(kind). Hoje: fantoma procedural (js/phantoms.js). A região sai do
    // protocolo selecionado (Tórax → tórax; demais → crânio, por ora).
    var volSource = { kind: "files", region: null };
    function regiaoDoProtocolo() {
      var prot = protocoloVigente();
      return (prot && prot.regiao) || "";
    }
    // Ordem de preferencia da origem das imagens:
    //   1) volume de TC REAL do acervo (HU verdadeiros)  -> Fase 2/3
    //   2) fantoma procedural, so como reserva offline
    // Antes, qualquer regiao diferente de Torax caia num cranio em silencio
    // (B-17). Agora, regiao sem volume e dita explicitamente.
    function resolveSource() {
      var regiao = regiaoDoProtocolo();
      if (SimTC.FonteVolume && SimTC.FonteVolume.has(regiao)) {
        return { kind: "volume", region: regiao };
      }
      var legado = (regiao === "Tórax") ? "torax" : "cranio";
      if (window.CTPhantom && window.CTPhantom.has(legado)) {
        return { kind: "phantom", region: legado };
      }
      return { kind: "files", region: null };
    }
    var janelaAtual = null;   // {wl, ww} — null usa a janela padrao do volume
    var loaded = false;
    // idle → topoAcq (varredura) → plan (linhas) → volAcq (mesa+cortes) → review
    var phase = "idle";
    var topoAnim = null;   // requestAnimationFrame da varredura do topograma
    var volTimer = null;   // intervalo da aquisição corte a corte
    var TOPO_MS = 4000;    // fallback (sem cena 3D): duração da varredura
    var VOL_MS = 6500;     // fallback (sem cena 3D): duração do volume
    // Física didática da aquisição (mesa REAL comanda a imagem):
    // Comprimento REAL coberto pelo topograma: o scout E a projecao do volume,
    // entao a escala dele e a extensao cranio-caudal do volume carregado.
    //
    // Antes isso vivia numa variavel de modulo reatribuida no inicio do exame.
    // Funcionava no fluxo normal, mas obrigava todo consumidor a confiar que a
    // atribuicao ja tinha acontecido; qualquer caminho que lesse a faixa em mm
    // antes disso usaria 300 mm — errado por +76% no cranio (170 mm) e -57% no
    // tronco (694 mm). Lendo do volume a cada uso, nao ha ordem a respeitar.
    // Os 300 mm ficam so como reserva para o fantoma procedural, que nao tem
    // volume carregado.
    var TOPO_LEN_PADRAO_MM = 300;

    function topoLenMm() {
      var v = SimTC.FonteVolume && SimTC.FonteVolume.volume(regiaoDoProtocolo());
      if (v && v.dims && v.spacingMm) {
        var z = v.dims[2] * v.spacingMm[2];
        if (isFinite(z) && z > 0) return z;
      }
      return TOPO_LEN_PADRAO_MM;
    }
    var TOPO_SPEED_MMS = 100;// velocidade da mesa no scout (tubo estacionário)
    var ROT_S = 1.0;         // tempo de rotação do gantry (s/volta) no helicoidal

    // Caixa de planejamento (%). A orientação do scout (protocolo) define
    // qual eixo é a FAIXA (range crânio-caudal) e qual é o FOV no plano:
    //   • LATERAL (perfil, decúbito dorsal, VÉRTICE à ESQUERDA, base à direita,
    //     face p/ CIMA): faixa CC = eixo HORIZONTAL (bordas esq/dir);
    //     FOV A-P = eixo VERTICAL (bordas sup/inf).
    //   • FRONTAL/AP (crânio em cima, base embaixo): faixa CC = eixo VERTICAL
    //     (bordas sup/inf); FOV R-L = eixo HORIZONTAL (bordas esq/dir).
    // Zonas-alvo didáticas — validação clínica do usuário. As do frontal são
    // aproximadas (imagem AP ilustrativa) e podem ser recalibradas.
    var BOX_PRESET = {
      lateral: {
        def: { top: 42, bottom: 94, left: 7, right: 66 },
        target: { top: [30, 54], bottom: [84, 100], left: [2, 18], right: [56, 76] }
      },
      frontal: {
        def: { top: 10, bottom: 74, left: 24, right: 76 },
        target: { top: [2, 22], bottom: [64, 88], left: [14, 36], right: [64, 86] }
      }
    };
    function isFrontal() { return protocolParams().scout === "frontal"; }
    function preset() { return BOX_PRESET[isFrontal() ? "frontal" : "lateral"]; }
    // Extensões (% da imagem) da FAIXA (range CC) e do FOV, conforme a orientação.
    function rangeSpan() { return isFrontal() ? (boxState.bottom - boxState.top) : (boxState.right - boxState.left); }
    function fovSpan() { return isFrontal() ? (boxState.right - boxState.left) : (boxState.bottom - boxState.top); }
    var boxState = { top: 42, bottom: 94, left: 7, right: 66 };
    var MIN_GAP = 6; // % mínimo entre linhas opostas
    var lastSlice = 0; // último corte pintado na aquisição (p/ review)
    var lastAcq = null; // parâmetros da última aquisição (p/ relatório)
    // MPR: plano de exibição atual e volume reconstruído da pilha axial.
    var plane = "axial";
    var vol = null; // { W, H, Z, slices:[Uint8Array], spX, spY, spZ }
    var mprCache = {}; // dataURL por plano+índice (evita reconstruir a cada tick)

    // Recusa da mesa: além da mensagem, realça o comando que resolve o
    // impasse (ENTRAR/SAIR), para que a orientação tenha um alvo visível.
    function falhaMesa(res, sufixo) {
      SimTC.showMessage(res.motivo + (sufixo || ""), "warning");
      if (res.acao && SimTC.tableDriveApi && SimTC.tableDriveApi.hintControl) {
        SimTC.tableDriveApi.hintControl(res.acao);
      }
    }

    // Parametros de reconstrucao vindos do protocolo. Campos em branco
    // recebem um padrao explicito — nunca um valor clinico inventado; o
    // padrao aqui e de ENGENHARIA (o que o motor precisa para rodar).
    function paramsReconstrucao() {
      var Core = window.SimTCCore;
      var cru = protocoloVigente() || {};
      var pr = Core.model.normalizarProtocolo(cru);
      var extensao = (SimTC.FonteVolume && SimTC.FonteVolume.volume(regiaoDoProtocolo()));
      var fovPadrao = extensao ? Math.round(extensao.extentMm()[0]) : 350;
      var recs = pr.reconstrucoes.map(function (r) {
        return {
          nome: r.nome || "Série",
          espessuraMm: r.espessuraMm || 5,
          incrementoMm: r.incrementoMm || r.espessuraMm || 5,
          kernel: r.kernel || "padrao",
          fovMm: r.fovMm || fovPadrao,
          // Matriz limitada a 256 nesta versao: 512 quadruplica o custo da
          // retroprojecao e o exame passaria de um minuto no navegador.
          matriz: Math.min(256, r.matriz || 256)
        };
      });
      return { protocolo: pr, reconstrucoes: recs };
    }

    // PROTOCOLO CONGELADO PARA O EXAME.
    //
    // Trocar de protocolo durante a aquisicao fazia o exame terminar com as
    // imagens de um protocolo e o ROTULO de outro: o relatorio atribuia o
    // exame ao protocolo errado. Num console real o protocolo e travado
    // quando a irradiacao comeca. Aqui tira-se uma copia no inicio e o exame
    // inteiro passa a consultar essa copia.
    var protoExame = null;
    function protocoloVigente() {
      if (protoExame) return protoExame;
      return (SimTC.examProtocol && SimTC.examProtocol.data) || null;
    }
    function congelarProtocolo() {
      var p = (SimTC.examProtocol && SimTC.examProtocol.data) || null;
      protoExame = p ? JSON.parse(JSON.stringify(p)) : null;
      return protoExame;
    }

    // ---- ponte com o motor de aquisicao/reconstrucao ----------------
    var motorPromessa = null;   // reconstrucao em curso
    var motorErro = null;

    // A faixa desenhada no topograma, convertida para MILIMETROS no eixo
    // cranio-caudal do volume. E o que o motor consome: sem isto a faixa
    // continuaria sendo "% da imagem", que nao e grandeza.
    function faixaEmMm() {
      var fr = isFrontal();
      var a = fr ? boxState.top : boxState.left;
      var b = fr ? boxState.bottom : boxState.right;
      // A caixa e fracao do TOPOGRAMA, que exibe o superior primeiro (vertice
      // a esquerda no lateral, cranio em cima no frontal). O volume indexa ao
      // contrario: o corte 0 e o INFERIOR. Sem esta inversao a faixa desenhada
      // sobre o torax adquiria a pelve.
      var reg = regiaoDoProtocolo();
      var conv = SimTC.FonteVolume && SimTC.FonteVolume.fracaoCCparaMm;
      var L = topoLenMm();
      function paraMm(pct) {
        var f = pct / 100;
        var mm = conv ? SimTC.FonteVolume.fracaoCCparaMm(reg, f) : null;
        return mm == null ? (1 - f) * L : mm;   // fantoma procedural: mesma regra
      }
      var mmA = paraMm(a), mmB = paraMm(b);
      return { inicioMm: Math.min(mmA, mmB), fimMm: Math.max(mmA, mmB) };
    }

    // Total de cortes exibiveis: da serie reconstruida quando ela existe,
    // senao do volume (comportamento anterior).
    // Seletor de SERIES. Um exame produz N series do mesmo dado bruto
    // (encefalo 5 mm liso, osso 1,25 mm nitido...). Trocar de serie e um ato
    // do operador, e precisa aparecer.
    function renderSeletorSeries() {
      var el = document.getElementById("ws-series");
      if (!el) return;
      var M = SimTC.MotorImagem;
      if (!M || !M.temSeries()) { el.hidden = true; el.innerHTML = ""; return; }
      var lista = M.series();
      var html = '<span class="ws-series__rot">Séries</span>';
      for (var i = 0; i < lista.length; i++) {
        var s = lista[i];
        html += '<button type="button" class="ws-series__btn' +
          (i === M.indiceAtual() ? " is-active" : "") + '" data-serie="' + i + '">' +
          esc(s.nome) + ' <small>' + s.espessuraMm + " mm · " + esc(s.kernel) +
          " · " + s.cortes + " cortes</small></button>";
      }
      el.innerHTML = html;
      el.hidden = false;
    }

    function totalCortes() {
      if (SimTC.MotorImagem && SimTC.MotorImagem.temSeries()) return SimTC.MotorImagem.cortes();
      return manifest ? manifest.cortes : 0;
    }

    // Anuncia a fase do exame (idle/topoAcq/plan/moving/volAcq/review)
    // para módulos desacoplados — ex.: o PiP da sala 3D no modo console.
    function announcePhase(p) {
      try { document.dispatchEvent(new CustomEvent("ct:phase", { detail: { phase: p } })); } catch (e) { /* sem suporte */ }
    }
    // Referência espacial do topograma: onde a mesa ESTAVA quando cada
    // ponto da imagem foi varrido. Permite ao MOVER levar a mesa de volta
    // à posição inicial da faixa planejada (como no equipamento real).
    var topoRef = null;   // { startZ (m), dir }
    var atStart = false;  // mesa está na posição inicial da faixa?
    var isMoving = false; // MOVER em andamento

    // Posição (m) da mesa correspondente ao INÍCIO da faixa planejada.
    // Mapa imagem→mesa ao longo do eixo crânio-caudal. No LATERAL o eixo CC é
    // horizontal (0=esquerda/VÉRTICE, 1=direita/base); no FRONTAL é vertical
    // (0=topo/VÉRTICE, 1=base embaixo). Caudo-cranial: mesa SAI, varredura
    // base→vértice; crânio-caudal: mesa ENTRA, vértice→base. O início da faixa
    // é a extremidade correspondente à direção.
    function volumeStartZ() {
      if (!topoRef) return null;
      var L = topoLenMm() / 1000;
      var frontal = topoRef.scout === "frontal";
      // borda "vértice" (fração 0) e borda "base" (fração 1) da faixa
      var vertexEdge = frontal ? boxState.top : boxState.left;
      var baseEdge = frontal ? boxState.bottom : boxState.right;
      if (topoRef.dir === "craniocaudal") {
        var k0 = vertexEdge / 100;                // até o vértice planejado
        return topoRef.startZ - L * k0;
      }
      var k0c = 1 - (baseEdge / 100);             // até a base planejada
      return topoRef.startZ + L * k0c;
    }

    // Ajusta o topograma para caber no quadrante preservando a proporção
    // (o box das linhas casa exatamente com a imagem).
    function fitTopo() {
      if (!topo || topo.hidden || !box) return;
      var natW = topoImg.naturalWidth || 814;
      var natH = topoImg.naturalHeight || 700;
      // No layout de 4 quadrantes o topograma vive no próprio quadrante
      // (não mais dentro do viewer de cortes) — medimos o container real.
      var r = (topo.parentNode || box).getBoundingClientRect();
      // No celular (aba Exame) a faixa de comandos ocupa a direita do
      // quadrante — desconta a largura dela para a imagem caber na área útil.
      var railW = 0;
      var cmds = document.getElementById("acq-topo-cmds");
      if (cmds && !cmds.hidden) railW = cmds.getBoundingClientRect().width + 6;
      var availW = Math.max(60, r.width - 24 - railW);
      var availH = Math.max(60, r.height - 24);
      var s = Math.min(availW / natW, availH / natH);
      topo.style.width = Math.max(1, Math.floor(natW * s)) + "px";
      topo.style.height = Math.max(1, Math.floor(natH * s)) + "px";
    }

    // Parâmetros do protocolo selecionado (direção, pitch, colimação) com
    // interpretação tolerante ("1,2", "64 × 0,6 mm", "40 mm"...).
    function protocolParams() {
      var p = protocoloVigente() || {};
      function num(s) {
        if (!s) return NaN;
        var m = String(s).replace(/,/g, ".").match(/\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : NaN;
      }
      function colimMm(s) {
        if (!s) return 38.4;
        var ms = String(s).replace(/,/g, ".").match(/\d+(\.\d+)?/g);
        if (!ms || !ms.length) return 38.4;
        if (ms.length >= 2) return parseFloat(ms[0]) * parseFloat(ms[1]); // "64 × 0,6 mm"
        return parseFloat(ms[0]);                                        // "40 mm"
      }
      var pitch = num(p.pitch);
      if (!(pitch > 0)) pitch = 1.0;
      var rot = num(p.rotacao);
      if (!(rot > 0)) rot = ROT_S;
      var tilt = num(p.tilt);
      if (isNaN(tilt)) tilt = 0;
      tilt = Math.max(-30, Math.min(30, tilt));
      return {
        scout: p.scout === "frontal" ? "frontal" : "lateral",
        direcao: p.direcao === "craniocaudal" ? "craniocaudal" : "caudocranial",
        modo: p.modo === "sequencial" ? "sequencial" : "helicoidal",
        pitch: pitch,
        colim: colimMm(p.colimacao),
        rotacaoS: rot,
        tiltDeg: tilt
      };
    }

    // Arquivo do topograma conforme a orientação do scout no protocolo:
    // frontal (AP) usa a imagem AP; lateral usa a de perfil. Fallbacks
    // garantem exibição mesmo em manifestos antigos / asset AP ausente.
    // Devolve o SRC completo do topograma (dataURL do fantoma, ou arquivo já
    // com cache-buster). Orientação frontal/AP vs lateral conforme o protocolo.
    function scoutSrc(m) {
      var frontal = protocolParams().scout === "frontal";
      if (volSource.kind === "volume") return SimTC.FonteVolume.scout(volSource.region, frontal ? "frontal" : "lateral");
      if (volSource.kind === "phantom") return window.CTPhantom.scout(volSource.region, frontal ? "frontal" : "lateral");
      if (!m) return bust("topograma.png");
      if (frontal) return bust(m.topograma_ap || m.topograma_frontal || m.topograma_h || m.topograma || "topograma.png");
      return bust(m.topograma_h || m.topograma || "topograma.png");
    }
    // Se o AP não existir (asset ainda não adicionado), cai para o lateral
    // sem quebrar a aquisição.
    if (topoImg) {
      topoImg.addEventListener("error", function () {
        if (!manifest || volSource.kind === "phantom") return; // fantoma não tem 404
        var lat = bust(manifest.topograma_h || manifest.topograma || "topograma.png");
        if (topoImg.getAttribute("src") !== lat) {
          topoImg.src = lat;
          SimTC.showMessage("Topograma AP indisponível — exibindo o lateral. Adicione topograma-ap.png para o modo frontal.", "info");
        }
      });
    }

    // ---- som da máquina (WebAudio sintetizado — offline, sem assets) ----
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

    function pad3(n) { n = String(n); while (n.length < 3) n = "0" + n; return n; }
    function srcFor(i) {
      // Serie RECONSTRUIDA tem precedencia: e o produto do motor, com o
      // ruido e a nitidez que os parametros do protocolo produziram.
      if (SimTC.MotorImagem && SimTC.MotorImagem.temSeries()) {
        var u = SimTC.MotorImagem.axial(i);
        if (u) return u;
      }
      if (volSource.kind === "volume") return SimTC.FonteVolume.axial(volSource.region, i, janelaAtual);
      if (volSource.kind === "phantom") return window.CTPhantom.axial(volSource.region, i);
      return bust("axial_" + pad3(i) + ".png");
    }
    function show(i) {
      var total = totalCortes();
      if (!total) return;
      i = i | 0;
      if (i < 0) i = 0;
      if (i > total - 1) i = total - 1;
      img.src = srcFor(i);
      slider.value = i;
      counter.textContent = "Corte " + (i + 1) + " / " + total;
      if (SimTC.Medidas) SimTC.Medidas.sincronizar(i);
    }

    // ---- rótulos de orientação anatômica nas margens (modo anatômico) ----
    function setOrientLabels(boxId, t, b, l, r) {
      var el = document.getElementById(boxId); if (!el) return;
      var q = function (c) { return el.querySelector(".ws-orient__lbl--" + c); };
      var st = q("t"), sb = q("b"), sl = q("l"), sr = q("r");
      if (st) st.textContent = t; if (sb) sb.textContent = b;
      if (sl) sl.textContent = l; if (sr) sr.textContent = r;
    }
    // Topograma: LATERAL (perfil) vs FRONTAL/AP. No modo anatômico o operador
    // "vê o paciente de frente" → no AP a direita do paciente fica à ESQUERDA
    // da imagem. A seta indica o sentido de deslocamento da mesa no eixo CC.
    function updateTopoOrient() {
      var pp = protocolParams();
      var dirEl = document.getElementById("ws-topo-dir");
      if (pp.scout === "frontal") {
        setOrientLabels("ws-topo-orient", "Cabeça", "Pés", "D", "E");
        if (dirEl) { dirEl.className = "ws-orient__dir is-v"; dirEl.textContent = (pp.direcao === "craniocaudal" ? "↓" : "↑") + " mesa"; }
      } else {
        setOrientLabels("ws-topo-orient", "A", "P", "Cabeça", "Pés");
        if (dirEl) { dirEl.className = "ws-orient__dir is-h"; dirEl.textContent = (pp.direcao === "craniocaudal" ? "→" : "←") + " mesa"; }
      }
    }
    // Volume: rótulos por plano de exibição, convenção radiológica anatômica
    // (axial visto pelos pés → Direita do paciente à ESQUERDA da imagem).
    function updateVolOrient() {
      // Geometria dos reformats (buildReformat): coronal = x(R-L) × Z(CC);
      // sagital = Z(CC, horizontal) × y(A-P, vertical). Rótulos batem com os
      // pixels gerados.
      if (plane === "coronal") setOrientLabels("ws-vol-orient", "Cabeça", "Pés", "D", "E");
      else if (plane === "sagital") setOrientLabels("ws-vol-orient", "A", "P", "Cabeça", "Pés");
      else setOrientLabels("ws-vol-orient", "A", "P", "D", "E"); // axial
    }
    function showVolOrient(v) {
      var el = document.getElementById("ws-vol-orient");
      if (el) el.hidden = !v;
      if (v) updateVolOrient();
    }

    // ---- caixa: render, validação, readout ----
    function applyBox() {
      if (!topoBox) return;
      topoBox.style.setProperty("--edge-top", boxState.top + "%");
      topoBox.style.setProperty("--edge-bottom", boxState.bottom + "%");
      topoBox.style.setProperty("--edge-left", boxState.left + "%");
      topoBox.style.setProperty("--edge-right", boxState.right + "%");
      // Orientação do scout: no frontal a FAIXA passa para o eixo vertical e o
      // FOV para o horizontal — o CSS troca as cores das bordas e o JS troca
      // a posição/texto dos rótulos de eixo.
      var fr = isFrontal();
      topoBox.classList.toggle("is-frontal", fr);
      var fovAxis = document.getElementById("ws-topo-axis-fov");
      if (fovAxis) fovAxis.textContent = fr ? "FOV · R-L" : "FOV · A-P";
      // Tilt do gantry: os planos de corte aparecem angulados na scout
      // (as linhas de faixa giram pelo ângulo do protocolo).
      var tilt = protocolParams().tiltDeg || 0;
      topoBox.style.setProperty("--tilt", tilt + "deg");
      topoBox.classList.toggle("has-tilt", Math.abs(tilt) > 0.5);
      updateTopoOrient();
    }
    function inZone(v, z) { return v >= z[0] && v <= z[1]; }

    /**
     * Validação da faixa planejada (corrige B-21).
     *
     * As zonas-alvo eram CONSTANTES calibradas para o crânio: num exame de
     * tórax o sistema recusava faixas perfeitamente válidas dizendo "leve o
     * limite inferior até a base do crânio". Agora os limites vêm do próprio
     * volume — onde o paciente de fato está —, então valem para qualquer
     * região do acervo.
     *
     * As regras são físicas, não anatômicas:
     *   • faixa invertida ou estreita demais não é varredura;
     *   • faixa fora do paciente irradia ar;
     *   • FOV que não cobre o paciente trunca a imagem.
     */
    function problems() {
      var p = [];
      var fr = isFrontal();
      // Eixo crânio-caudal e eixo perpendicular, conforme a orientação.
      var ccA = fr ? boxState.top : boxState.left;
      var ccB = fr ? boxState.bottom : boxState.right;
      var pA = fr ? boxState.left : boxState.top;
      var pB = fr ? boxState.right : boxState.bottom;
      var faixa = Math.abs(ccB - ccA);
      var fov = Math.abs(pB - pA);

      if (!isFinite(ccA) || !isFinite(ccB) || !isFinite(pA) || !isFinite(pB)) {
        p.push("Planejamento inválido — refaça a faixa. (Um dos limites perdeu a referência de posição.)");
        return p;
      }
      if (ccB - ccA < MIN_GAP) {
        p.push("A faixa de varredura está invertida ou curta demais — arraste as linhas para cobrir a região de interesse.");
        return p;
      }
      if (pB - pA < MIN_GAP) {
        p.push("O FOV está invertido ou estreito demais.");
        return p;
      }

      var lim = (SimTC.FonteVolume && SimTC.FonteVolume.limitesAnatomicos(
        regiaoDoProtocolo(), fr ? "frontal" : "lateral"));
      if (!lim) return p;   // sem volume não há como validar; não inventa regra

      var ccMin = lim.cc[0] * 100, ccMax = lim.cc[1] * 100;
      var pMin = lim.perp[0] * 100, pMax = lim.perp[1] * 100;

      // Sobreposição da faixa com a anatomia disponível.
      var sobrepoe = Math.max(0, Math.min(ccB, ccMax) - Math.max(ccA, ccMin));
      if (sobrepoe <= 0) {
        p.push("A faixa está fora do paciente — não há anatomia nesse trecho do topograma.");
        return p;
      }
      var forcaAr = 1 - sobrepoe / faixa;
      if (forcaAr > 0.25) {
        p.push("Cerca de " + Math.round(forcaAr * 100) +
          "% da faixa está fora do paciente: seria irradiação sem imagem útil. Aproxime as linhas da anatomia.");
      }

      // O FOV precisa conter o paciente, senão a borda trunca.
      if (pA > pMin + 2 || pB < pMax - 2) {
        p.push("O FOV não cobre toda a largura do paciente — a borda seria truncada. Afaste as linhas do FOV.");
      }
      return p;
    }

    function renderReadout() {
      var probs = problems();
      var ok = probs.length === 0;
      if (topoBox) topoBox.classList.toggle("is-invalid", !ok);
      var gated = !!(SimTC.tableDriveApi && topoRef); // com 3D: exige mesa em posição
      if (phase === "plan") {
        startBtn.disabled = !ok || isMoving || (gated && !atStart);
        if (moveBtn) {
          moveBtn.hidden = !gated;
          moveBtn.disabled = !ok || isMoving;
          // Realça o MOVER quando é a próxima ação (faixa válida, mesa fora
          // de posição) e tira o realce do Iniciar até a mesa chegar.
          moveBtn.classList.toggle("ws-btn--primary", gated && ok && !atStart && !isMoving);
          startBtn.classList.toggle("ws-btn--primary", !(gated && !atStart));
        }
      }
      if (!readout) return;
      var cc = Math.max(0, rangeSpan()).toFixed(0);
      var ap = Math.max(0, fovSpan()).toFixed(0);
      var pp = protocolParams();
      var scoutTxt = pp.scout === "frontal" ? "frontal/AP" : "lateral";
      var fovLbl = pp.scout === "frontal" ? "FOV R-L" : "FOV A-P";
      var dirTxt = pp.direcao === "craniocaudal" ? "crânio-caudal (mesa entra)" : "caudo-cranial (mesa sai)";
      var msg = "Scout " + scoutTxt + " · Faixa CC: " + cc + "% · " + fovLbl + ": " + ap + "% · Direção: " + dirTxt + ". ";
      var okMsg;
      if (!(SimTC.tableDriveApi && topoRef)) okMsg = "Posição válida — Iniciar libera a aquisição.";
      else if (isMoving) okMsg = "Movendo a mesa para o início da faixa…";
      else if (atStart) okMsg = "Mesa em posição — Iniciar libera a aquisição.";
      else okMsg = "Faixa válida — use MOVER para levar a mesa ao início da varredura.";
      readout.innerHTML = ok
        ? msg + okMsg
        : msg + "<span class=\"is-bad\">" + probs[0] + "</span>";
    }

    // ---- arraste das 4 linhas ----
    function pctFromEvent(e, axis) {
      var r = topoImg.getBoundingClientRect();
      // Guarda contra elemento de dimensao ZERO (quadrante oculto, aba de
      // celular fora de vista, layout ainda nao medido). Sem ela a divisao
      // 0/0 devolve NaN, que contamina boxState e segue silenciosamente ate
      // o fim: o exame "conclui" com 0 cortes e DLP nulo, sem erro nenhum.
      var den = (axis === "y") ? r.height : r.width;
      if (!(den > 0)) return null;
      var v = (axis === "y") ? ((e.clientY - r.top) / den) * 100
                             : ((e.clientX - r.left) / den) * 100;
      return isFinite(v) ? v : null;
    }
    function clampPct(v) { return Math.min(100, Math.max(0, v)); }
    Array.prototype.forEach.call(lines, function (line) {
      var edge = line.getAttribute("data-edge");
      var axis = (edge === "top" || edge === "bottom") ? "y" : "x";
      line.addEventListener("pointerdown", function (e) {
        if (phase !== "plan") return;
        e.preventDefault(); e.stopPropagation();
        try { line.setPointerCapture(e.pointerId); } catch (err) {}
        function move(ev) {
          var pct = pctFromEvent(ev, axis);
          if (pct == null) return;          // sem geometria valida, ignora o arrasto
          boxState[edge] = clampPct(pct);   // nao impede cruzamento — a validacao bloqueia
          applyBox(); renderReadout();
        }
        function up() {
          try { line.releasePointerCapture(e.pointerId); } catch (err) {}
          line.removeEventListener("pointermove", move);
          line.removeEventListener("pointerup", up);
          line.removeEventListener("pointercancel", up);
          // Faixa mudou → a posição inicial mudou → exigir novo MOVER.
          if (atStart) { atStart = false; renderReadout(); }
        }
        line.addEventListener("pointermove", move);
        line.addEventListener("pointerup", up);
        line.addEventListener("pointercancel", up);
      });
    });

    // ---- fases e animações ----
    function stopAnimations() {
      if (topoAnim) { cancelAnimationFrame(topoAnim); topoAnim = null; }
      if (volTimer) { clearInterval(volTimer); volTimer = null; }
      soundStop();
      // Para a mesa se a aquisição estiver em curso. Os handlers onAbort
      // checam a fase — como ela já foi trocada, viram no-op (sem eco).
      if (SimTC.tableDriveApi && SimTC.tableDriveApi.isBusy && SimTC.tableDriveApi.isBusy()) SimTC.tableDriveApi.stop();
      // Desliga o arco de varredura (caso estivesse na aquisição estacionária
      // do step-and-shoot, sem uma mesa em movimento para pará-lo).
      if (SimTC.tableDriveApi && SimTC.tableDriveApi.setScan) SimTC.tableDriveApi.setScan(0);
    }
    function toIdle() {
      phase = "idle"; loaded = false; lastSlice = 0; lastAcq = null;
      if (ctrl) ctrl.classList.remove("is-acquiring");
      announcePhase("idle");
      topoRef = null; atStart = false; isMoving = false;
      protoExame = null;   // libera o protocolo ao encerrar
      if (SimTC.tableDriveApi && SimTC.tableDriveApi.setGantryTilt) SimTC.tableDriveApi.setGantryTilt(0);
      stopAnimations();
      img.hidden = true; ctrl.hidden = true;
      showVolOrient(false);
      if (topo) topo.hidden = true;
      if (topoBox) topoBox.hidden = true;
      if (readout) readout.hidden = true;
      placeholder.hidden = false;
      startBtn.disabled = false; startBtn.textContent = "Iniciar";
      if (moveBtn) moveBtn.hidden = true;
      if (reportBtn) reportBtn.hidden = true;
      if (reportEl) reportEl.hidden = true;
      hideConfirm();
      if (stopBtn) stopBtn.disabled = true;
      counter.textContent = "—";
      topoImg.style.clipPath = "";
      // Descarta o volume/reformatações e volta o viewer ao plano axial.
      plane = "axial"; vol = null; mprCache = {};
      if (SimTC.MotorImagem) { SimTC.MotorImagem.abortar(); SimTC.MotorImagem.limpar(); }
      motorPromessa = null; motorErro = null;
      renderSeletorSeries();
      if (planeEl) planeEl.hidden = true;
    }

    // Topograma com física real: tubo ESTACIONÁRIO, a MESA translada o
    // paciente pelo gantry e a imagem se revela em sincronia com a posição
    // real da mesa 3D, ao longo do eixo crânio-caudal.
    //   LATERAL (eixo CC horizontal, VÉRTICE à esquerda):
    //     crânio-caudal → mesa ENTRA (revela do vértice/esquerda p/ a base/direita)
    //     caudo-cranial → mesa SAI   (revela da base/direita p/ o vértice/esquerda)
    //   FRONTAL/AP (eixo CC vertical, VÉRTICE em cima):
    //     crânio-caudal → mesa ENTRA (revela do vértice/topo p/ a base/baixo)
    //     caudo-cranial → mesa SAI   (revela da base/baixo p/ o vértice/topo)
    function setTopoClip(k) {
      var pct = ((1 - k) * 100).toFixed(2);
      var pp = protocolParams();
      var cc = pp.direcao === "craniocaudal";
      if (pp.scout === "frontal") {
        topoImg.style.clipPath = cc
          ? "inset(0 0 " + pct + "% 0)"   // revela de cima (vértice) p/ baixo
          : "inset(" + pct + "% 0 0 0)";  // revela de baixo (base) p/ cima
      } else {
        topoImg.style.clipPath = cc
          ? "inset(0 " + pct + "% 0 0)"
          : "inset(0 0 0 " + pct + "%)";
      }
    }
    function toTopoAcq() {
      phase = "topoAcq";
      announcePhase("topoAcq");
      placeholder.hidden = true;
      img.hidden = true; ctrl.hidden = true;
      if (topo) topo.hidden = false;
      updateTopoOrient();                    // rótulos anatômicos já na varredura
      if (topoBox) topoBox.hidden = true;   // linhas só após completar
      if (readout) readout.hidden = true;
      startBtn.disabled = true; startBtn.textContent = "Adquirindo topograma…";
      if (stopBtn) stopBtn.disabled = false;
      setTopoClip(0);
      fitTopo();
      soundStart("topo", 0);
      if (SimTC.tableDriveApi) {
        var pp = protocolParams();
        var res = SimTC.tableDriveApi.start({
          distanceMm: topoLenMm(),
          direction: pp.direcao === "craniocaudal" ? "in" : "out",
          speedMmS: TOPO_SPEED_MMS,
          rotTimeS: 0, // scout: tubo estacionário, gantry não gira
          onProgress: function (k) { setTopoClip(k); },
          onDone: function () { soundStop(); toPlan(); },
          onAbort: function (motivo) {
            if (phase !== "topoAcq") return;
            soundStop(); toIdle();
            SimTC.showMessage("Topograma abortado: " + motivo, "warning");
          }
        });
        if (!res.ok) {
          soundStop(); toIdle();
          falhaMesa(res);
          return;
        }
        topoRef = { startZ: res.startZ, dir: pp.direcao, scout: pp.scout, isoOff: null };
        if (SimTC.tableDriveApi.getIsoOffsetCm) {
          var off = SimTC.tableDriveApi.getIsoOffsetCm();
          topoRef.isoOff = off;
          if (off != null && Math.abs(off) > 4) {
            SimTC.showMessage("Atenção: eixo do paciente ~" + Math.abs(off).toFixed(0) + " cm " +
              (off > 0 ? "acima" : "abaixo") + " do isocentro — no equipamento real o topograma LATERAL sai magnificado e o cálculo automático de dose é afetado. Ajuste a ALTURA da mesa.", "warning");
          }
        }
        return;
      }
      topoRef = null; // fallback: sem sincronia com a mesa
      // Fallback (cena 3D indisponível): varredura por tempo, como antes.
      var t0 = performance.now();
      function frame(now) {
        var k = Math.min(1, (now - t0) / TOPO_MS);
        setTopoClip(k);
        if (k < 1) { topoAnim = requestAnimationFrame(frame); }
        else { topoAnim = null; soundStop(); toPlan(); }
      }
      topoAnim = requestAnimationFrame(frame);
    }

    function toPlan(keepBox) {
      phase = "plan";
      if (ctrl) ctrl.classList.remove("is-acquiring");
      announcePhase("plan");
      topoImg.style.clipPath = "";
      if (topoBox) topoBox.hidden = false;
      if (readout) readout.hidden = false;
      if (!keepBox) {
        // Caixa inicial derivada da ANATOMIA do volume, não de constantes
        // calibradas para crânio (B-21). A faixa começa cobrindo o paciente
        // com uma folga, e o FOV o envolve com margem.
        var fr0 = isFrontal();
        var lm = (SimTC.FonteVolume && SimTC.FonteVolume.limitesAnatomicos(
          regiaoDoProtocolo(), fr0 ? "frontal" : "lateral"));
        if (lm) {
          var ccA = lm.cc[0] * 100, ccB = lm.cc[1] * 100;
          var folga = (ccB - ccA) * 0.08;          // recua 8% em cada ponta
          var c0 = Math.max(0, ccA + folga), c1 = Math.min(100, ccB - folga);

          // Faixa PADRAO da regiao, quando o acervo declara uma. Sem isso a
          // caixa cobria toda a anatomia do volume, e como Abdome, Pelve e
          // Coluna compartilham o volume de tronco, os tres protocolos
          // produziam exatamente o mesmo exame: o aluno escolhia diferente e
          // recebia igual. Os limites anatomicos continuam valendo como teto —
          // a faixa padrao e recortada para dentro deles.
          var Lv = topoLenMm();
          var fp = window.SimTCCore && window.SimTCCore.Acervo &&
                   window.SimTCCore.Acervo.faixaPadrao(regiaoDoProtocolo());
          if (fp && Lv > 0) {
            // mm no volume (0 = corte inferior) -> % do topograma (0 = superior)
            var p0 = (1 - fp.fimMm / Lv) * 100;
            var p1 = (1 - fp.inicioMm / Lv) * 100;
            p0 = Math.max(c0, Math.min(100, p0));
            p1 = Math.min(c1, Math.max(0, p1));
            if (p1 - p0 >= MIN_GAP) { c0 = p0; c1 = p1; }
          }

          var pA = Math.max(0, lm.perp[0] * 100 - 4);   // margem de 4% no FOV
          var pB = Math.min(100, lm.perp[1] * 100 + 4);
          boxState = fr0
            ? { top: c0, bottom: c1, left: pA, right: pB }
            : { top: pA, bottom: pB, left: c0, right: c1 };
        } else {
          var d = preset().def;
          boxState = { top: d.top, bottom: d.bottom, left: d.left, right: d.right };
        }
      }
      startBtn.disabled = false; startBtn.textContent = "Iniciar";
      atStart = false; isMoving = false;
      if (SimTC.tableDriveApi && SimTC.tableDriveApi.setGantryTilt) SimTC.tableDriveApi.setGantryTilt(protocolParams().tiltDeg);
      fitTopo();
      applyBox(); renderReadout(); // renderReadout pode voltar a travar o Iniciar
      if (stopBtn) stopBtn.disabled = false;
      if (!keepBox) SimTC.showMessage("Topograma adquirido — ajuste a faixa (base↔vértice) e o FOV, depois Iniciar.", "success");
    }

    // RELATÓRIO didático (fase de revisão): resume paciente, protocolo,
    // faixa/FOV, velocidade da mesa, isocentro e dose didática
    // (DLP = CTDIvol × comprimento). Sem validade clínica/dosimétrica.
    function buildReport() {
      var bodyEl = document.getElementById("ws-report-body");
      if (!bodyEl) return;
      var pac = (SimTC.examSessionApi && SimTC.examSessionApi.get) ? SimTC.examSessionApi.get() : null;
      var prot = protocoloVigente();
      var pp = (lastAcq && lastAcq.pp) || protocolParams();
      var scanLen = lastAcq ? lastAcq.scanLen : 0;
      var speed = lastAcq ? lastAcq.speed : 0;
      var dose = NaN;
      if (prot && prot.dose) {
        var m = String(prot.dose).replace(/,/g, ".").match(/\d+(\.\d+)?/);
        if (m) dose = parseFloat(m[0]);
      }
      var dlp = (dose > 0 && scanLen > 0) ? dose * (scanLen / 10) : NaN;
      var iso = topoRef ? topoRef.isoOff : null;
      var isoTxt = (iso == null)
        ? "não avaliado"
        : (Math.abs(iso) <= 4
          ? '<span class="is-good">no isocentro (' + iso.toFixed(1) + ' cm)</span>'
          : '<span class="is-bad">fora do isocentro (' + iso.toFixed(1) + ' cm) — magnificação no topograma lateral</span>');
      var rows = [];
      if (pac) rows.push("<strong>Paciente:</strong> " + esc(pac.nome) + " · " + (pac.prontuario ? "Pront. " + esc(pac.prontuario) : "s/ prontuário") + (pac.regiao ? " · " + esc(pac.regiao) : ""));
      var modoTxt = pp.modo === "sequencial" ? "axial sequencial" : "helicoidal";
      var tiltTxt = (pp.tiltDeg ? (", tilt " + pp.tiltDeg.toFixed(0) + "°") : "");
      var scoutTxt = pp.scout === "frontal" ? "topograma frontal/AP" : "topograma lateral";
      var fovLbl = pp.scout === "frontal" ? "FOV R-L" : "FOV A-P";
      rows.push("<strong>Protocolo:</strong> " + (prot ? esc(prot.nome) : "—") + " · " + scoutTxt + " · " + modoTxt + tiltTxt + " · direção " + (pp.direcao === "craniocaudal" ? "crânio-caudal (mesa entra)" : "caudo-cranial (mesa sai)"));
      rows.push("<strong>Faixa varrida:</strong> " + Math.round(scanLen) + " mm · <strong>" + fovLbl + ":</strong> " + Math.max(0, fovSpan()).toFixed(0) + "% da imagem");
      if (pp.modo === "sequencial") {
        rows.push("<strong>Mesa:</strong> passo a passo (step-and-shoot) · colimação " + pp.colim.toFixed(1) + " mm · rotação " + pp.rotacaoS.toFixed(1) + " s");
      } else {
        rows.push("<strong>Mesa:</strong> " + Math.round(speed) + " mm/s (pitch " + pp.pitch + " × colimação " + pp.colim.toFixed(1) + " mm ÷ rotação " + pp.rotacaoS.toFixed(1) + " s)");
      }
      rows.push("<strong>Posicionamento no isocentro:</strong> " + isoTxt);
      // ---- DOSE CALCULADA (Fase 6) ------------------------------------
      // Antes, o CTDIvol vinha de um TEXTO digitado no protocolo e lido por
      // expressao regular: mudar kV ou mAs nao mudava a dose, e um paciente
      // de 45 kg recebia o mesmo numero de um de 120 kg. Agora e calculado,
      // e o SSDE corrige pelo diametro efetivo medido no proprio volume.
      var dz = SimTC.MotorImagem && SimTC.MotorImagem.dose();
      if (dz && dz.ctdivol != null) {
        rows.push("<strong>CTDIvol:</strong> " + dz.ctdivol.toFixed(1) +
          " mGy <small>(fantoma de " + dz.fantomaCm + " cm · CTDIw ÷ pitch)</small>");
        rows.push("<strong>DLP:</strong> " + Math.round(dz.dlp) +
          " mGy·cm <small>(CTDIvol × " + (dz.comprimentoMm / 10).toFixed(1) + " cm)</small>");
        if (dz.ssdeMGy != null) {
          rows.push("<strong>SSDE:</strong> " + dz.ssdeMGy.toFixed(1) +
            " mGy <small>(diâmetro efetivo " + dz.diametroEfetivoCm.toFixed(1) +
            " cm · fator " + dz.fatorSSDE.toFixed(2) + " · AAPM 204)</small>");
          if (dz.ssdeMGy > dz.ctdivol * 1.1) {
            rows.push('<span class="is-bad">Paciente menor que o fantoma: a dose real é MAIOR que o CTDIvol indica.</span>');
          } else if (dz.ssdeMGy < dz.ctdivol * 0.9) {
            rows.push('<span class="is-good">Paciente maior que o fantoma: a dose real é menor que o CTDIvol indica.</span>');
          }
        }
        if (dz.doseEfetivaMSv != null) {
          rows.push("<strong>Dose efetiva (estimada):</strong> " + dz.doseEfetivaMSv.toFixed(2) +
            " mSv <small>(DLP × k = " + dz.kEfetiva + ", fator de conversão regional)</small>");
        }
        if (dz.drlDLP) {
          rows.push(dz.acimaDoDRL
            ? '<span class="is-bad">DLP acima do nível de referência didático da região (~' + dz.drlDLP + ' mGy·cm) — revise mAs, pitch ou faixa.</span>'
            : '<span class="is-good">DLP dentro do nível de referência didático (~' + dz.drlDLP + ' mGy·cm).</span>');
        }
      } else {
        rows.push("<strong>Dose:</strong> não calculada — informe kV e mAs no protocolo.");
      }
      var ae = SimTC.MotorImagem && SimTC.MotorImagem.aec();
      if (ae) rows.push("<strong>AEC:</strong> " + esc(ae.explicacao));
      // Alerta de pitch: no crânio helicoidal usa-se pitch < 1 para conter
      // ruído/dose; pitch > 1 é atípico. No sequencial o pitch não se aplica.
      if (pp.modo !== "sequencial" && pp.pitch > 1.0) {
        rows.push('<span class="is-bad">Pitch ' + pp.pitch + ' > 1 no crânio: aumenta o ruído; o usual é pitch < 1 (ou axial sequencial).</span>');
      }
      rows.push("<em>Valores didáticos para treinamento de operação — sem validade clínica ou dosimétrica.</em>");
      bodyEl.innerHTML = rows.join("<br>");
    }

    // MOVER — leva a mesa 3D até a posição inicial da faixa planejada
    // (como o comando de posicionamento do equipamento real). Só então o
    // Iniciar libera o volume; mexer nas linhas exige mover de novo.
    function onMove() {
      if (phase !== "plan" || !SimTC.tableDriveApi || isMoving) return;
      if (problems().length) { renderReadout(); return; }
      var zs = volumeStartZ();
      if (zs == null) return;
      var cur = SimTC.tableDriveApi.getPos();
      var distMm = Math.abs(zs - cur) * 1000;
      if (distMm < 2) {
        atStart = true; renderReadout();
        SimTC.showMessage("Mesa já está na posição inicial da faixa.", "info");
        return;
      }
      isMoving = true;
      announcePhase("moving");
      renderReadout();
      soundStart("topo", 0);
      var res = SimTC.tableDriveApi.start({
        distanceMm: distMm,
        direction: zs < cur ? "in" : "out",
        speedMmS: 100,
        rotTimeS: 0,
        label: "POSICIONANDO MESA",
        onDone: function () {
          soundStop(); isMoving = false;
          announcePhase("plan");
          // Se as linhas mudaram durante o movimento, a posição já não vale.
          var alvo = volumeStartZ();
          atStart = alvo != null && Math.abs(SimTC.tableDriveApi.getPos() - alvo) * 1000 < 3;
          renderReadout();
          SimTC.showMessage(atStart
            ? "Mesa na posição inicial da faixa — Iniciar libera a aquisição."
            : "A faixa foi alterada durante o movimento — use MOVER novamente.", atStart ? "success" : "warning");
        },
        onAbort: function (motivo) {
          if (phase !== "plan") return;
          soundStop(); isMoving = false; atStart = false;
          announcePhase("plan");
          renderReadout();
          SimTC.showMessage("Movimentação interrompida: " + motivo, "warning");
        }
      });
      if (!res.ok) {
        soundStop(); isMoving = false;
        announcePhase("plan");
        renderReadout();
        falhaMesa(res);
      }
    }

    // Volume HELICOIDAL com física real: a mesa 3D avança continuamente
    // (v = pitch × colimação ÷ tempo de rotação) enquanto o gantry "gira"
    // (arco luminoso no bore + som); os cortes aparecem em sincronia com a
    // posição real da mesa, na ordem da direção programada no protocolo.
    // Premissa didática: axial_000 = corte mais INFERIOR (base) — a ordem
    // inverte no crânio-caudal. Validação clínica do usuário.
    function toVolAcq() {
      phase = "volAcq"; loaded = false;
      announcePhase("volAcq");
      hideConfirm();
      if (topo) topo.hidden = true;
      if (readout) readout.hidden = true;
      img.hidden = false; ctrl.hidden = false;
      showVolOrient(true);
      slider.disabled = true;
      startBtn.disabled = true; startBtn.textContent = "Adquirindo volume…";
      if (moveBtn) moveBtn.hidden = true;
      if (reportBtn) reportBtn.hidden = true;
      if (reportEl) reportEl.hidden = true;
      if (stopBtn) stopBtn.disabled = false;
      var total = manifest.cortes;
      var pp = protocolParams();
      // Comprimento da varredura = faixa CC planejada no topograma (mm)
      var scanLen = Math.max(20, (rangeSpan() / 100) * topoLenMm());
      var speed = Math.max(10, Math.min(120, (pp.pitch * pp.colim) / pp.rotacaoS)); // mm/s
      lastAcq = { scanLen: scanLen, speed: speed, pp: pp };

      // ---- DISPARA O MOTOR -------------------------------------------
      // A mesa 3D anda enquanto o Worker projeta e reconstroi: o aluno ve o
      // equipamento trabalhando e o calculo nao trava a interface.
      motorPromessa = null; motorErro = null;
      if (SimTC.MotorImagem && SimTC.MotorImagem.disponivel() &&
          volSource.kind === "volume" && SimTC.FonteVolume) {
        var pr = paramsReconstrucao();
        var faixa = faixaEmMm();
        if (!isFinite(faixa.inicioMm) || !isFinite(faixa.fimMm) ||
            !(Math.abs(faixa.fimMm - faixa.inicioMm) > 1)) {
          SimTC.showMessage("Faixa de varredura inválida — refaça o planejamento antes de iniciar.", "error");
          toPlan(true);
          return;
        }
        var idVol = window.SimTCCore.Acervo.volumeDaRegiao(regiaoDoProtocolo());
        motorPromessa = SimTC.MotorImagem.executar({
          regiaoId: idVol,
          plano: faixa,
          aquisicao: {
            kv: pr.protocolo.aquisicao.kv || 120,
            mas: pr.protocolo.aquisicao.mas || 200,
            pitch: pr.protocolo.aquisicao.pitch,
            modo: pr.protocolo.aquisicao.modo
          },
          reconstrucoes: pr.reconstrucoes,
          regiao: regiaoDoProtocolo(),
          aec: pr.protocolo.dose && pr.protocolo.dose.aec && pr.protocolo.dose.aec.ativo
            ? { ativo: true, alfa: 0.6 } : null,
          // Amostragem bruta limitada. Projetar e caro: cada linha de
          // detector custa ~120 vistas x 160 canais x ~360 amostras. Sem
          // teto, uma faixa de 156 mm com linhas de 1,25 mm daria 125
          // projecoes e o exame levaria minutos no navegador.
          //
          // O preco e honesto e precisa ser dito ao operador: a espessura
          // minima reconstruivel fica limitada pela linha efetiva.
          qualidade: {
            vistas: 120,
            resolucao: 128,
            linhaMm: Math.max(
              (SimTC.FonteVolume.volume(regiaoDoProtocolo()) || {spacingMm:[1,1,1]}).spacingMm[2],
              Math.abs(faixa.fimMm - faixa.inicioMm) / 48
            )
          },
          aoProgresso: function (m) {
            if (phase !== "volAcq" && phase !== "recon") return;
            if (m.etapa === "irradiando") {
              counter.textContent = "IRRADIANDO — linha " + m.feito + " / " + m.total;
            } else {
              counter.textContent = "RECONSTRUINDO “" + m.serie + "” — corte " +
                m.feito + " / " + m.total;
            }
          }
        }).catch(function (e) { motorErro = e; });
      }

      function paintProg(k) {
        var idx = Math.round(k * (total - 1));
        var n = (pp.direcao === "craniocaudal") ? (total - 1 - idx) : idx;
        lastSlice = n;
        img.src = srcFor(n);
        slider.value = n;
        counter.textContent = "ADQUIRINDO — corte " + (idx + 1) + " / " + total +
          " · mesa a " + Math.round(speed) + " mm/s";
      }
      if (ctrl) ctrl.classList.add("is-acquiring");
      paintProg(0);
      // Modo AXIAL SEQUENCIAL (step-and-shoot): a mesa avança em passos; a
      // cada parada o gantry gira e adquire um grupo de cortes (feixe só com
      // a mesa parada). Fisicamente distinto do helicoidal.
      if (pp.modo === "sequencial" && SimTC.tableDriveApi) {
        runSequential(pp, total, scanLen);
        return;
      }
      soundStart("vol", pp.rotacaoS);
      if (SimTC.tableDriveApi) {
        var res = SimTC.tableDriveApi.start({
          distanceMm: scanLen,
          direction: pp.direcao === "craniocaudal" ? "in" : "out",
          speedMmS: speed,
          rotTimeS: pp.rotacaoS, // liga o arco de varredura girando no bore
          onProgress: function (k) { paintProg(k); },
          onDone: function () { soundStop(); toRecon(); },
          onAbort: function (motivo) {
            if (phase !== "volAcq") return;
            soundStop(); toPlan(true);
            SimTC.showMessage("Aquisição do volume abortada: " + motivo, "warning");
          }
        });
        if (!res.ok) {
          soundStop(); toPlan(true);
          falhaMesa(res);
        }
        return;
      }
      // Fallback (cena 3D indisponível): corte a corte por tempo.
      var i = 0;
      var stepMs = Math.max(30, Math.round(VOL_MS / total));
      volTimer = setInterval(function () {
        i++;
        if (i >= total) {
          clearInterval(volTimer); volTimer = null;
          soundStop();
          toRecon();
          return;
        }
        paintProg(i / (total - 1));
      }, stepMs);

      // ---- aquisição AXIAL SEQUENCIAL (step-and-shoot) ----
      // steps ≈ comprimento ÷ colimação (grupos de cortes por rotação). A cada
      // passo: ADQUIRE (mesa parada, arco girando, revela o grupo) e AVANÇA a
      // mesa (arco desligado) até o próximo. Hoisted — usada acima.
      function runSequential(pp, total, scanLen) {
        var steps = Math.max(3, Math.min(12, Math.round(scanLen / Math.max(5, pp.colim))));
        var dir = pp.direcao === "craniocaudal" ? "in" : "out";
        var stepLenMm = scanLen / steps;
        var acqMsPerStep = 700; // duração didática da rotação estacionária
        var s = 0;
        function sliceEndForStep(st) { return Math.min(total - 1, Math.round((st + 1) / steps * (total - 1))); }
        function paintSeq(idx, stepNum, moving) {
          var n = (pp.direcao === "craniocaudal") ? (total - 1 - idx) : idx;
          lastSlice = n;
          img.src = srcFor(n);
          slider.value = n;
          counter.textContent = (moving ? "AVANÇANDO MESA" : "ADQUIRINDO") +
            " — passo " + stepNum + " / " + steps + " · corte " + (idx + 1) + " / " + total;
        }
        function acquireStep() {
          if (phase !== "volAcq") return;
          var startIdx = (s === 0) ? 0 : (sliceEndForStep(s - 1) + 1);
          var endIdx = sliceEndForStep(s);
          if (endIdx < startIdx) endIdx = startIdx;
          if (SimTC.tableDriveApi.setScan) SimTC.tableDriveApi.setScan(pp.rotacaoS); // arco gira, mesa parada
          soundStart("vol", pp.rotacaoS);
          var i = startIdx;
          var span = Math.max(1, endIdx - startIdx);
          var tickMs = Math.max(40, Math.round(acqMsPerStep / (span + 1)));
          paintSeq(startIdx, s + 1, false);
          volTimer = setInterval(function () {
            if (phase !== "volAcq") { clearInterval(volTimer); volTimer = null; return; }
            i++;
            if (i > endIdx) {
              clearInterval(volTimer); volTimer = null;
              if (SimTC.tableDriveApi.setScan) SimTC.tableDriveApi.setScan(0);
              soundStop();
              moveOrFinish();
              return;
            }
            paintSeq(i, s + 1, false);
          }, tickMs);
        }
        function moveOrFinish() {
          if (phase !== "volAcq") return;
          if (s >= steps - 1) { toRecon(); return; }
          soundStart("topo", 0); // zumbido de mesa em movimento (sem feixe)
          var res = SimTC.tableDriveApi.start({
            distanceMm: stepLenMm,
            direction: dir,
            speedMmS: 80,
            rotTimeS: 0,
            label: "AVANÇANDO MESA",
            onProgress: function () { counter.textContent = "AVANÇANDO MESA — passo " + (s + 2) + " / " + steps; },
            onDone: function () { soundStop(); s++; acquireStep(); },
            onAbort: function (motivo) {
              if (phase !== "volAcq") return;
              soundStop(); if (SimTC.tableDriveApi.setScan) SimTC.tableDriveApi.setScan(0);
              toPlan(true);
              SimTC.showMessage("Aquisição sequencial abortada: " + motivo, "warning");
            }
          });
          if (!res.ok) {
            soundStop(); if (SimTC.tableDriveApi.setScan) SimTC.tableDriveApi.setScan(0);
            toPlan(true);
            falhaMesa(res, " (série sequencial: reposicione a mesa com mais curso).");
          }
        }
        acquireStep();
      }
    }

    // ---- RECONSTRUÇÃO + MPR (reformatações coronal/sagital) ----
    // Após a aquisição, monta um volume a partir da pilha axial (desenhando
    // cada PNG num canvas offscreen e lendo os pixels), permitindo cortar o
    // volume em coronal e sagital no navegador — sem novos assets. Se algo
    // falhar (canvas "tainted", memória), segue só com o axial.
    var planeEl = document.getElementById("ws-plane");
    function spacing() {
      var sp = (manifest && manifest.espacamento_mm) || {};
      return { x: +sp.x || 0.4297, y: +sp.y || 0.4297, z: +sp.z || 2.528 };
    }
    function buildVolume(done) {
      try {
        var Z = manifest.cortes;
        var W = 256; // subamostragem para caber em memória e ser fluido
        var scale = W / (manifest.largura || 512);
        var H = Math.max(1, Math.round((manifest.altura || 507) * scale));
        var cvs = document.createElement("canvas"); cvs.width = W; cvs.height = H;
        var cx = cvs.getContext("2d", { willReadFrequently: true });
        var slices = new Array(Z);
        var loadedN = 0, failed = false;
        for (var z = 0; z < Z; z++) {
          (function (z) {
            var im = new Image();
            im.onload = function () {
              try {
                cx.drawImage(im, 0, 0, W, H);
                var d = cx.getImageData(0, 0, W, H).data;
                var g = new Uint8Array(W * H);
                for (var p = 0, q = 0; p < d.length; p += 4, q++) g[q] = d[p];
                slices[z] = g;
              } catch (e) { failed = true; }
              if (++loadedN === Z) finish();
            };
            im.onerror = function () { failed = true; if (++loadedN === Z) finish(); };
            im.src = srcFor(z);
          })(z);
        }
        function finish() {
          if (failed) { vol = null; done(false); return; }
          var sp = spacing();
          vol = { W: W, H: H, Z: Z, slices: slices, spX: sp.x, spY: sp.y, spZ: sp.z };
          done(true);
        }
      } catch (e) { vol = null; done(false); }
    }
    function buildReformat(pl, idx) {
      if (!vol) return null;
      var key = pl + ":" + idx;
      if (mprCache[key]) return mprCache[key];
      var W = vol.W, H = vol.H, Z = vol.Z;
      var Xmm = (manifest.largura || 512) * vol.spX;
      var Ymm = (manifest.altura || 507) * vol.spY;
      var Zmm = Z * vol.spZ;
      var raw = document.createElement("canvas"), out = document.createElement("canvas");
      var url;
      if (pl === "coronal") {
        raw.width = W; raw.height = Z;
        var rc = raw.getContext("2d");
        var id = rc.createImageData(W, Z);
        for (var z = 0; z < Z; z++) {
          var row = Z - 1 - z; // z=0 (base) fica embaixo; vértice no topo
          var s = vol.slices[z]; if (!s) continue;
          for (var x = 0; x < W; x++) {
            var v = s[idx * W + x], o = (row * W + x) * 4;
            id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255;
          }
        }
        rc.putImageData(id, 0, 0);
        out.width = W; out.height = Math.max(1, Math.round(W * Zmm / Xmm));
        var oc = out.getContext("2d"); oc.imageSmoothingEnabled = true;
        oc.drawImage(raw, 0, 0, W, Z, 0, 0, out.width, out.height);
        url = out.toDataURL();
      } else { // sagital
        raw.width = Z; raw.height = H;
        var rc2 = raw.getContext("2d");
        var id2 = rc2.createImageData(Z, H);
        for (var y = 0; y < H; y++) {
          for (var z2 = 0; z2 < Z; z2++) {
            var col = Z - 1 - z2;
            var s2 = vol.slices[z2]; if (!s2) continue;
            var v2 = s2[y * W + idx], o2 = (y * Z + col) * 4;
            id2.data[o2] = id2.data[o2 + 1] = id2.data[o2 + 2] = v2; id2.data[o2 + 3] = 255;
          }
        }
        rc2.putImageData(id2, 0, 0);
        out.width = Math.max(1, Math.round(H * Zmm / Ymm)); out.height = H;
        var oc2 = out.getContext("2d"); oc2.imageSmoothingEnabled = true;
        oc2.drawImage(raw, 0, 0, Z, H, 0, 0, out.width, out.height);
        url = out.toDataURL();
      }
      mprCache[key] = url;
      return url;
    }
    function planeMax() {
      if (plane === "coronal") return (vol ? vol.H : 1) - 1;
      if (plane === "sagital") return (vol ? vol.W : 1) - 1;
      return (manifest ? manifest.cortes : 1) - 1;
    }
    function showReformat(i) {
      if (!vol) { show(i); return; }
      var maxI = planeMax();
      i = Math.max(0, Math.min(maxI, i | 0));
      var url = buildReformat(plane, i);
      if (url) img.src = url;
      slider.value = i;
      counter.textContent = (plane === "coronal" ? "Coronal " : "Sagital ") + (i + 1) + " / " + (maxI + 1);
    }
    function render(i) {
      if (plane === "axial") show(i);
      else showReformat(i);
    }
    function setPlane(pl) {
      if (pl !== "axial" && !vol) return; // sem volume, só axial
      plane = pl;
      if (planeEl) {
        Array.prototype.forEach.call(planeEl.querySelectorAll(".ws-plane__btn"), function (b) {
          b.classList.toggle("is-active", b.getAttribute("data-plane") === pl);
        });
      }
      var maxI = planeMax();
      slider.min = 0; slider.max = maxI;
      var mid = Math.round(maxI / 2);
      render(mid);
      updateVolOrient();
    }

    // Passo de RECONSTRUÇÃO entre a aquisição e a revisão. Monta o volume
    // (habilita coronal/sagital) exibindo "Reconstruindo…"; ao terminar,
    // segue para a revisão. Falha ao montar → revisão só com axial.
    function toRecon() {
      phase = "recon";
      if (ctrl) ctrl.classList.remove("is-acquiring");
      announcePhase("volAcq"); // painel mantém "Volume" ativo durante a recon
      mprCache = {};
      slider.disabled = true;
      startBtn.disabled = true; startBtn.textContent = "Reconstruindo…";
      counter.textContent = "Reconstruindo volume…";
      SimTC.showMessage("Reconstruindo o volume…", "info");

      // Espera o motor terminar antes de revisar. Sem isto a revisao abriria
      // com os cortes do volume direto e o exame pareceria nao ter reagido
      // aos parametros — que era exatamente o defeito B-02.
      var espera = motorPromessa || Promise.resolve(null);
      espera.then(function () {
        // A espessura entregue pode ser MAIOR que a pedida: a amostragem
        // bruta tem teto (custo de projecao), e nenhuma serie pode ser mais
        // fina que a linha de detector efetiva. Dizer isso, em vez de
        // exibir 2,5 mm no protocolo e 4,35 mm na serie sem explicacao.
        if (!motorErro && SimTC.MotorImagem && SimTC.MotorImagem.temSeries()) {
          var pedidas = paramsReconstrucao().reconstrucoes;
          var obtidas = SimTC.MotorImagem.series();
          var limitadas = [];
          for (var q = 0; q < obtidas.length; q++) {
            var ped = pedidas[q] && pedidas[q].espessuraMm;
            if (ped && obtidas[q].espessuraMm > ped * 1.05) {
              limitadas.push(obtidas[q].nome + " (" + ped + " → " +
                obtidas[q].espessuraMm.toFixed(2) + " mm)");
            }
          }
          if (limitadas.length) {
            SimTC.showMessage("Espessura limitada pela amostragem desta versão: " +
              limitadas.join(", ") + ". Reduza a faixa planejada para obter cortes mais finos.", "warning");
          }
        }
        // Abortar pelo Stop nao e falha: nao apresentar como tal.
        if (motorErro && !/abortad/i.test(motorErro.message)) {
          SimTC.showMessage("Reconstrução indisponível (" + motorErro.message +
            ") — exibindo os cortes do volume.", "warning");
        }
        buildVolume(function () { if (phase === "recon") toReview(); });
      });
    }

    function toReview() {
      phase = "review";
      if (ctrl) ctrl.classList.remove("is-acquiring");
      announcePhase("review");
      buildReport();
      // O relatório NÃO cobre a imagem automaticamente — foco no exame;
      // fica disponível no botão destacado.
      if (reportEl) reportEl.hidden = true;
      if (reportBtn) { reportBtn.hidden = false; reportBtn.classList.add("ws-btn--primary"); } loaded = true;
      var btnDicom = document.getElementById("ws-exam-dicom");
      if (btnDicom) btnDicom.hidden = !(SimTC.ExportarDicom && SimTC.ExportarDicom.disponivel());
      slider.disabled = false;
      startBtn.disabled = true; startBtn.textContent = "Exame adquirido";
      if (stopBtn) stopBtn.disabled = false;
      // Seletor de plano só quando o volume reconstruiu (MPR disponível).
      if (planeEl) planeEl.hidden = !vol;
      plane = "axial";
      if (planeEl) {
        Array.prototype.forEach.call(planeEl.querySelectorAll(".ws-plane__btn"), function (b) {
          b.classList.toggle("is-active", b.getAttribute("data-plane") === "axial");
        });
      }
      var totalRev = totalCortes();
      slider.min = 0; slider.max = Math.max(0, totalRev - 1);
      if (lastSlice > totalRev - 1) lastSlice = Math.floor(totalRev / 2);
      renderSeletorSeries();
      show(lastSlice);
      showVolOrient(true);
      // Arquiva o exame realizado (B-20): o estudo passa a existir depois
      // que a aquisicao termina, e fica disponivel em "Exames realizados".
      if (SimTC.examSessionApi && SimTC.examSessionApi.arquivar) {
        var protArq = protocoloVigente();
        var ppArq = (lastAcq && lastAcq.pp) || protocolParams();
        var doseArq = NaN;
        if (protArq && protArq.dose) {
          var mArq = String(protArq.dose).replace(/,/g, ".").match(/\d+(\.\d+)?/);
          if (mArq) doseArq = parseFloat(mArq[0]);
        }
        var lenArq = lastAcq ? lastAcq.scanLen : 0;
        SimTC.examSessionApi.arquivar({
          regiao: protArq ? protArq.regiao : "",
          protocoloNome: protArq ? protArq.nome : "",
          modo: ppArq.modo,
          faixaMm: lenArq,
          cortes: manifest ? manifest.cortes : null,
          dlp: (doseArq > 0 && lenArq > 0) ? doseArq * (lenArq / 10) : null,
          isoOffsetCm: topoRef ? topoRef.isoOff : null
        });
      }

      SimTC.showMessage("Aquisição concluída (" + totalCortes() + " cortes)" +
        (vol ? " — reformatações coronal/sagital disponíveis." : ".") + " Navegue e finalize com Stop.", "success");
    }

    slider.addEventListener("input", function () { if (loaded) render(parseInt(slider.value, 10) || 0); });
    box.addEventListener("wheel", function (e) {
      if (!loaded) return;
      e.preventDefault();
      render((parseInt(slider.value, 10) || 0) + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });
    if (planeEl) planeEl.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".ws-plane__btn") : null;
      if (!b || !loaded) return;
      setPlane(b.getAttribute("data-plane"));
    });

    // API do ambiente de processamento. Além das reformatações simples usadas
    // internamente, exporta a aquisição para a workstation Leitor-Dicon. Como
    // os assets do simulador são PNG já janelados, os HU enviados são uma
    // aproximação inversa da janela de exibição — adequada ao treinamento de
    // ferramentas, mas explicitamente sem valor diagnóstico/dosimétrico.
    /**
     * Monta o payload para o leitor DICOM a partir da SERIE RECONSTRUIDA.
     *
     * A ponte enviava o volume-fonte inteiro com HU derivados por aproximacao
     * inversa da janela — a faixa chegava ao leitor como -160..+239 e ainda
     * declarada `unidadeHU: true`. Era o B-05 sobrevivendo no unico lugar onde
     * o aluno mede HU. Agora vai a serie que o motor produziu, com HU reais e
     * a geometria que a reconstrucao definiu.
     */
    function payloadDaSerieReconstruida() {
      var M = SimTC.MotorImagem;
      if (!M || !M.temSeries()) return null;
      var s = M.serieAtual();
      var n = s.matriz, nz = s.cortes;
      // Copia: o buffer e transferido ao Worker do leitor e nao pode ser o
      // mesmo que a tela continua usando para desenhar.
      var dados = new Int16Array(s.hu.length);
      dados.set(s.hu);
      var mn = 32767, mx = -32768;
      for (var i = 0; i < dados.length; i++) { if (dados[i] < mn) mn = dados[i]; if (dados[i] > mx) mx = dados[i]; }
      var pac = (SimTC.examSessionApi && SimTC.examSessionApi.get()) || null;
      var prot = protocoloVigente();
      var dz = M.dose();
      return {
        buffer: dados.buffer,
        dims: [n, n, nz],
        espacamento: [s.pixelMm, s.pixelMm, s.incrementoMm],
        origem: [0, 0, s.posicoesMm ? s.posicoesMm[0] : 0],
        minimo: mn, maximo: mx,
        janela: { centro: M.janela().wl, largura: M.janela().ww },
        modalidade: "CT",
        descricaoSerie: s.nome + " · " + s.espessuraMm + " mm · kernel " + s.kernel,
        descricaoEstudo: prot && prot.nome ? prot.nome : "Simulação educacional de TC",
        fabricante: "Simulador TC Educacional",
        idPaciente: pac && pac.prontuario ? pac.prontuario : "SIMULADO",
        sintaxe: "Volume reconstruído por retroprojeção filtrada",
        numFatias: nz,
        unidadeHU: true,   // agora é verdade: são HU reconstruídos
        inverterMonocromatico: false,
        label: pac && pac.nome ? pac.nome : "Exame simulado",
        notes: "HU reconstruídos por FBP a partir de projeções com ruído de Poisson" +
          (dz && dz.ctdivol != null ? " · CTDIvol " + dz.ctdivol.toFixed(1) + " mGy" : "") +
          ". Uso educacional — sem valor diagnóstico.",
        attribution: (manifest && manifest.fonte) ? manifest.fonte.nome : "Simulador TC Educacional"
      };
    }

    SimTC.mprApi = {
      hasVolume: function () {
        return !!(SimTC.MotorImagem && SimTC.MotorImagem.temSeries()) || !!vol;
      },
      count: function (pl) {
        var M = SimTC.MotorImagem;
        if (M && M.temSeries()) {
          var s2 = M.serieAtual();
          if (pl === "coronal" || pl === "sagital") return s2.matriz;
          return s2.cortes;
        }
        if (pl === "coronal") return vol ? vol.H : 0;
        if (pl === "sagital") return vol ? vol.W : 0;
        return manifest ? manifest.cortes : 0;
      },
      reformat: function (pl, idx) { return buildReformat(pl, idx); },
      exportVolume: function () {
        var daSerie = payloadDaSerieReconstruida();
        if (daSerie) return daSerie;
        if (!vol) return null;
        var janela = (manifest && manifest.janela_exibicao) || {};
        var wl = Number(janela.wl); if (!isFinite(wl)) wl = 40;
        var ww = Number(janela.ww); if (!isFinite(ww) || ww < 1) ww = 400;
        var baixo = wl - 0.5 - (ww - 1) / 2;
        var dados = new Int16Array(vol.W * vol.H * vol.Z);
        var minimo = 32767, maximo = -32768, o = 0;
        for (var z = 0; z < vol.Z; z++) {
          var fatia = vol.slices[z];
          for (var i = 0; i < fatia.length; i++, o++) {
            var hu = Math.round(baixo + (fatia[i] / 255) * (ww - 1));
            hu = Math.max(-32768, Math.min(32767, hu));
            dados[o] = hu;
            if (hu < minimo) minimo = hu;
            if (hu > maximo) maximo = hu;
          }
        }
        var pac = (SimTC.examSessionApi && SimTC.examSessionApi.get) ? SimTC.examSessionApi.get() : null;
        var prot = SimTC.examProtocol ? SimTC.examProtocol.data : null;
        return {
          buffer: dados.buffer,
          dims: [vol.W, vol.H, vol.Z],
          espacamento: [vol.spX, vol.spY, vol.spZ],
          origem: [0, 0, 0],
          minimo: minimo,
          maximo: maximo,
          janela: { centro: wl, largura: ww },
          modalidade: "CT",
          descricaoSerie: (manifest && manifest.nome ? manifest.nome : "Exame") + " — aquisição simulada",
          descricaoEstudo: prot && prot.nome ? prot.nome : "Simulação educacional de TC",
          fabricante: "Simulador TC Educacional",
          idPaciente: pac && pac.prontuario ? pac.prontuario : "SIMULADO",
          sintaxe: "Volume didático reconstruído de PNG",
          numFatias: vol.Z,
          unidadeHU: true,
          inverterMonocromatico: false,
          label: pac && pac.nome ? pac.nome : "Exame simulado",
          notes: "HU aproximados a partir de imagens PNG já janeladas; use somente para treinamento das ferramentas.",
          attribution: manifest && manifest.fonte ? manifest.fonte.nome : "Simulador TC Educacional"
        };
      }
    };

    // Iniciar é contextual: em idle adquire o topograma; em plan (com a
    // caixa válida — senão fica travado) inicia a aquisição do volume.
    // Confirmação pré-aquisição: resumo do exame + checklist de segurança
    // (paciente, posicionamento, faixa/FOV, isocentro) antes de irradiar.
    function buildConfirm() {
      var bodyEl = document.getElementById("ws-confirm-body");
      if (!bodyEl) return;
      var pac = (SimTC.examSessionApi && SimTC.examSessionApi.get) ? SimTC.examSessionApi.get() : null;
      var prot = protocoloVigente();
      var pp = protocolParams();
      var scanLen = Math.max(20, (rangeSpan() / 100) * topoLenMm());
      var dose = NaN;
      if (prot && prot.dose) { var m = String(prot.dose).replace(/,/g, ".").match(/\d+(\.\d+)?/); if (m) dose = parseFloat(m[0]); }
      var dlp = (dose > 0) ? dose * (scanLen / 10) : NaN;
      var iso = (SimTC.tableDriveApi && SimTC.tableDriveApi.getIsoOffsetCm) ? SimTC.tableDriveApi.getIsoOffsetCm() : null;
      function chk(ok, txt) { return '<span class="' + (ok ? "is-good" : "is-bad") + '">' + (ok ? "✓" : "⚠") + " " + txt + "</span>"; }
      var modoTxt = pp.modo === "sequencial" ? "axial sequencial" : "helicoidal";
      var rows = [];
      rows.push("<strong>Paciente:</strong> " + (pac ? esc(pac.nome) + (pac.prontuario ? " · Pront. " + esc(pac.prontuario) : "") : "—"));
      var scoutTxt = pp.scout === "frontal" ? "frontal/AP" : "lateral";
      var fovLbl = pp.scout === "frontal" ? "FOV R-L" : "FOV A-P";
      rows.push("<strong>Protocolo:</strong> " + (prot ? esc(prot.nome) : "—") + " · scout " + scoutTxt + " · " + modoTxt + (pp.tiltDeg ? (", tilt " + pp.tiltDeg.toFixed(0) + "°") : "") + " · " + (pp.direcao === "craniocaudal" ? "crânio-caudal" : "caudo-cranial"));
      rows.push("<strong>Faixa:</strong> " + Math.round(scanLen) + " mm · <strong>" + fovLbl + ":</strong> " + Math.max(0, fovSpan()).toFixed(0) + "%");
      if (!isNaN(dlp)) rows.push("<strong>Dose estimada:</strong> DLP ≈ " + dlp.toFixed(0) + " mGy·cm");
      rows.push("<br><strong>Checklist pré-aquisição</strong>");
      rows.push(chk(!!pac, "Paciente cadastrado"));
      rows.push(chk(!SimTC.tableDriveApi || SimTC.tableDriveApi.isPatientOnTable(), "Paciente posicionado na mesa"));
      rows.push(chk(problems().length === 0, "Faixa e FOV válidos"));
      if (iso != null) rows.push(chk(Math.abs(iso) <= 4, "Isocentro (" + iso.toFixed(1) + " cm do centro)"));
      // ---- ACHADOS DO MOTOR DE VALIDACAO (Fase 10) ---------------------
      // Confirmacao INFORMADA, nao bloqueio: o aluno ve a consequencia
      // prevista e decide. So ERRO impede — e erro aqui significa
      // incoerencia interna ou impossibilidade fisica, nao opiniao.
      var vd = validarExameAtual();
      if (vd) {
        if (vd.erros.length) {
          rows.push("<br><strong>Impedimentos</strong>");
          vd.erros.forEach(function (a) {
            rows.push('<span class="is-bad">⛔ ' + esc(a.texto) + '</span>' +
              (a.consequencia ? '<br><small>' + esc(a.consequencia) + '</small>' : ""));
          });
        }
        if (vd.avisos.length) {
          rows.push("<br><strong>Consequências previstas</strong>");
          vd.avisos.forEach(function (a) {
            rows.push('<span class="is-warn">⚠ ' + esc(a.texto) + '</span>' +
              (a.consequencia ? '<br><small>' + esc(a.consequencia) + '</small>' : ""));
          });
        }
        if (vd.infos.length) {
          vd.infos.forEach(function (a) {
            rows.push('<small>ℹ ' + esc(a.texto) +
              (a.consequencia ? " — " + esc(a.consequencia) : "") + '</small>');
          });
        }
      }
      rows.push("<em>Confira antes de irradiar — treinamento de operação.</em>");
      bodyEl.innerHTML = rows.join("<br>");
    }
    /**
     * Roda o motor de validacao sobre o protocolo e o plano atuais.
     * Devolve null quando o nucleo nao esta disponivel — a tela nunca inventa
     * regra propria.
     */
    function validarExameAtual() {
      var Core = window.SimTCCore;
      if (!Core || !Core.validacao) return null;
      var cru = protocoloVigente();
      if (!cru) return null;
      var pr = Core.model.normalizarProtocolo(cru);
      var faixa = faixaEmMm();
      var vol = SimTC.FonteVolume && SimTC.FonteVolume.volume(regiaoDoProtocolo());
      var lim = vol && SimTC.FonteVolume.limitesAnatomicos(regiaoDoProtocolo(), isFrontal() ? "frontal" : "lateral");
      var larguraPac = (vol && lim) ? (lim.perp[1] - lim.perp[0]) * vol.extentMm()[0] : null;
      var comprimento = Math.abs(faixa.fimMm - faixa.inicioMm);
      var dlpPrev = null;
      if (Core.dose && pr.aquisicao.kv != null && pr.aquisicao.mas != null && comprimento > 0) {
        var rel = Core.dose.relatorio({
          kv: pr.aquisicao.kv, mas: pr.aquisicao.mas, pitch: pr.aquisicao.pitch,
          modo: pr.aquisicao.modo, regiao: regiaoDoProtocolo(), comprimentoMm: comprimento
        });
        dlpPrev = rel.dlp;
      }
      return Core.validacao.validar(pr, {
        larguraPacienteMm: larguraPac,
        comprimentoFaixaMm: comprimento,
        extensaoVolumeMm: topoLenMm(),
        dlpEstimado: dlpPrev
      });
    }

    function showConfirm() {
      buildConfirm();
      var el = document.getElementById("ws-confirm");
      if (el) el.hidden = false;
      // ERRO impede irradiar; AVISO nao. O botao muda de texto para deixar
      // claro que o operador esta assumindo a consequencia.
      var vd = validarExameAtual();
      var ok = document.getElementById("ws-confirm-ok");
      if (ok) {
        var temErro = !!(vd && vd.erros.length);
        ok.disabled = temErro;
        ok.textContent = temErro ? "Corrija os impedimentos"
          : (vd && vd.avisos.length ? "Executar mesmo assim" : "Confirmar e iniciar");
      }
    }
    function hideConfirm() { var el = document.getElementById("ws-confirm"); if (el) el.hidden = true; }

    function onStart() {
      if (phase === "plan") {
        if (problems().length) { renderReadout(); return; }
        if (SimTC.tableDriveApi && topoRef && !atStart) {
          SimTC.showMessage("Use MOVER para levar a mesa à posição inicial da faixa antes de iniciar.", "warning");
          return;
        }
        // Confirmação pré-aquisição (como no console real): resumo + checklist
        // antes de irradiar. O disparo do volume só ocorre no "Confirmar".
        showConfirm();
        return;
      }
      if (phase !== "idle") return;
      if (SimTC.examSessionApi && !SimTC.examSessionApi.get()) {
        SimTC.showMessage("Cadastre o paciente antes de iniciar o exame.", "warning");
        return;
      }
      if (SimTC.tableDriveApi && !SimTC.tableDriveApi.isPatientOnTable()) {
        SimTC.showMessage("Posicione o paciente na mesa (botão Decúbito, na sala 3D) antes de iniciar a aquisição.", "warning");
        return;
      }
      // Resolve a origem das imagens para ESTE exame (região do protocolo).
      // Congela o protocolo: daqui ate o Stop, o exame usa esta copia.
      congelarProtocolo();

      // ---- origem das imagens: volume de TC real do acervo ----------------
      var regiaoAlvo = regiaoDoProtocolo();
      if (SimTC.FonteVolume && SimTC.FonteVolume.cobre(regiaoAlvo)) {
        startBtn.disabled = true;
        startBtn.textContent = "Carregando volume…";
        SimTC.FonteVolume.preparar(regiaoAlvo).then(function () {
          volSource = resolveSource();
          manifest = SimTC.FonteVolume.manifest(regiaoAlvo);
          slider.min = 0; slider.max = manifest.cortes - 1;
          if (caption) {
            caption.textContent = "TC real anonimizada — " + manifest.nome + " · " +
              manifest.fonte.nome + " · " + manifest.fonte.licenca +
              " Volume de " + Math.round(topoLenMm()) + " mm em HU reais (" +
              manifest.hu_min + " a " + manifest.hu_max + " HU). " +
              "Uso exclusivamente educacional — sem interpretação diagnóstica.";
          }
          startBtn.disabled = false; startBtn.textContent = "Iniciar";
          topoImg.src = scoutSrc(manifest);
          toTopoAcq();
        }).catch(function (err) {
          startBtn.disabled = false; startBtn.textContent = "Iniciar";
          SimTC.showMessage("Falha ao carregar o volume de " + regiaoAlvo + ": " + err.message, "error");
        });
        return;
      }

      // Regiao sem volume no acervo: dizer isso, em vez de exibir um cranio
      // no lugar (B-17).
      if (SimTC.FonteVolume && regiaoAlvo && !SimTC.FonteVolume.cobre(regiaoAlvo)) {
        SimTC.showMessage("Ainda não há volume de TC para a região \"" + regiaoAlvo +
          "\". Disponíveis: " + SimTC.FonteVolume.regioesCobertas().join(", ") +
          ". Escolha um protocolo de uma dessas regiões.", "warning");
        return;
      }

      volSource = resolveSource();
      if (volSource.kind === "phantom") {
        manifest = window.CTPhantom.manifest(volSource.region);
        slider.min = 0; slider.max = manifest.cortes - 1;
        if (caption) {
          caption.textContent = "Imagem SIMULADA (fantoma didático) — " + manifest.nome +
            ". Topograma e volume gerados por modelo geométrico; sem interpretação diagnóstica. " +
            "Serão substituídos por DICOM em atualização futura.";
        }
        topoImg.src = scoutSrc(manifest);
        toTopoAcq();
        return;
      }
      if (manifest) {
        topoImg.src = scoutSrc(manifest);
        toTopoAcq();
        return;
      }
      startBtn.disabled = true;
      startBtn.textContent = "Preparando…";
      fetch(bust("manifest.json"), { cache: "no-cache" }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (m) {
        manifest = m;
        slider.min = 0;
        slider.max = m.cortes - 1;
        if (caption && m.fonte) {
          caption.textContent = "Topograma ilustrativo (paciente distinto do volume) para planejar a faixa. Volume axial real de TC de crânio (" +
            m.fonte.nome + "). " + m.fonte.licenca + " Apenas visualização — sem interpretação diagnóstica.";
        }
        topoImg.src = scoutSrc(m);
        toTopoAcq();
      }).catch(function (err) {
        startBtn.disabled = false;
        startBtn.textContent = "Iniciar";
        SimTC.showMessage("Falha ao preparar o exame: " + err.message, "error");
      });
    }

    // Stop encerra a simulação em QUALQUER fase e apaga o registro do
    // paciente (um exame por vez, sem memória entre simulações).
    function onStop() {
      if (phase === "idle") return;
      var wasDone = (phase === "review");
      toIdle();
      var finish = (SimTC.examSessionApi && SimTC.examSessionApi.end) ? SimTC.examSessionApi.end() : Promise.resolve();
      finish.then(function () {
        SimTC.showMessage(wasDone
          ? "Exame finalizado e arquivado em \"Exames realizados\". O paciente segue na lista de trabalho."
          : "Exame interrompido. O paciente segue na lista de trabalho.", "info");
      });
    }

    startBtn.addEventListener("click", onStart);
    if (stopBtn) stopBtn.addEventListener("click", onStop);
    if (moveBtn) moveBtn.addEventListener("click", onMove);
    var confirmOk = document.getElementById("ws-confirm-ok");
    var confirmCancel = document.getElementById("ws-confirm-cancel");
    if (confirmOk) confirmOk.addEventListener("click", function () {
      hideConfirm();
      if (phase === "plan") toVolAcq();
    });
    if (confirmCancel) confirmCancel.addEventListener("click", hideConfirm);
    var reportClose = document.getElementById("ws-report-close");
    if (reportClose) reportClose.addEventListener("click", function () { if (reportEl) reportEl.hidden = true; });
    if (reportBtn) reportBtn.addEventListener("click", function () {
      if (!reportEl) return;
      if (reportEl.hidden) buildReport();
      reportEl.hidden = !reportEl.hidden;
    });
    if (SimTC.MedidasInit) SimTC.MedidasInit.init();

    var seriesEl = document.getElementById("ws-series");
    if (seriesEl) seriesEl.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".ws-series__btn") : null;
      if (!b || !SimTC.MotorImagem) return;
      var i = parseInt(b.getAttribute("data-serie"), 10);
      if (!SimTC.MotorImagem.selecionarSerie(i)) return;
      var t = totalCortes();
      slider.min = 0; slider.max = Math.max(0, t - 1);
      if (lastSlice > t - 1) lastSlice = Math.floor(t / 2);
      plane = "axial"; vol = null; mprCache = {};
      renderSeletorSeries();
      show(lastSlice);
      var s = SimTC.MotorImagem.serieAtual();
      SimTC.showMessage("Série “" + s.nome + "” — " + s.espessuraMm +
        " mm, kernel " + s.kernel + ", " + s.cortes + " cortes.", "info");
    });

    var btnDicomEl = document.getElementById("ws-exam-dicom");
    if (btnDicomEl) btnDicomEl.addEventListener("click", function () {
      try {
        var r = SimTC.ExportarDicom.exportarSerieAtual();
        SimTC.showMessage("Exportados " + r.arquivos + " arquivos DICOM em " + r.nome +
          " — abra em qualquer visualizador DICOM.", "success");
      } catch (e) {
        SimTC.showMessage("Falha ao exportar DICOM: " + e.message, "error");
      }
    });

    topoImg.addEventListener("load", fitTopo);
    window.addEventListener("resize", fitTopo);
  }

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
      var rows = [
        ["kV", p && p.kv], ["mAs", p && p.mas], ["Pitch", p && p.pitch], ["FOV", p && p.fov],
        ["Colimação", p && p.colimacao], ["Esp. corte", p && p.espessura],
        ["Kernel", p && p.kernel], ["CTDIvol", p && p.dose],
        ["Modo", p && modoTxt(p.modo)], ["Tilt", p && (p.tilt !== "" && p.tilt != null ? p.tilt + "°" : null)]
      ];
      var html = "";
      if (!p) {
        html = '<p class="acq-params__empty">Nenhum protocolo selecionado.</p>';
      } else {
        rows.forEach(function (r) {
          html += '<div class="acq-param"><span class="acq-param__k">' + r[0] + '</span>' +
            '<span class="acq-param__v">' + (r[1] ? esc(r[1]) : "—") + '</span></div>';
        });
        html += '<div class="acq-param acq-param--full"><span class="acq-param__k">Direção</span>' +
          '<span class="acq-param__v">' + dirTxt(p.direcao) + '</span></div>';
      }
      paramsEl.innerHTML = html;
    }

    var curPhase = "idle";
    document.addEventListener("ct:phase", function (e) {
      var p = e.detail && e.detail.phase;
      if (!p) return;
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
  SimTC.Aquisicao = {
    init: function () {
      initWorkstationViewer();
      initAcqQuadrants();
    }
  };

})();