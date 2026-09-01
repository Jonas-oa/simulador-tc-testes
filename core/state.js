/**
 * core/state.js
 * Estado único da sessão de exame.
 *
 * Reúne worklist, protocolo selecionado, plano e execução do scan num só
 * lugar, com transições explícitas. Antes esse estado estava espalhado por
 * closures de cinco módulos de interface, e a única forma de saber "de quem é
 * o exame" era ler o último item de um array dentro do módulo de cadastro.
 *
 * Toda mudança relevante é anunciada no barramento — nenhuma tela é
 * consultada nem chamada diretamente daqui.
 *
 * SEM dependência de DOM. Script clássico.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};
  var M = Core.model;
  var EV = Core.EVENTOS;

  function Sessao(opts) {
    opts = opts || {};
    this.bus = opts.bus || Core.bus;
    this.worklist = new M.Worklist(this.bus);
    this.protocolo = null;     // protocolo normalizado
    this.estudo = null;        // estudo do exame corrente
    this.scan = M.criarScanRun();
    this.mesa = { posM: 0, alturaM: 0.8, pacienteNaMesa: false, isoOffsetCm: null };
  }

  // ---- protocolo -------------------------------------------------------
  Sessao.prototype.selecionarProtocolo = function (cru) {
    this.protocolo = cru ? M.normalizarProtocolo(cru) : null;
    this.bus.emit(EV.PROTOCOLO_SELECIONADO, this.protocolo);
    return this.protocolo;
  };

  // ---- exame -----------------------------------------------------------
  /**
   * Abre o exame do paciente selecionado. Exige seleção EXPLÍCITA — não
   * assume "o último cadastrado", que era o comportamento anterior.
   */
  Sessao.prototype.abrirExame = function () {
    var p = this.worklist.selecionado();
    if (!p) throw new Error("Selecione o paciente na lista de trabalho antes de iniciar o exame.");
    this.estudo = M.criarEstudo({
      paciente: p,
      indicacao: this.protocolo ? this.protocolo.indicacao : ""
    });
    this.scan = M.criarScanRun({ protocolo: this.protocolo });
    return this.estudo;
  };

  /** Encerra o exame preservando o paciente na lista de trabalho. */
  Sessao.prototype.encerrarExame = function () {
    var p = this.worklist.encerrarExame();
    this.estudo = null;
    this.scan = M.criarScanRun();
    return p;
  };

  // ---- plano -----------------------------------------------------------
  Sessao.prototype.definirPlano = function (o) {
    var plano = M.criarPlano(o);
    this.scan.plano = plano;
    this.scan.medidas.comprimentoMm = M.comprimentoPlanoMm(plano);
    return plano;
  };

  /**
   * Quantos cortes cada reconstrução do protocolo produzirá para o plano
   * atual. Devolve [] quando falta plano ou incremento — a interface deve
   * dizer o que falta em vez de exibir um número inventado.
   */
  Sessao.prototype.cortesPorReconstrucao = function () {
    if (!this.scan.plano || !this.protocolo) return [];
    var plano = this.scan.plano;
    return this.protocolo.reconstrucoes.map(function (r) {
      return {
        nome: r.nome,
        incrementoMm: r.incrementoMm,
        espessuraMm: r.espessuraMm,
        cortes: M.contarCortes(plano, r.incrementoMm)
      };
    });
  };

  // ---- scan ------------------------------------------------------------
  Sessao.prototype.mudarFase = function (estado) {
    M.mudarEstado(this.scan, estado);
    this.bus.emit(EV.FASE_MUDOU, { estado: estado, scan: this.scan });
    return this.scan;
  };

  Sessao.prototype.progresso = function (k) {
    this.scan.progresso = Math.max(0, Math.min(1, Number(k) || 0));
    this.bus.emit(EV.SCAN_PROGRESSO, this.scan.progresso);
    return this.scan.progresso;
  };

  // ---- mesa ------------------------------------------------------------
  Sessao.prototype.atualizarMesa = function (estado) {
    var m = this.mesa;
    if (estado.posM != null) m.posM = estado.posM;
    if (estado.alturaM != null) m.alturaM = estado.alturaM;
    if (estado.pacienteNaMesa != null) m.pacienteNaMesa = !!estado.pacienteNaMesa;
    if (estado.isoOffsetCm !== undefined) m.isoOffsetCm = estado.isoOffsetCm;
    this.bus.emit(EV.MESA_ESTADO, m);
    return m;
  };

  /**
   * Pré-requisitos para irradiar. Devolve a lista do que FALTA, em texto de
   * operador. Lista vazia = pode iniciar.
   */
  Sessao.prototype.pendenciasParaIniciar = function () {
    var faltas = [];
    if (!this.worklist.selecionado()) faltas.push("Selecionar o paciente na lista de trabalho.");
    if (!this.protocolo) faltas.push("Selecionar o protocolo.");
    if (!this.mesa.pacienteNaMesa) faltas.push("Posicionar o paciente na mesa.");
    if (this.protocolo && this.protocolo.aquisicao.kv == null) faltas.push("Definir o kV no protocolo.");
    if (this.protocolo && this.protocolo.aquisicao.mas == null) faltas.push("Definir o mAs no protocolo.");
    return faltas;
  };

  Core.Sessao = Sessao;
  Core.sessao = new Sessao();

})(typeof self !== "undefined" ? self : this);
