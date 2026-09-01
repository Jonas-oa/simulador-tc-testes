/**
 * core/bus.js
 * Barramento de eventos do núcleo do simulador.
 *
 * Substitui os ponteiros ad-hoc em window.SimTC (tableDriveApi,
 * examSessionApi, examProtocol, consoleUiApi, mprApi), em que cada módulo
 * precisava conhecer o objeto do outro e checar se já tinha sido preenchido.
 * Aqui quem produz apenas emite; quem consome apenas escuta.
 *
 * SEM dependência de DOM — carrega tanto via <script> na página quanto via
 * importScripts() dentro de um Worker. Script clássico, sem ES modules.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};

  function Bus() {
    this._ouvintes = Object.create(null);
    this._ultimo = Object.create(null); // último payload por evento (para replay)
  }

  /**
   * Assina um evento. Devolve a função de cancelamento.
   * Com `replay`, entrega imediatamente o último valor emitido, se houver —
   * resolve a corrida de "assinei depois de o evento já ter acontecido",
   * que era exatamente a origem do bug do handshake do leitor DICOM.
   */
  Bus.prototype.on = function (evento, fn, replay) {
    if (typeof fn !== "function") throw new TypeError("ouvinte precisa ser função");
    var lista = this._ouvintes[evento] || (this._ouvintes[evento] = []);
    lista.push(fn);
    if (replay && Object.prototype.hasOwnProperty.call(this._ultimo, evento)) {
      try { fn(this._ultimo[evento], evento); } catch (e) { relatar(evento, e); }
    }
    var self = this;
    return function () { self.off(evento, fn); };
  };

  Bus.prototype.once = function (evento, fn) {
    var cancelar = this.on(evento, function (dados, nome) {
      cancelar();
      fn(dados, nome);
    });
    return cancelar;
  };

  Bus.prototype.off = function (evento, fn) {
    var lista = this._ouvintes[evento];
    if (!lista) return;
    var i = lista.indexOf(fn);
    if (i >= 0) lista.splice(i, 1);
    if (!lista.length) delete this._ouvintes[evento];
  };

  /**
   * Emite para todos os assinantes. Um ouvinte que lança NÃO interrompe os
   * demais — num console de aquisição, uma falha de render não pode parar a
   * física.
   */
  Bus.prototype.emit = function (evento, dados) {
    this._ultimo[evento] = dados;
    var lista = this._ouvintes[evento];
    if (!lista || !lista.length) return 0;
    var copia = lista.slice(); // ouvinte pode cancelar a própria assinatura
    for (var i = 0; i < copia.length; i++) {
      try { copia[i](dados, evento); } catch (e) { relatar(evento, e); }
    }
    return copia.length;
  };

  /** Último valor emitido de um evento, ou undefined. */
  Bus.prototype.ultimo = function (evento) { return this._ultimo[evento]; };

  Bus.prototype.contagem = function (evento) {
    var l = this._ouvintes[evento];
    return l ? l.length : 0;
  };

  /** Descarta ouvintes e histórico — usado nos testes. */
  Bus.prototype.limpar = function () {
    this._ouvintes = Object.create(null);
    this._ultimo = Object.create(null);
  };

  function relatar(evento, e) {
    if (raiz.console && raiz.console.error) {
      raiz.console.error("[bus] ouvinte de \"" + evento + "\" falhou:", e);
    }
  }

  // Catálogo dos eventos do domínio. Manter aqui evita divergência de
  // grafia entre emissor e ouvinte (o erro mais comum em barramentos).
  Core.EVENTOS = {
    // paciente / worklist
    PACIENTE_ADICIONADO: "paciente:adicionado",
    PACIENTE_REMOVIDO: "paciente:removido",
    EXAME_SELECIONADO: "exame:selecionado",
    EXAME_ENCERRADO: "exame:encerrado",
    // protocolo
    PROTOCOLO_SELECIONADO: "protocolo:selecionado",
    PROTOCOLO_ALTERADO: "protocolo:alterado",
    // mesa / sala
    MESA_MOVEU: "mesa:moveu",
    MESA_ESTADO: "mesa:estado",
    PACIENTE_POSICIONADO: "paciente:posicionado",
    // aquisição
    FASE_MUDOU: "aquisicao:fase",
    SCAN_PROGRESSO: "aquisicao:progresso",
    SCAN_CONCLUIDO: "aquisicao:concluido",
    SCAN_ABORTADO: "aquisicao:abortado",
    // saída
    SERIE_PRONTA: "serie:pronta"
  };

  Core.Bus = Bus;
  Core.bus = new Bus();

})(typeof self !== "undefined" ? self : this);
