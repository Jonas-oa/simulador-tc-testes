/**
 * core/model/exam.js
 * Estudo, série, plano de aquisição e execução do scan.
 *
 * Consolida em um arquivo o que o roteiro previa em três (study/series/plan/
 * scanrun): eles só fazem sentido juntos e separá-los aqui seria cerimônia.
 *
 * Duas decisões que destravam as fases seguintes:
 *
 * 1. O PLANO guarda a faixa em MILÍMETROS no eixo do paciente, não em
 *    porcentagem da imagem do topograma. Hoje a interface reporta "Faixa CC:
 *    59%", o que não é uma grandeza — não dá para calcular número de cortes,
 *    nem DLP, nem comparar com o comprimento reconstruído.
 *
 * 2. A SÉRIE é o produto da RECONSTRUÇÃO, não da aquisição. Um mesmo scan
 *    (um ScanRun, um conjunto de dados brutos) gera N séries com espessuras e
 *    kernels diferentes — que é exatamente o que a auditoria mostrou não
 *    existir (B-03: 60 cortes qualquer que fosse a faixa).
 *
 * SEM dependência de DOM. Script clássico.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};
  Core.model = Core.model || {};

  /**
   * UID no ramo 2.25 do DICOM: 2.25 + inteiro decimal derivado de um UUID.
   * É a forma padrão de gerar UID sem raiz registrada (PS3.5 B.2), e evita o
   * "SIMULADO" fixo que o exportador atual usa.
   */
  function novoUID() {
    var a = "", i;
    for (i = 0; i < 4; i++) a += String(Math.floor(Math.random() * 4294967296));
    // Compacta para caber no limite de 64 caracteres do tipo UI.
    var n = "";
    for (i = 0; i < a.length && n.length < 36; i++) n += a[i];
    n = n.replace(/^0+/, "") || "1";
    return "2.25." + n;
  }

  function agoraISO() { return new Date().toISOString(); }

  // ---------------------------------------------------------------------
  // Plano de aquisição — o que o operador desenha sobre o topograma
  // ---------------------------------------------------------------------
  /**
   * @param {object} o
   * @param {number} o.inicioMm  posição inicial no eixo crânio-caudal do paciente
   * @param {number} o.fimMm     posição final (inicioMm < fimMm sempre)
   * @param {number} o.fovMm     campo de visão no plano de corte
   */
  function criarPlano(o) {
    o = o || {};
    var ini = Number(o.inicioMm), fim = Number(o.fimMm);
    if (!isFinite(ini) || !isFinite(fim)) throw new Error("Faixa do plano precisa estar em mm.");
    if (fim < ini) { var t = ini; ini = fim; fim = t; }
    return {
      inicioMm: ini,
      fimMm: fim,
      fovMm: isFinite(Number(o.fovMm)) ? Number(o.fovMm) : null,
      tiltDeg: isFinite(Number(o.tiltDeg)) ? Number(o.tiltDeg) : 0,
      direcao: o.direcao === "craniocaudal" ? "craniocaudal" : "caudocranial",
      // Referência espacial: onde a mesa estava quando o scout foi varrido.
      refMesaM: isFinite(Number(o.refMesaM)) ? Number(o.refMesaM) : null
    };
  }

  /** Comprimento da varredura em mm — base do DLP e do número de cortes. */
  function comprimentoPlanoMm(plano) {
    return plano ? Math.abs(plano.fimMm - plano.inicioMm) : 0;
  }

  /**
   * Quantos cortes a reconstrução produz.
   *
   *   n = round(comprimento / incremento)
   *
   * Convenção adotada: cada imagem representa uma fatia de `incremento` mm da
   * faixa, e as imagens preenchem a faixa. 120 mm com incremento de 5 mm → 24
   * imagens. (A convenção alternativa, contar as duas extremidades — 25
   * imagens —, também existe; a escolha está fixada aqui para que a faixa
   * planejada e o comprimento reconstruído fechem exatamente.)
   *
   * É esta conta que hoje não existe: o número de cortes vem fixo do
   * manifesto do fantoma, independentemente da faixa planejada.
   */
  function contarCortes(plano, incrementoMm) {
    var L = comprimentoPlanoMm(plano);
    var inc = Number(incrementoMm);
    if (!(L > 0) || !(inc > 0)) return 0;
    return Math.max(1, Math.round(L / inc));
  }

  // ---------------------------------------------------------------------
  // Execução do scan — o dado BRUTO, antes de qualquer imagem
  // ---------------------------------------------------------------------
  var ESTADOS = ["ocioso", "scout", "planejando", "posicionando", "adquirindo", "reconstruindo", "revisao", "abortado"];

  function criarScanRun(o) {
    o = o || {};
    return {
      id: o.id || ("scan_" + Date.now()),
      estado: "ocioso",
      protocolo: o.protocolo || null,
      plano: o.plano || null,
      iniciadoEm: null,
      encerradoEm: null,
      progresso: 0,          // 0..1
      // Dados brutos da aquisição (projeções). Preenchido na Fase 4.
      bruto: null,
      // Grandezas medidas durante a execução, não digitadas.
      medidas: {
        comprimentoMm: 0,
        velocidadeMesaMmS: 0,
        masEfetivo: null,
        isoOffsetCm: null
      },
      eventos: []
    };
  }

  function registrarEvento(run, tipo, detalhe) {
    if (!run) return;
    run.eventos.push({ t: agoraISO(), tipo: tipo, detalhe: detalhe == null ? null : detalhe });
    return run;
  }

  function mudarEstado(run, estado) {
    if (ESTADOS.indexOf(estado) < 0) throw new Error("Estado de scan inválido: " + estado);
    run.estado = estado;
    if (estado === "scout" && !run.iniciadoEm) run.iniciadoEm = agoraISO();
    if (estado === "revisao" || estado === "abortado") run.encerradoEm = agoraISO();
    registrarEvento(run, "estado", estado);
    return run;
  }

  // ---------------------------------------------------------------------
  // Série reconstruída
  // ---------------------------------------------------------------------
  /**
   * Uma série é o resultado de APLICAR um conjunto de parâmetros de
   * reconstrução sobre um ScanRun. Vários conjuntos → várias séries do mesmo
   * dado bruto.
   */
  function criarSerie(o) {
    o = o || {};
    var rec = o.reconstrucao || {};
    return {
      seriesUID: o.seriesUID || novoUID(),
      numero: o.numero || 1,
      descricao: rec.nome || o.descricao || "Série",
      scanRunId: o.scanRunId || null,
      // Parâmetros que GERARAM esta série — precisam viajar até o DICOM.
      espessuraMm: rec.espessuraMm != null ? rec.espessuraMm : null,
      incrementoMm: rec.incrementoMm != null ? rec.incrementoMm : null,
      kernel: rec.kernel || "padrao",
      fovMm: rec.fovMm != null ? rec.fovMm : null,
      matriz: rec.matriz || 512,
      algoritmo: rec.algoritmo || "FBP",
      // Geometria do volume produzido.
      dims: o.dims || null,             // [nx, ny, nz]
      espacamentoMm: o.espacamentoMm || null,
      origemMm: o.origemMm || [0, 0, 0],
      janela: o.janela || { centro: 40, largura: 400 },
      // Pixels em HU (Int16). Preenchido na Fase 5.
      voxels: o.voxels || null,
      criadaEm: agoraISO()
    };
  }

  function criarEstudo(o) {
    o = o || {};
    return {
      studyUID: o.studyUID || novoUID(),
      frameOfReferenceUID: o.frameOfReferenceUID || novoUID(),
      paciente: o.paciente || null,
      dataHora: o.dataHora || agoraISO(),
      indicacao: o.indicacao || "",
      series: []
    };
  }

  function adicionarSerie(estudo, serie) {
    serie.numero = estudo.series.length + 1;
    estudo.series.push(serie);
    if (Core.bus) Core.bus.emit(Core.EVENTOS.SERIE_PRONTA, { estudo: estudo, serie: serie });
    return serie;
  }

  Core.model.novoUID = novoUID;
  Core.model.criarPlano = criarPlano;
  Core.model.comprimentoPlanoMm = comprimentoPlanoMm;
  Core.model.contarCortes = contarCortes;
  Core.model.criarScanRun = criarScanRun;
  Core.model.mudarEstado = mudarEstado;
  Core.model.registrarEvento = registrarEvento;
  Core.model.criarSerie = criarSerie;
  Core.model.criarEstudo = criarEstudo;
  Core.model.adicionarSerie = adicionarSerie;
  Core.model.SCAN_ESTADOS = ESTADOS;

})(typeof self !== "undefined" ? self : this);
