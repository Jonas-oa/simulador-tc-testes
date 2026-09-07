/**
 * js/ui/confirmar.js
 * Uma confirmação só, para as decisões que não se desfazem.
 *
 * O app tinha duas: irradiar passava por um modal próprio, cuidadoso, com
 * resumo do exame, checklist e a consequência prevista; excluir um paciente ou
 * apagar um exame do histórico chamavam `window.confirm` do navegador.
 *
 * As duas ações IRREVERSÍVEIS usavam o mecanismo mais pobre — o que não deixa
 * dizer o que se perde, não se parece com o resto da tela, e num diálogo
 * nativo o botão de confirmar costuma ser o padrão do teclado.
 *
 * Aqui a confirmação diz o que vai acontecer, nomeia o que será perdido, e o
 * botão que destrói é o que se destaca — não o que se aperta sem ler.
 *
 * Devolve Promise<boolean>: `await` no lugar do `if (window.confirm(...))`.
 *
 * Script clássico. Carrega depois de js/shared.js.
 */
(function () {
  "use strict";

  var caixa = null, elTitulo = null, elTexto = null, elOk = null, elCancela = null;
  var resolverAtual = null;

  function montar() {
    if (caixa) return;
    caixa = document.createElement("div");
    caixa.className = "ui-confirma";
    caixa.hidden = true;
    caixa.setAttribute("role", "alertdialog");
    caixa.setAttribute("aria-modal", "true");
    caixa.setAttribute("aria-labelledby", "ui-confirma-titulo");
    caixa.setAttribute("aria-describedby", "ui-confirma-texto");
    caixa.innerHTML =
      '<div class="ui-confirma__painel">' +
        '<h3 class="ui-confirma__titulo" id="ui-confirma-titulo"></h3>' +
        '<p class="ui-confirma__texto" id="ui-confirma-texto"></p>' +
        '<div class="ui-confirma__acoes">' +
          '<button type="button" class="ws-btn ws-btn--ghost" data-ui="cancelar">Cancelar</button>' +
          '<button type="button" class="ws-btn ws-btn--danger" data-ui="ok"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(caixa);

    elTitulo = caixa.querySelector(".ui-confirma__titulo");
    elTexto = caixa.querySelector(".ui-confirma__texto");
    elOk = caixa.querySelector('[data-ui="ok"]');
    elCancela = caixa.querySelector('[data-ui="cancelar"]');

    elOk.addEventListener("click", function () { fechar(true); });
    elCancela.addEventListener("click", function () { fechar(false); });
    // Clicar fora e Esc CANCELAM. Numa decisão destrutiva, o caminho fácil
    // tem de ser o que não destrói.
    caixa.addEventListener("click", function (e) { if (e.target === caixa) fechar(false); });
    document.addEventListener("keydown", function (e) {
      if (!caixa.hidden && e.key === "Escape") { e.preventDefault(); fechar(false); }
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
   * Pergunta antes de uma ação que não se desfaz.
   *
   * @param {object} o
   * @param {string} o.titulo    o que está prestes a acontecer
   * @param {string} o.texto     o que se perde, em texto de operador
   * @param {string} [o.acao]    rótulo do botão que confirma ("Excluir")
   * @returns {Promise<boolean>}
   */
  function confirmar(o) {
    montar();
    o = o || {};
    elTitulo.textContent = o.titulo || "Confirmar";
    elTexto.textContent = o.texto || "";
    elOk.textContent = o.acao || "Confirmar";
    focoAnterior = document.activeElement;
    caixa.hidden = false;
    // O foco começa em CANCELAR: quem apertar Enter sem ler não destrói nada.
    elCancela.focus();
    return new Promise(function (res) { resolverAtual = res; });
  }

  window.SimTC = window.SimTC || {};
  SimTC.confirmar = confirmar;

})();
