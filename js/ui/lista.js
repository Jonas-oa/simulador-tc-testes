/**
 * js/ui/lista.js
 * Fábrica de elementos de lista e itens para os painéis, 
 * substituindo innerHTML concatenado.
 */
(function () {
  "use strict";

  var el = window.SimTC && SimTC.ui && SimTC.ui.campo && SimTC.ui.campo.el;
  if (!el) {
    el = function(tag, classe, filhos) {
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
    };
  }

  /**
   * Cria um item da sequência de passos (aquisicao).
   * 
   * @param {number|string} numero 
   * @param {string} nome 
   * @param {string} subNome 
   * @param {string} estado "active", "done" ou "pending"
   * @param {string} rotulo "em curso", "concluído", "aguardando"
   */
  function passoDeAquisicao(numero, nome, subNome, estado, rotulo) {
    return el("li", "acq-step is-" + estado, [
      el("span", "acq-step__num", numero),
      el("span", "acq-step__body", [
        el("span", "acq-step__name", nome),
        el("span", "acq-step__sub", subNome)
      ]),
      el("span", "acq-step__state", rotulo)
    ]);
  }

  /** Cria uma tabela simples (usada na comparação de protocolos) */
  function tabelaComparacao(cabecalhoEsquerda, cabecalhoMeio, cabecalhoDireita, linhasInfo) {
    var thead = el("thead", null, el("tr", null, [
      el("th", null, cabecalhoEsquerda),
      el("th", null, cabecalhoMeio),
      el("th", null, cabecalhoDireita)
    ]));

    var tbody = el("tbody", null, linhasInfo.map(function (L) {
      var diffClass = L.temDiferenca ? "is-dif" : null;
      var c1 = document.createElement("th"); c1.scope = "row"; c1.textContent = L.parametro;
      var c2 = el("td", null, L.valorA);
      var c3 = el("td", diffClass, L.valorB);
      if (L.htmlA) c2.innerHTML = L.htmlA;
      if (L.htmlB) c3.innerHTML = L.htmlB;
      return el("tr", null, [c1, c2, c3]);
    }));

    return el("table", "proto-cmp__tab", [thead, tbody]);
  }

  window.SimTC = window.SimTC || {};
  SimTC.ui = SimTC.ui || {};
  SimTC.ui.lista = {
    passoDeAquisicao: passoDeAquisicao,
    tabelaComparacao: tabelaComparacao
  };

})();
