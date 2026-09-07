/**
 * app/contratos.js
 * Os acordos entre os módulos de tela, declarados em vez de improvisados.
 *
 * O QUE ISTO SUBSTITUI
 *
 * Cinco ponteiros nasciam `null` em js/shared.js e eram preenchidos por quem
 * coubesse, na ordem em que script.js chamava os init():
 *
 *     SimTC.tableDriveApi   <- sala-exame.js        -> lido por aquisicao.js
 *     SimTC.examSessionApi  <- cadastro-pacientes   -> lido por aquisicao.js
 *     SimTC.mprApi          <- aquisicao.js         -> lido por mpr.js, ui-layout.js
 *     SimTC.consoleUiApi    <- ui-layout.js         -> lido por aquisicao.js
 *
 * Toda leitura era defensiva (`if (SimTC.tableDriveApi) ...`), o que parece
 * prudente e não é: com a guarda, uma ordem de boot errada, um módulo que
 * falhou no meio ou um método renomeado NÃO davam erro — sumia uma
 * funcionalidade em silêncio, e o operador ficava com um botão que não faz
 * nada. Foi assim que a sala publicou `window.__ctSimulator` e o orquestrador
 * o descartou sem que ninguém percebesse.
 *
 * COMO FUNCIONA
 *
 * Quem oferece a API DECLARA o contrato; a declaração confere na hora se
 * todos os métodos combinados estão lá. Ao fim do boot, `verificar()` diz o
 * que ficou faltando. O acesso continua sendo `SimTC.<nome>` — os consumidores
 * não mudaram —, mas agora a ausência é dita em voz alta.
 *
 * A lista de métodos de cada contrato veio do que é REALMENTE consumido no
 * projeto, não do que por acaso existe no objeto: um contrato é o que o outro
 * lado tem direito de esperar, e nada além.
 *
 * `SimTC.examProtocol` fica de fora de propósito: é DADO compartilhado, não
 * uma API, e desde a ETAPA 4 o protocolo do exame também vive em
 * `Core.sessao.protocolo`. A ETAPA 5 decide se ele continua existindo.
 *
 * Script clássico — sem ES modules, sem bundler. Carrega logo depois de
 * js/shared.js e antes de qualquer módulo que declare contrato.
 */
(function () {
  "use strict";

  window.SimTC = window.SimTC || {};

  var CONTRATOS = {
    tableDriveApi: {
      quem: "js/sala-exame.js",
      paraQue: "comandar a mesa e o gantry a partir da aquisição",
      metodos: ["isPatientOnTable", "isBusy", "start", "stop", "getPos",
                "getIsoOffsetCm", "setGantryTilt", "setScan", "hintControl"]
    },
    examSessionApi: {
      quem: "js/cadastro-pacientes.js",
      paraQue: "saber de quem é o exame e arquivar o que foi feito",
      metodos: ["get", "end", "arquivar"]
    },
    mprApi: {
      quem: "js/aquisicao.js",
      paraQue: "entregar a série reconstruída ao leitor DICOM",
      metodos: ["hasVolume", "exportVolume"]
    },
    consoleUiApi: {
      quem: "js/ui-layout.js",
      paraQue: "a aquisição saber em que etapa do console guiado o aluno está",
      metodos: ["isConsole", "getStep"]
    }
  };

  var declarados = Object.create(null);
  var reclamados = Object.create(null);   // avisos já emitidos, para não repetir

  /**
   * Registra a API que cumpre um contrato.
   *
   * Confere os métodos na hora da declaração: um método faltando aqui vira um
   * erro visível no boot, e não uma funcionalidade que some meia hora depois,
   * quando o aluno aperta o botão.
   *
   * @param {string} nome  chave do contrato
   * @param {object} api   objeto que o cumpre
   * @returns {object} a própria api, para permitir `SimTC.x = declarar(...)`
   */
  function declarar(nome, api) {
    var c = CONTRATOS[nome];
    if (!c) {
      avisar('Contrato desconhecido: "' + nome + '". Declare-o em app/contratos.js.');
      window.SimTC[nome] = api;
      return api;
    }
    var faltando = c.metodos.filter(function (m) {
      return !api || typeof api[m] !== "function";
    });
    if (faltando.length) {
      avisar('O contrato "' + nome + '" foi declarado por ' + c.quem +
             " sem: " + faltando.join(", ") + ".");
    }
    declarados[nome] = { api: api, faltando: faltando };
    window.SimTC[nome] = api;
    return api;
  }

  /**
   * Obtém a API de um contrato. Devolve null quando ninguém a declarou — e,
   * ao contrário da guarda `if (SimTC.x)`, deixa registro da primeira vez.
   */
  function exigir(nome) {
    var d = declarados[nome];
    if (d) return d.api;
    if (!reclamados[nome]) {
      reclamados[nome] = true;
      var c = CONTRATOS[nome];
      avisar('Ninguém declarou o contrato "' + nome + '"' +
             (c ? " (esperado de " + c.quem + ", para " + c.paraQue + ")" : "") + ".");
    }
    return null;
  }

  /**
   * Relatório do boot: o que ficou faltando. Chamado por script.js depois de
   * inicializar todos os módulos.
   * @returns {{ok: boolean, ausentes: string[], incompletos: string[]}}
   */
  function verificar() {
    var ausentes = [], incompletos = [];
    Object.keys(CONTRATOS).forEach(function (nome) {
      var d = declarados[nome];
      if (!d) ausentes.push(nome + " (" + CONTRATOS[nome].quem + ")");
      else if (d.faltando.length) incompletos.push(nome + ": " + d.faltando.join(", "));
    });
    return { ok: !ausentes.length && !incompletos.length, ausentes: ausentes, incompletos: incompletos };
  }

  function avisar(texto) {
    if (window.console && console.error) console.error("[contratos] " + texto);
    if (window.SimTC && SimTC.showMessage) SimTC.showMessage("Falha de integração: " + texto, "error");
  }

  SimTC.contratos = {
    declarar: declarar,
    exigir: exigir,
    verificar: verificar,
    lista: function () { return Object.keys(CONTRATOS); }
  };

})();
