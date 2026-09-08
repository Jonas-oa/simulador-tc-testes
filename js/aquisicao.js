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

  // Escape de HTML — agora em js/shared.js, uma copia so para o projeto.
  var esc = function (v) { return SimTC.esc(v); };

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
    var MaquinaFases = window.SimTC.MaquinaFases;
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
      // Comprimento que o TOPOGRAMA cobre — nao a extensao do volume. E esse o
      // curso que a mesa percorre na varredura do scout, e e sobre ele que a
      // caixa de planejamento e uma fracao.
      var f = SimTC.FonteVolume && SimTC.FonteVolume.comprimentoTopogramaMm &&
              SimTC.FonteVolume.comprimentoTopogramaMm(regiaoDoProtocolo());
      if (isFinite(f) && f > 0) return f;
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
    var boxPlanejamento = window.SimTC.BoxPlanejamento;
    var boxState = boxPlanejamento.state;
    function isFrontal() { return boxPlanejamento.isFrontal(protocolParams); }
    function preset() { return boxPlanejamento.BOX_PRESET[isFrontal() ? "frontal" : "lateral"]; }
    function rangeSpan() { return boxPlanejamento.rangeSpan(protocolParams); }
    function fovSpan() { return boxPlanejamento.fovSpan(protocolParams); }
    var MIN_GAP = 6; // % mínimo entre linhas opostas
    var lastSlice = 0; // último corte pintado na aquisição (p/ review)
    var lastAcq = null; // parâmetros da última aquisição (p/ relatório)
    // MPR: plano de exibição atual e volume reconstruído da pilha axial.
    var plane = "axial";

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
      return boxPlanejamento.faixaEmMm(protocolParams, topoLenMm, regiaoDoProtocolo);
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



    /**
     * Leva a faixa planejada ao nucleo.
     *
     * O plano so existia como percentagem das linhas na caixa do topograma,
     * dentro desta closure. Com ele no ScanRun, `Core.sessao` passa a
     * responder quantos cortes cada reconstrucao produz (cortesPorReconstrucao)
     * e o comprimento em mm fica registrado com o exame, em vez de ser
     * recalculado por quem precisar.
     */
    function definirPlanoNoNucleo() {
      var C = window.SimTCCore;
      if (!C || !C.sessao) return;
      var f = faixaEmMm();
      if (!f || !isFinite(f.inicioMm) || !isFinite(f.fimMm)) return;
      try {
        var pp = protocolParams();
        C.sessao.definirPlano({
          inicioMm: f.inicioMm, fimMm: f.fimMm,
          direcao: pp.direcao, tiltDeg: pp.tiltDeg,
          refMesaM: topoRef ? topoRef.startZ : null
        });
      } catch (e) { /* plano invalido: a validacao dira o que falta */ }
    }

    /** Progresso da varredura (0..1) no nucleo. */
    function progressoNoNucleo(k) {
      var C = window.SimTCCore;
      if (!C || !C.sessao) return;
      try { C.sessao.progresso(k); } catch (e) { /* ignora */ }
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
    /**
     * Parâmetros do protocolo na forma que ESTA TELA consome.
     *
     * A conversão de texto para número é do NÚCLEO, não daqui. Havia um
     * parser local, e ele divergia do núcleo num ponto que importa: a
     * expressão não aceitava sinal negativo, então um tilt de gantry de −15°
     * era lido como +15 e era esse valor que inclinava o gantry 3D, entrava no
     * relatório e aparecia na confirmação. O aluno via o gantry inclinar para
     * o lado oposto ao que pediu — num simulador de operação, ensinar a
     * direção errada é o defeito mais caro que existe.
     *
     * Duas respostas para a mesma pergunta é o que produz esse tipo de erro.
     * Agora há uma só: Core.model.normalizarProtocolo. Esta função vira o
     * adaptador de forma, e nada mais.
     */
    var ppCache = { cru: null, valor: null };
    function protocolParams() {
      var cru = protocoloVigente() || {};
      // Memo por identidade: protocolParams() é chamada a cada quadro durante
      // o arraste das linhas do topograma, e normalizar aloca um objeto.
      if (ppCache.cru === cru && ppCache.valor) return ppCache.valor;

      var C = window.SimTCCore;
      var n = null;
      if (C && C.model && C.model.normalizarProtocolo) {
        try { n = C.model.normalizarProtocolo(cru); } catch (e) { n = null; }
      }
      var valor;
      if (n) {
        var aq = n.aquisicao;
        // No sequencial o núcleo devolve pitch null — é o correto: pitch não
        // se aplica ao step-and-shoot. A tela ainda precisa de um número para
        // a conta de velocidade da mesa no helicoidal; no sequencial ela nem
        // usa esse valor (runSequential trabalha com colimação e rotação).
        valor = {
          scout: n.scout.orientacao,
          direcao: aq.direcao,
          modo: aq.modo,
          pitch: (aq.pitch != null && aq.pitch > 0) ? aq.pitch : 1.0,
          colim: aq.colimacao.totalMm,
          rotacaoS: aq.tempoRotacaoS,
          tiltDeg: aq.tiltGantryDeg
        };
      } else {
        // Sem núcleo carregado a tela não inventa leitura de protocolo: usa a
        // configuração neutra e segue, em vez de exibir números derivados de
        // um parser improvisado.
        valor = {
          scout: "lateral", direcao: "caudocranial", modo: "helicoidal",
          pitch: 1.0, colim: 38.4, rotacaoS: ROT_S, tiltDeg: 0
        };
      }
      ppCache = { cru: cru, valor: valor };
      return valor;
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

    // Som do equipamento: js/aquisicao/som.js. Os apelidos mantem as ~15
    // chamadas desta tela legiveis, sem espalhar o nome do modulo por elas.
    var soundStart = SimTC.SomDoEquipamento.iniciar;
    var soundStop = SimTC.SomDoEquipamento.parar;

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
      // Geometria das reformatações (js/motor-imagem.js): nos DOIS planos o
      // eixo vertical é o crânio-caudal, com a cabeça em cima — coronal =
      // x(D-E) na horizontal, sagital = y(A-P) na horizontal.
      //
      // O sagital antes saía deitado, com a cabeça apontando para o lado: era
      // consequência de como o volume de 8 bits era montado, não uma escolha.
      // Um perfil se lê de cabeça para cima.
      if (plane === "coronal") setOrientLabels("ws-vol-orient", "Cabeça", "Pés", "D", "E");
      else if (plane === "sagital") setOrientLabels("ws-vol-orient", "Cabeça", "Pés", "A", "P");
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

    function problems() {
      return boxPlanejamento.validar(protocolParams, regiaoDoProtocolo);
    }

    function renderReadout() {
      var probs = problems();
      var ok = probs.length === 0;
      if (topoBox) topoBox.classList.toggle("is-invalid", !ok);
      var gated = !!(SimTC.tableDriveApi && topoRef); // com 3D: exige mesa em posição
      if (MaquinaFases.atual() === "plan") {
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
      var cc = SimTC.fmt.n(Math.max(0, rangeSpan()), 0);
      var ap = SimTC.fmt.n(Math.max(0, fovSpan()), 0);
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
        if (MaquinaFases.atual() !== "plan") return;
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
          definirPlanoNoNucleo();
        }
        line.addEventListener("pointermove", move);
        line.addEventListener("pointerup", up);
        line.addEventListener("pointercancel", up);
      });
    });

    // ---- fases e animações ----
    function stopAnimations() {
      MaquinaFases.clearTopoAnim();
      MaquinaFases.clearVolTimer();
      soundStop();
      // Para a mesa se a aquisição estiver em curso. Os handlers onAbort
      // checam a fase — como ela já foi trocada, viram no-op (sem eco).
      if (SimTC.tableDriveApi && SimTC.tableDriveApi.isBusy && SimTC.tableDriveApi.isBusy()) SimTC.tableDriveApi.stop();
      // Desliga o arco de varredura (caso estivesse na aquisição estacionária
      // do step-and-shoot, sem uma mesa em movimento para pará-lo).
      if (SimTC.tableDriveApi && SimTC.tableDriveApi.setScan) SimTC.tableDriveApi.setScan(0);
    }
    function toIdle() {
      MaquinaFases.definirFase("idle"); loaded = false; lastSlice = 0; lastAcq = null;
      if (ctrl) ctrl.classList.remove("is-acquiring");
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
      plane = "axial";
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
      MaquinaFases.definirFase("topoAcq");
      placeholder.hidden = true;
      img.hidden = true; ctrl.hidden = true;
      if (topo) topo.hidden = false;
      updateTopoOrient();                    // rótulos anatômicos já na varredura
      if (topoBox) topoBox.hidden = true;   // linhas só após completar
      if (readout) readout.hidden = true;
      startBtn.disabled = true; startBtn.textContent = "Adquirindo topograma…";
      if (stopBtn) stopBtn.hidden = false;
      setTopoClip(0);
      fitTopo();
      soundStart("topo", 0);
      if (SimTC.tableDriveApi) {
        var pp = protocolParams();
        var res = SimTC.tableDriveApi.start({
          distanceMm: topoLenMm(),
          direction: pp.direcao === "craniocaudal" ? "in" : "out",
          // Varredura: se faltar curso, o console posiciona a mesa e emenda.
          posicionarAntes: true,
          speedMmS: TOPO_SPEED_MMS,
          rotTimeS: 0, // scout: tubo estacionário, gantry não gira
          onProgress: function (k) { setTopoClip(k); progressoNoNucleo(k); },
          onDone: function () { soundStop(); toPlan(); },
          onAbort: function (motivo) {
            if (MaquinaFases.atual() !== "topoAcq") return;
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
            SimTC.showMessage("Atenção: eixo do paciente ~" + SimTC.fmt.cm(Math.abs(off), 0) + " " +
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
        if (k < 1) { MaquinaFases.setTopoAnim(requestAnimationFrame(frame)); }
        else { soundStop(); toPlan(); }
      }
      MaquinaFases.setTopoAnim(requestAnimationFrame(frame));
    }

    function toPlan(keepBox) {
      MaquinaFases.definirFase("plan");
      if (ctrl) ctrl.classList.remove("is-acquiring");
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
          var reg0 = regiaoDoProtocolo();
          var fp = window.SimTCCore && window.SimTCCore.Acervo &&
                   window.SimTCCore.Acervo.faixaPadrao(reg0);
          var paraFracao = SimTC.FonteVolume && SimTC.FonteVolume.mmParaFracaoCC;
          if (fp && paraFracao) {
            // mm no VOLUME -> % do TOPOGRAMA. A conversao mora em
            // FonteVolume porque o topograma cobre so uma faixa do volume:
            // dividir pelo comprimento do topograma, como se as duas escalas
            // tivessem a mesma origem, encolhia a faixa de 66% para 15%.
            var p0 = SimTC.FonteVolume.mmParaFracaoCC(reg0, fp.fimMm) * 100;
            var p1 = SimTC.FonteVolume.mmParaFracaoCC(reg0, fp.inicioMm) * 100;
            p0 = Math.max(c0, Math.min(100, p0));
            p1 = Math.min(c1, Math.max(0, p1));
            if (p1 - p0 >= MIN_GAP) { c0 = p0; c1 = p1; }
          }

          var pA = Math.max(0, lm.perp[0] * 100 - 4);   // margem de 4% no FOV
          var pB = Math.min(100, lm.perp[1] * 100 + 4);
          var fr0 = isFrontal();
          var s = fr0
            ? { top: c0, bottom: c1, left: pA, right: pB }
            : { top: pA, bottom: pB, left: c0, right: c1 };
          boxState.top = s.top;
          boxState.bottom = s.bottom;
          boxState.left = s.left;
          boxState.right = s.right;
        } else {
          boxPlanejamento.applyPreset(isFrontal() ? "frontal" : "lateral");
        }
      }
      startBtn.disabled = false; startBtn.textContent = "Iniciar";
      atStart = false; isMoving = false;
      if (SimTC.tableDriveApi && SimTC.tableDriveApi.setGantryTilt) SimTC.tableDriveApi.setGantryTilt(protocolParams().tiltDeg);
      fitTopo();
      applyBox(); renderReadout(); // renderReadout pode voltar a travar o Iniciar
      definirPlanoNoNucleo();
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
      // A dose deste relatório vem do motor, mais abaixo. O cálculo a partir
      // do texto digitado no protocolo que existia aqui ficou órfão quando a
      // Fase 6 passou a calcular a dose, e continuava rodando sem ser lido.
      var iso = topoRef ? topoRef.isoOff : null;
      var isoTxt = (iso == null)
        ? "não avaliado"
        : (Math.abs(iso) <= 4
          ? '<span class="is-good">no isocentro (' + SimTC.fmt.cm(iso) + ')</span>'
          : '<span class="is-bad">fora do isocentro (' + SimTC.fmt.cm(iso) + ') — magnificação no topograma lateral</span>');
      var rows = [];
      if (pac) rows.push("<strong>Paciente:</strong> " + esc(pac.nome) + " · " + (pac.prontuario ? "Pront. " + esc(pac.prontuario) : "s/ prontuário") + (pac.regiao ? " · " + esc(pac.regiao) : ""));
      var modoTxt = pp.modo === "sequencial" ? "axial sequencial" : "helicoidal";
      var tiltTxt = (pp.tiltDeg ? (", tilt " + SimTC.fmt.graus(pp.tiltDeg)) : "");
      var scoutTxt = pp.scout === "frontal" ? "topograma frontal/AP" : "topograma lateral";
      var fovLbl = pp.scout === "frontal" ? "FOV R-L" : "FOV A-P";
      rows.push("<strong>Protocolo:</strong> " + (prot ? esc(prot.nome) : "—") + " · " + scoutTxt + " · " + modoTxt + tiltTxt + " · direção " + (pp.direcao === "craniocaudal" ? "crânio-caudal (mesa entra)" : "caudo-cranial (mesa sai)"));
      rows.push("<strong>Faixa varrida:</strong> " + Math.round(scanLen) + " mm · <strong>" + fovLbl + ":</strong> " + SimTC.fmt.pct(Math.max(0, fovSpan())) + " da imagem");
      if (pp.modo === "sequencial") {
        rows.push("<strong>Mesa:</strong> passo a passo (step-and-shoot) · colimação " + SimTC.fmt.mm(pp.colim) + " · rotação " + SimTC.fmt.s(pp.rotacaoS));
      } else {
        rows.push("<strong>Mesa:</strong> " + SimTC.fmt.mmPorS(speed) + " (pitch " + SimTC.fmt.n(pp.pitch) + " × colimação " + SimTC.fmt.mm(pp.colim) + " ÷ rotação " + SimTC.fmt.s(pp.rotacaoS) + ")");
      }
      rows.push("<strong>Posicionamento no isocentro:</strong> " + isoTxt);
      // ---- DOSE CALCULADA (Fase 6) ------------------------------------
      // Antes, o CTDIvol vinha de um TEXTO digitado no protocolo e lido por
      // expressao regular: mudar kV ou mAs nao mudava a dose, e um paciente
      // de 45 kg recebia o mesmo numero de um de 120 kg. Agora e calculado,
      // e o SSDE corrige pelo diametro efetivo medido no proprio volume.
      var dz = SimTC.MotorImagem && SimTC.MotorImagem.dose();
      if (dz && dz.ctdivol != null) {
        rows.push("<strong>CTDIvol:</strong> " + SimTC.fmt.mGy(dz.ctdivol) +
          " <small>(fantoma de " + dz.fantomaCm + " cm · CTDIw ÷ pitch)</small>");
        rows.push("<strong>DLP:</strong> " + SimTC.fmt.mGycm(dz.dlp) +
          " <small>(CTDIvol × " + SimTC.fmt.cm(dz.comprimentoMm / 10) + ")</small>");
        if (dz.ssdeMGy != null) {
          rows.push("<strong>SSDE:</strong> " + SimTC.fmt.mGy(dz.ssdeMGy) +
            " <small>(diâmetro efetivo " + SimTC.fmt.cm(dz.diametroEfetivoCm) +
            " · fator " + SimTC.fmt.n(dz.fatorSSDE, 2) + " · AAPM 204)</small>");
          if (dz.ssdeMGy > dz.ctdivol * 1.1) {
            rows.push('<span class="is-bad">Paciente menor que o fantoma: a dose real é MAIOR que o CTDIvol indica.</span>');
          } else if (dz.ssdeMGy < dz.ctdivol * 0.9) {
            rows.push('<span class="is-good">Paciente maior que o fantoma: a dose real é menor que o CTDIvol indica.</span>');
          }
        }
        if (dz.doseEfetivaMSv != null) {
          rows.push("<strong>Dose efetiva (estimada):</strong> " + SimTC.fmt.mSv(dz.doseEfetivaMSv) +
            " <small>(DLP × k = " + dz.kEfetiva + ", fator de conversão regional)</small>");
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
      if (MaquinaFases.atual() !== "plan" || !SimTC.tableDriveApi || isMoving) return;
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
      MaquinaFases.estadoNoNucleo("posicionando");
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
          MaquinaFases.estadoNoNucleo("planejando");
          // Se as linhas mudaram durante o movimento, a posição já não vale.
          var alvo = volumeStartZ();
          atStart = alvo != null && Math.abs(SimTC.tableDriveApi.getPos() - alvo) * 1000 < 3;
          renderReadout();
          SimTC.showMessage(atStart
            ? "Mesa na posição inicial da faixa — Iniciar libera a aquisição."
            : "A faixa foi alterada durante o movimento — use MOVER novamente.", atStart ? "success" : "warning");
        },
        onAbort: function (motivo) {
          if (MaquinaFases.atual() !== "plan") return;
          soundStop(); isMoving = false; atStart = false;
          MaquinaFases.estadoNoNucleo("planejando");
          renderReadout();
          SimTC.showMessage("Movimentação interrompida: " + motivo, "warning");
        }
      });
      if (!res.ok) {
        soundStop(); isMoving = false;
        MaquinaFases.estadoNoNucleo("planejando");
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
      MaquinaFases.definirFase("volAcq"); loaded = false;
      definirPlanoNoNucleo();   // a faixa que sera irradiada, registrada no exame
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
      if (stopBtn) stopBtn.hidden = false;
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
            var p = MaquinaFases.atual();
            if (p === "topoAcq" || p === "volAcq") { return; }
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
          posicionarAntes: true,
          speedMmS: speed,
          rotTimeS: pp.rotacaoS, // liga o arco de varredura girando no bore
          onProgress: function (k) { paintProg(k); progressoNoNucleo(k); },
          onDone: function () { soundStop(); toRecon(); },
          onAbort: function (motivo) {
            if (MaquinaFases.atual() !== "volAcq") return;
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
      MaquinaFases.setVolTimer(setInterval(function () {
        i++;
        if (i >= total) {
          MaquinaFases.clearVolTimer();
          soundStop();
          toRecon();
          return;
        }
        paintProg(i / (total - 1));
      }, stepMs));

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
          if (MaquinaFases.atual() !== "volAcq") return;
          var startIdx = (s === 0) ? 0 : (sliceEndForStep(s - 1) + 1);
          var endIdx = sliceEndForStep(s);
          if (endIdx < startIdx) endIdx = startIdx;
          if (SimTC.tableDriveApi.setScan) SimTC.tableDriveApi.setScan(pp.rotacaoS); // arco gira, mesa parada
          soundStart("vol", pp.rotacaoS);
          var i = startIdx;
          var span = Math.max(1, endIdx - startIdx);
          var tickMs = Math.max(40, Math.round(acqMsPerStep / (span + 1)));
          paintSeq(startIdx, s + 1, false);
          MaquinaFases.setVolTimer(setInterval(function () {
            if (MaquinaFases.atual() !== "volAcq") { MaquinaFases.clearVolTimer(); return; }
            i++;
            if (i > endIdx) {
              MaquinaFases.clearVolTimer();
              if (SimTC.tableDriveApi.setScan) SimTC.tableDriveApi.setScan(0);
              soundStop();
              moveOrFinish();
              return;
            }
            paintSeq(i, s + 1, false);
          }, tickMs));
        }
        function moveOrFinish() {
          if (MaquinaFases.atual() !== "volAcq") return;
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
              if (MaquinaFases.atual() !== "volAcq") return;
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

    // ---- MPR: reformatacoes coronal e sagital ----
    // A reformatacao mora em js/motor-imagem.js, junto da serie: e de la que
    // sai o Int16Array com os HU reconstruidos, o pixelMm e o incrementoMm.
    // Aqui ficou so a tela.
    //
    // Havia aqui um caminho que remontava um volume de 8 bits a partir dos PNG
    // ja janelados de cada corte, percorrendo os cortes do VOLUME-FONTE em vez
    // dos da serie. Foi removido: apagou 90 linhas, o cache proprio, a leitura
    // de espacamento com valores fixos herdados de outro acervo, e a
    // discordancia de tamanho entre os tres consumidores do coronal.
    var planeEl = document.getElementById("ws-plane");
    function temSerie() {
      return !!(SimTC.MotorImagem && SimTC.MotorImagem.temSeries());
    }
    function planeMax() {
      if (plane === "axial") return Math.max(0, totalCortes() - 1);
      var n = temSerie() ? SimTC.MotorImagem.cortesNoPlano(plane) : 0;
      return Math.max(0, n - 1);
    }
    function showReformat(i) {
      if (!temSerie()) { show(i); return; }
      var maxI = planeMax();
      i = Math.max(0, Math.min(maxI, i | 0));
      var url = SimTC.MotorImagem.reformatar(plane, i);
      if (url) img.src = url;
      slider.value = i;
      counter.textContent = (plane === "coronal" ? "Coronal " : "Sagital ") + (i + 1) + " / " + (maxI + 1);
    }
    function render(i) {
      if (plane === "axial") show(i);
      else showReformat(i);
    }
    function setPlane(pl) {
      if (pl !== "axial" && !temSerie()) return; // sem série, só axial
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

    // Passo de RECONSTRUÇÃO entre a aquisição e a revisão: espera o motor
    // terminar, exibindo "Reconstruindo…", e então segue para a revisão.
    //
    // Havia aqui um segundo passo, que remontava um volume de 8 bits a partir
    // dos PNG só para habilitar coronal e sagital. Ele saiu: a série que o
    // motor acabou de produzir já é o volume, com os HU verdadeiros.
    function toRecon() {
      MaquinaFases.definirFase("recon");
      if (ctrl) ctrl.classList.remove("is-acquiring");
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
                SimTC.fmt.mm(obtidas[q].espessuraMm, 2) + ")");
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
        if (MaquinaFases.atual() === "recon") toReview();
      });
    }

    function toReview() {
      MaquinaFases.definirFase("review");
      if (ctrl) ctrl.classList.remove("is-acquiring");
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
      if (planeEl) planeEl.hidden = !temSerie();
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
        var lenArq = lastAcq ? lastAcq.scanLen : 0;
        // O registro guarda o que o exame REALMENTE produziu:
        //
        //   cortes  os da série reconstruída. Guardava manifest.cortes, que é
        //           a contagem do VOLUME-FONTE — o exame que a tela anunciava
        //           com 32 cortes ia para o arquivo com 125.
        //   dlp     o do motor, com a modulação AEC que de fato aconteceu.
        //           Vinha de `dose_digitada × faixa`, lendo "≈55 mGy (ref.)"
        //           por expressão regular: 866 no arquivo contra 1370
        //           calculados. Era a Fase 6 sendo desfeita no último passo.
        var dzArq = doseDoExame();
        SimTC.examSessionApi.arquivar({
          regiao: protArq ? protArq.regiao : "",
          protocoloNome: protArq ? protArq.nome : "",
          modo: ppArq.modo,
          faixaMm: lenArq,
          cortes: totalCortes() || null,
          dlp: (dzArq && dzArq.dlp != null) ? dzArq.dlp : null,
          ctdivol: (dzArq && dzArq.ctdivol != null) ? dzArq.ctdivol : null,
          isoOffsetCm: topoRef ? topoRef.isoOff : null
        });
      }

      SimTC.showMessage("Aquisição concluída (" + totalCortes() + " cortes)" +
        (temSerie() ? " — reformatações coronal/sagital disponíveis." : ".") + " Navegue e finalize com Stop.", "success");
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
          (dz && dz.ctdivol != null ? " · CTDIvol " + SimTC.fmt.mGy(dz.ctdivol) : "") +
          ". Uso educacional — sem valor diagnóstico.",
        attribution: (manifest && manifest.fonte) ? manifest.fonte.nome : "Simulador TC Educacional"
      };
    }

    // API do ambiente de processamento. Tudo aqui responde a partir da SÉRIE
    // RECONSTRUÍDA, que é a única representação do exame que existe.
    //
    // Havia um segundo caminho, de reserva, que devolvia o volume de 8 bits
    // remontado dos PNG e convertia os cinzas de volta em HU pela inversa da
    // janela — declarando `unidadeHU: true` para uma faixa que na prática ia
    // de -160 a +239. Sumiu junto com o volume que o alimentava.
    SimTC.contratos.declarar("mprApi", {
      hasVolume: function () {
        return temSerie();
      },
      count: function (pl) {
        return temSerie() ? SimTC.MotorImagem.cortesNoPlano(pl) : 0;
      },
      reformat: function (pl, idx) {
        return temSerie() ? SimTC.MotorImagem.reformatar(pl, idx) : null;
      },
      exportVolume: function () {
        return payloadDaSerieReconstruida();
      }
    });

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
      // Um só DLP nesta tela, e calculado — ver dosePrevista().
      var rel = dosePrevista();
      var iso = (SimTC.tableDriveApi && SimTC.tableDriveApi.getIsoOffsetCm) ? SimTC.tableDriveApi.getIsoOffsetCm() : null;
      function chk(ok, txt) { return '<span class="' + (ok ? "is-good" : "is-bad") + '">' + (ok ? "✓" : "⚠") + " " + txt + "</span>"; }
      var modoTxt = pp.modo === "sequencial" ? "axial sequencial" : "helicoidal";
      var rows = [];
      rows.push("<strong>Paciente:</strong> " + (pac ? esc(pac.nome) + (pac.prontuario ? " · Pront. " + esc(pac.prontuario) : "") : "—"));
      var scoutTxt = pp.scout === "frontal" ? "frontal/AP" : "lateral";
      var fovLbl = pp.scout === "frontal" ? "FOV R-L" : "FOV A-P";
      rows.push("<strong>Protocolo:</strong> " + (prot ? esc(prot.nome) : "—") + " · scout " + scoutTxt + " · " + modoTxt + (pp.tiltDeg ? (", tilt " + SimTC.fmt.graus(pp.tiltDeg)) : "") + " · " + (pp.direcao === "craniocaudal" ? "crânio-caudal" : "caudo-cranial"));
      rows.push("<strong>Faixa:</strong> " + Math.round(scanLen) + " mm · <strong>" + fovLbl + ":</strong> " + SimTC.fmt.pct(Math.max(0, fovSpan())));
      if (rel && rel.ctdivol != null && rel.dlp != null) {
        rows.push("<strong>Dose prevista:</strong> CTDIvol " + SimTC.fmt.mGy(rel.ctdivol) +
          " · DLP " + SimTC.fmt.mGycm(rel.dlp) +
          " <small>(calculado de kV, mAs, pitch e faixa)</small>");
      } else {
        rows.push("<strong>Dose prevista:</strong> não calculada — informe kV e mAs no protocolo.");
      }
      rows.push("<br><strong>Checklist pré-aquisição</strong>");
      rows.push(chk(!!pac, "Paciente cadastrado"));
      rows.push(chk(!SimTC.tableDriveApi || SimTC.tableDriveApi.isPatientOnTable(), "Paciente posicionado na mesa"));
      rows.push(chk(problems().length === 0, "Faixa e FOV válidos"));
      if (iso != null) rows.push(chk(Math.abs(iso) <= 4, "Isocentro (" + SimTC.fmt.cm(iso) + " do centro)"));
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
    /**
     * Dose PREVISTA para o protocolo e a faixa atuais — calculada a partir de
     * kV, mAs, pitch e comprimento, nunca do texto digitado no campo `dose`.
     *
     * Existe como função única porque a mesma tela chegou a mostrar DOIS DLP
     * para o mesmo exame: o cabeçalho da confirmação calculava
     * `dose_digitada × faixa` e lia "≈55 mGy (ref.)" por expressão regular,
     * enquanto o motor de validação, dois centímetros abaixo, mostrava o valor
     * calculado. Medido no crânio de referência: 866 contra 1370 mGy·cm, lado
     * a lado. O aluno lia dois números para a mesma grandeza e o registro do
     * exame guardava o menor.
     *
     * O campo `dose` do protocolo passa a ser o que sempre deveria ter sido:
     * referência histórica exibível, nunca insumo de cálculo.
     *
     * @returns {object|null} relatório de dose do núcleo, ou null quando falta
     *                        kV, mAs ou faixa — nesse caso a tela DIZ que não
     *                        calculou, em vez de inventar um número.
     */
    function dosePrevista() {
      var Core = window.SimTCCore;
      var cru = protocoloVigente();
      if (!Core || !Core.dose || !Core.model || !cru) return null;
      var pr;
      try { pr = Core.model.normalizarProtocolo(cru); } catch (e) { return null; }
      var faixa = faixaEmMm();
      var comprimento = Math.abs(faixa.fimMm - faixa.inicioMm);
      if (pr.aquisicao.kv == null || pr.aquisicao.mas == null || !(comprimento > 0)) return null;
      return Core.dose.relatorio({
        kv: pr.aquisicao.kv, mas: pr.aquisicao.mas, pitch: pr.aquisicao.pitch,
        modo: pr.aquisicao.modo, regiao: regiaoDoProtocolo(), comprimentoMm: comprimento
      });
    }

    /**
     * Dose do exame para o REGISTRO: a medida do motor quando o exame já
     * rodou (inclui o que a modulação AEC de fato fez), e a prevista antes
     * disso. Nos dois casos, calculada.
     */
    function doseDoExame() {
      var m = SimTC.MotorImagem && SimTC.MotorImagem.dose();
      return (m && m.dlp != null) ? m : dosePrevista();
    }

    /**
     * O que ainda falta para poder irradiar, em texto de operador.
     *
     * A resposta é do núcleo (Core.sessao.pendenciasParaIniciar), que já reúne
     * paciente, protocolo, posicionamento e os parâmetros mínimos de técnica.
     * A lista local abaixo é só a reserva para quando o núcleo não carregar —
     * e ela repete, de propósito, as mesmas palavras, para que a mensagem que
     * o aluno lê não dependa de qual caminho respondeu.
     */
    /**
     * Mostra o que falta, ANTES de o operador tentar.
     *
     * Cada pendencia vem do nucleo como uma frase ("Posicionar o paciente na
     * mesa."). A frase e boa; o que faltava era o CAMINHO. Aqui cada uma vira
     * um botao que muda para a etapa do console onde ela se resolve — porque
     * dizer "posicione o paciente" numa tela que nao tem a mesa e dizer meio.
     */
    // A ORDEM IMPORTA, e ja mordeu: "Posicionar o PACIENTE na mesa" casa com
    // /paciente/ tambem, e com a regra do paciente em primeiro lugar o botao
    // mandava para o cadastro em vez da sala. A regra da mesa vem antes, e as
    // outras ficaram mais especificas.
    var DESTINO_DA_FALTA = [
      { teste: /posicionar|na mesa|dec.bito/i, etapa: "sim", onde: "sala" },
      { teste: /protocolo/i, etapa: "pacproto", onde: "protocolos" },
      { teste: /paciente/i, etapa: "pacproto", onde: "cadastro" }
    ];

    function renderFaltas() {
      var caixa = document.getElementById("acq-faltas");
      var lista = document.getElementById("acq-faltas-lista");
      if (!caixa || !lista) return;
      var faltas = pendenciasParaIniciar();
      // Durante a aquisicao a lista nao tem o que dizer: o exame ja comecou.
      if (!faltas.length || MaquinaFases.atual() !== "idle") {
        caixa.hidden = true;
        return;
      }
      lista.innerHTML = "";
      faltas.forEach(function (texto) {
        var destino = null;
        for (var i = 0; i < DESTINO_DA_FALTA.length; i++) {
          if (DESTINO_DA_FALTA[i].teste.test(texto)) { destino = DESTINO_DA_FALTA[i]; break; }
        }
        var li = document.createElement("li");
        var b = document.createElement("button");
        b.type = "button";
        b.className = "acq-faltas__item" + (destino ? "" : " acq-faltas__item--sem-destino");
        b.textContent = texto;
        if (destino) {
          b.title = "Ir para a etapa de " + destino.onde;
          // A API do console e procurada no CLIQUE, e nao aqui.
          //
          // Este primeiro desenho acontece dentro de SimTC.Aquisicao.init(),
          // que roda ANTES de SimTC.Layout.init() — quem declara o
          // `consoleUiApi`. Perguntar por ela agora dava sempre "nao existe", e
          // os tres botoes nasciam inertes ate o proximo evento redesenhar a
          // lista. No clique ela ja existe ha muito tempo.
          b.addEventListener("click", function () {
            if (SimTC.consoleUiApi && SimTC.consoleUiApi.setStep) {
              SimTC.consoleUiApi.setStep(destino.etapa);
            }
          });
        }
        li.appendChild(b);
        lista.appendChild(li);
      });
      caixa.hidden = false;
    }

    function pendenciasParaIniciar() {
      var Core = window.SimTCCore;
      if (Core && Core.sessao && Core.sessao.pendenciasParaIniciar) {
        try { return Core.sessao.pendenciasParaIniciar(); } catch (e) { /* cai na reserva */ }
      }
      var faltas = [];
      if (SimTC.examSessionApi && !SimTC.examSessionApi.get()) {
        faltas.push("Selecionar o paciente na lista de trabalho.");
      }
      if (!protocoloVigente()) faltas.push("Selecionar o protocolo.");
      if (SimTC.tableDriveApi && !SimTC.tableDriveApi.isPatientOnTable()) {
        faltas.push("Posicionar o paciente na mesa.");
      }
      return faltas;
    }

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
      var rel = dosePrevista();
      return Core.validacao.validar(pr, {
        larguraPacienteMm: larguraPac,
        comprimentoFaixaMm: comprimento,
        extensaoVolumeMm: topoLenMm(),
        dlpEstimado: rel ? rel.dlp : null
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
      if (MaquinaFases.atual() === "plan") {
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
      if (MaquinaFases.atual() !== "idle") return;

      // Pré-requisitos para irradiar: quem responde é o NÚCLEO.
      //
      // A tela tinha a sua própria lista, e ela não incluía o protocolo. Sem
      // protocolo selecionado o exame começava assim mesmo: caía no fantoma
      // procedural, rodava com pitch e modo padrão, sem kV e sem mAs, e a
      // confirmação informada — que existe justamente para mostrar a
      // consequência antes de irradiar — exibia três vistos verdes e liberava
      // o botão, porque sem protocolo não há o que validar.
      //
      // O núcleo já sabia dizer o que faltava, com o texto certo, e nunca era
      // perguntado. Agora é. A lista antiga fica como reserva para o caso de o
      // núcleo não ter carregado.
      var faltas = pendenciasParaIniciar();
      if (faltas.length) {
        SimTC.showMessage(
          (faltas.length === 1 ? "Antes de iniciar: " : "Antes de iniciar (" + faltas.length + "): ") +
          faltas.join(" "), "warning");
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
      if (MaquinaFases.atual() === "idle") return;
      var wasDone = (MaquinaFases.atual() === "review");
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

    // O exame acabou de perder o paciente.
    //
    // Excluir um paciente durante a aquisição não parava nada: a tela seguia
    // na fase em que estava, adquiria, e no fim `arquivar()` encontrava a
    // seleção vazia e devolvia null EM SILÊNCIO. O aluno terminava o exame e
    // ele simplesmente não existia em "Exames realizados", sem nenhuma
    // mensagem. Era um dos testes de caos previstos na Fase 11.
    //
    // O núcleo já anunciava isso no barramento; ninguém escutava. Agora a
    // aquisição escuta. O Stop normal também emite este evento, mas nele
    // toIdle() já rodou antes e a fase é "idle" — por isso a guarda, que
    // evita o laço Stop -> evento -> Stop.
    (function ligarAoBarramento() {
      var Core = window.SimTCCore;
      if (!Core || !Core.bus || !Core.EVENTOS) return;
      Core.bus.on(Core.EVENTOS.EXAME_ENCERRADO, function () {
        if (MaquinaFases.atual() === "idle") return;
        if (SimTC.examSessionApi && SimTC.examSessionApi.get()) return; // ainda há paciente
        toIdle();
        SimTC.showMessage(
          "Exame interrompido: o paciente saiu da lista de trabalho durante a aquisição. " +
          "Nada foi arquivado.", "warning");
      });

      // A lista do que falta se refaz a cada fato que possa resolver — ou
      // criar — uma pendencia. Sao os mesmos eventos que o nucleo ja emite;
      // nenhum estado novo, so uma leitura a mais.
      [Core.EVENTOS.EXAME_SELECIONADO, Core.EVENTOS.EXAME_ENCERRADO,
       Core.EVENTOS.PACIENTE_REMOVIDO, Core.EVENTOS.PROTOCOLO_SELECIONADO,
       Core.EVENTOS.PROTOCOLO_ALTERADO, Core.EVENTOS.PACIENTE_POSICIONADO,
       Core.EVENTOS.MESA_ESTADO, Core.EVENTOS.FASE_MUDOU
      ].forEach(function (ev) { Core.bus.on(ev, renderFaltas); });
      renderFaltas();
    })();
    var confirmOk = document.getElementById("ws-confirm-ok");
    var confirmCancel = document.getElementById("ws-confirm-cancel");
    if (confirmOk) confirmOk.addEventListener("click", function () {
      hideConfirm();
      if (MaquinaFases.atual() === "plan") toVolAcq();
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
      plane = "axial";
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


  window.SimTC = window.SimTC || {};
  SimTC.Aquisicao = {
    init: function () {
      initWorkstationViewer();
      SimTC.PainelAquisicao.init();
    }
  };

})();