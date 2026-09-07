/**
 * js/ui/campo.js
 * Fábrica de elementos de campo (pares chave/valor, mensagens vazias)
 * para erradicar a concatenação de strings HTML nos módulos.
 */
(function () {
  "use strict";

  /** Cria um elemento DOM genérico */
  function el(tag, classe, filhos) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (filhos) {
      if (!Array.isArray(filhos)) filhos = [filhos];
      filhos.forEach(function (f) {
        if (f == null) return;
        if (typeof f === "string" || typeof f === "number") e.appendChild(document.createTextNode(f));
        else e.appendChild(f);
      });
    }
    return e;
  }

  /**
   * Cria um campo de leitura Chave-Valor.
   * Ex: <div class="baseClass"><span class="baseClass__k">Chave</span><span class="baseClass__v">Valor</span></div>
   */
  function par(chave, valor, baseClass, fullWidth) {
    var c = baseClass || "acq-param";
    if (fullWidth) c += " " + (baseClass || "acq-param") + "--full";
    return el("div", c, [
      el("span", (baseClass || "acq-param") + "__k", chave),
      el("span", (baseClass || "acq-param") + "__v", valor != null && valor !== "" ? String(valor) : "—")
    ]);
  }

  /**
   * Cria um parágrafo de aviso/vazio.
   */
  function vazio(mensagem, cssClass) {
    return el("p", cssClass || "acq-params__empty", mensagem);
  }

  window.SimTC = window.SimTC || {};
  SimTC.ui = SimTC.ui || {};
  SimTC.ui.campo = { el: el, par: par, vazio: vazio };

})();
