/**
 * core/model/patient.js
 * Paciente e lista de trabalho (worklist).
 *
 * Corrige B-10 da auditoria. Antes, "o paciente do exame" era inferido como
 * `pacientes[pacientes.length - 1]` — o ÚLTIMO CADASTRADO. Cadastrar um
 * segundo paciente sequestrava silenciosamente o exame em curso, e encerrar
 * o exame APAGAVA o registro do banco. Nenhum console de TC funciona assim:
 * existe uma lista de trabalho e o operador SELECIONA de quem é o exame.
 *
 * Aqui: seleção explícita, encerrar não apaga, e excluir é ação separada.
 *
 * SEM dependência de DOM. Script clássico.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};
  Core.model = Core.model || {};

  var SEXOS = ["M", "F", "O", ""];

  function texto(v, max) {
    if (v == null) return "";
    var s = String(v).trim();
    return max ? s.slice(0, max) : s;
  }

  function numeroOuNulo(v, min, max) {
    if (v === "" || v == null) return null;
    var n = Number(String(v).replace(",", "."));
    if (!isFinite(n)) return null;
    if (typeof min === "number" && n < min) return null;
    if (typeof max === "number" && n > max) return null;
    return n;
  }

  /**
   * Normaliza a entrada crua do formulário num paciente válido.
   * Campos numéricos passam a ser NÚMERO ou null — nunca string. Idade,
   * peso e altura fora de faixa plausível viram null em vez de propagarem
   * lixo para o cálculo de dose (a auditoria aceitava idade "-999").
   *
   * pesoKg e alturaCm são novos: a Fase 6 precisa deles para modular a
   * corrente por tamanho do paciente, que é como a AEC real funciona.
   */
  function criarPaciente(cru) {
    cru = cru || {};
    var nome = texto(cru.nome, 120);
    if (!nome) throw new Error("Informe o nome do paciente.");
    var sexo = texto(cru.sexo, 1).toUpperCase();
    if (SEXOS.indexOf(sexo) < 0) sexo = "";

    return {
      id: cru.id || ("pac_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
      prontuario: texto(cru.prontuario, 40),
      nome: nome,
      sexo: sexo,
      idadeAnos: numeroOuNulo(cru.idadeAnos != null ? cru.idadeAnos : cru.idade, 0, 130),
      pesoKg: numeroOuNulo(cru.pesoKg, 0.3, 400),
      alturaCm: numeroOuNulo(cru.alturaCm, 20, 260),
      regiao: texto(cru.regiao, 40),
      criadoEm: cru.criadoEm || new Date().toISOString()
    };
  }

  /** Rótulo curto para listas. Nunca devolve marcação — só texto. */
  function resumoPaciente(p) {
    if (!p) return "";
    var partes = [];
    if (p.prontuario) partes.push("Pront. " + p.prontuario);
    if (p.sexo) partes.push(p.sexo);
    if (p.idadeAnos != null) partes.push(p.idadeAnos + " anos");
    if (p.pesoKg != null) partes.push(p.pesoKg + " kg");
    if (p.regiao) partes.push(p.regiao);
    return partes.join(" · ");
  }

  /**
   * Lista de trabalho. Guarda os pacientes e QUAL deles está em exame.
   * A seleção é explícita: adicionar não seleciona, encerrar não exclui.
   */
  function Worklist(bus) {
    this._itens = [];
    this._selecionadoId = null;
    this._bus = bus || (Core.bus || null);
  }

  Worklist.prototype._emitir = function (evento, dados) {
    if (this._bus) this._bus.emit(evento, dados);
  };

  Worklist.prototype.carregar = function (lista) {
    this._itens = (lista || []).map(function (p) {
      try { return criarPaciente(p); } catch (e) { return null; }
    }).filter(Boolean);
    if (this._selecionadoId && !this.porId(this._selecionadoId)) this._selecionadoId = null;
    return this;
  };

  Worklist.prototype.todos = function () { return this._itens.slice(); };
  Worklist.prototype.quantidade = function () { return this._itens.length; };

  Worklist.prototype.porId = function (id) {
    for (var i = 0; i < this._itens.length; i++) {
      if (this._itens[i].id === id) return this._itens[i];
    }
    return null;
  };

  /** Adiciona SEM selecionar — cadastrar não sequestra o exame em curso. */
  Worklist.prototype.adicionar = function (cru) {
    var p = criarPaciente(cru);
    this._itens.push(p);
    this._emitir(Core.EVENTOS.PACIENTE_ADICIONADO, p);
    return p;
  };

  /** Seleciona quem faz o exame. null limpa a seleção. */
  Worklist.prototype.selecionar = function (id) {
    if (id == null) {
      this._selecionadoId = null;
      this._emitir(Core.EVENTOS.EXAME_SELECIONADO, null);
      return null;
    }
    var p = this.porId(id);
    if (!p) throw new Error("Paciente não está na lista de trabalho.");
    this._selecionadoId = id;
    this._emitir(Core.EVENTOS.EXAME_SELECIONADO, p);
    return p;
  };

  Worklist.prototype.selecionado = function () {
    return this._selecionadoId ? this.porId(this._selecionadoId) : null;
  };

  /**
   * Encerra o exame: apenas LIMPA a seleção. O registro permanece na lista,
   * ao contrário do comportamento anterior, que apagava o paciente do banco
   * ao apertar Stop.
   */
  Worklist.prototype.encerrarExame = function () {
    var p = this.selecionado();
    this._selecionadoId = null;
    this._emitir(Core.EVENTOS.EXAME_ENCERRADO, p);
    return p;
  };

  /** Exclusão é ação separada e deliberada. */
  Worklist.prototype.remover = function (id) {
    var i = -1;
    for (var k = 0; k < this._itens.length; k++) if (this._itens[k].id === id) { i = k; break; }
    if (i < 0) return null;
    var p = this._itens.splice(i, 1)[0];
    if (this._selecionadoId === id) this.encerrarExame();
    this._emitir(Core.EVENTOS.PACIENTE_REMOVIDO, p);
    return p;
  };

  Core.model.criarPaciente = criarPaciente;
  Core.model.resumoPaciente = resumoPaciente;
  Core.model.Worklist = Worklist;

})(typeof self !== "undefined" ? self : this);
