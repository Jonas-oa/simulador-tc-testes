/**
 * js/ui/entrada.js
 * Modal de entrada de dados simples, substituindo window.prompt.
 * 
 * Mantém a estética e acessibilidade do app (ao contrário do prompt nativo),
 * permitindo cancelamento claro e confirmação por Enter.
 * 
 * Devolve Promise<string | null>: null se cancelado, string se confirmado.
 * 
 * Script clássico. Carrega depois de js/shared.js.
 */
(function () {
  "use strict";

  var caixa = null, elTitulo = null, elInput = null, elOk = null, elCancela = null, elForm = null;
  var resolverAtual = null;

  function montar() {
    if (caixa) return;
    caixa = document.createElement("div");
    caixa.className = "ui-confirma"; // reaproveitamos o estilo de confirmar.js
    caixa.hidden = true;
    caixa.setAttribute("role", "dialog");
    caixa.setAttribute("aria-modal", "true");
    caixa.setAttribute("aria-labelledby", "ui-entrada-titulo");
    caixa.innerHTML =
      '<div class="ui-confirma__painel">' +
        '<form id="ui-entrada-form">' +
          '<h3 class="ui-confirma__titulo" id="ui-entrada-titulo"></h3>' +
          '<div style="margin-bottom: var(--s-4);">' +
            '<input type="text" id="ui-entrada-input" class="ws-input" style="width: 100%;" />' +
          '</div>' +
          '<div class="ui-confirma__acoes">' +
            '<button type="button" class="ws-btn ws-btn--ghost" data-ui="cancelar">Cancelar</button>' +
            '<button type="submit" class="ws-btn ws-btn--primary" data-ui="ok">Confirmar</button>' +
          '</div>' +
        '</form>' +
      '</div>';
    document.body.appendChild(caixa);

    elTitulo = caixa.querySelector("#ui-entrada-titulo");
    elInput = caixa.querySelector("#ui-entrada-input");
    elOk = caixa.querySelector('[data-ui="ok"]');
    elCancela = caixa.querySelector('[data-ui="cancelar"]');
    elForm = caixa.querySelector("#ui-entrada-form");

    elForm.addEventListener("submit", function (e) {
      e.preventDefault();
      fechar(elInput.value);
    });

    elCancela.addEventListener("click", function () { fechar(null); });
    
    // Clicar fora e Esc CANCELAM.
    caixa.addEventListener("click", function (e) { if (e.target === caixa) fechar(null); });
    document.addEventListener("keydown", function (e) {
      if (!caixa.hidden && e.key === "Escape") { e.preventDefault(); fechar(null); }
    });
  }

  var focoAnterior = null;

  function fechar(resposta) {
    if (!caixa || caixa.hidden) return;
    caixa.hidden = true;
    var r = resolverAtual;
    resolverAtual = null;
    if (focoAnterior && focoAnterior.focus) { try { focoAnterior.focus(); } catch (e) {} }
    focoAnterior = null;
    if (r) r(resposta);
  }

  /**
   * Pede uma entrada de texto ao usuário (substitui window.prompt).
   *
   * @param {string} titulo     O rótulo/pergunta
   * @param {string} [valorPadrao] Valor pré-preenchido no input
   * @returns {Promise<string | null>}
   */
  function pedirEntrada(titulo, valorPadrao) {
    montar();
    elTitulo.textContent = titulo || "Entrada de dados";
    elInput.value = valorPadrao || "";
    
    focoAnterior = document.activeElement;
    caixa.hidden = false;
    
    // Foca o input, selecionando todo o texto pré-preenchido para facilitar
    elInput.focus();
    elInput.select();
    
    return new Promise(function (res) { resolverAtual = res; });
  }

  window.SimTC = window.SimTC || {};
  SimTC.pedirEntrada = pedirEntrada;

})();
