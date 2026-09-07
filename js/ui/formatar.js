/**
 * js/ui/formatar.js
 * Como este app escreve número: um lugar só.
 *
 * A interface é em português do Brasil, onde o separador decimal é a VÍRGULA.
 * `toFixed()` devolve ponto, sempre — e havia 31 chamadas dele espalhadas por
 * três arquivos, montando texto direto. O resultado era um app que dizia
 * "CTDIvol 87.0 mGy" e "colimação 38.4 mm" ao lado de um painel de parâmetros
 * que, por ter formatação própria, dizia "0,6 mm" e "0,5 s". A mesma tela,
 * duas convenções.
 *
 * Não é detalhe de gosto: número técnico com separador errado é o tipo de
 * coisa que um aluno copia para um caderno e depois digita num console de
 * verdade.
 *
 * Cada função aqui devolve o NÚMERO COM A UNIDADE, porque é assim que ele
 * aparece na tela — separar os dois só recria o problema um nível acima.
 * Valor ausente vira travessão, nunca "NaN" nem "undefined".
 *
 * A exceção declarada é `paraCampo`: `input[type=number]` REJEITA vírgula em
 * silêncio, e um valor formatado assim chega vazio ao editor. Já aconteceu
 * (ETAPA 5, com a colimação e o tempo de rotação); a regra fica registrada
 * aqui para não acontecer de novo.
 *
 * Script clássico. Carrega logo depois de js/shared.js.
 */
(function () {
  "use strict";

  var AUSENTE = "—";

  function ehNumero(v) { return typeof v === "number" && isFinite(v); }

  /** Número com vírgula. `casas` fixo; sem ele, mantém o que o valor tem. */
  function n(v, casas) {
    if (!ehNumero(v)) return AUSENTE;
    var s = (casas == null) ? String(v) : v.toFixed(casas);
    return s.replace(".", ",");
  }

  function com(unidade, casasPadrao) {
    return function (v, casas) {
      if (!ehNumero(v)) return AUSENTE;
      return n(v, casas == null ? casasPadrao : casas) + unidade;
    };
  }

  var fmt = {
    n: n,
    /** Comprimento em milímetros — faixa, espessura, colimação, FOV. */
    mm: com(" mm", 1),
    /** Comprimento em centímetros — isocentro, diâmetro efetivo. */
    cm: com(" cm", 1),
    /** Área — usada na ROI. */
    mm2: com(" mm²", 0),
    /** Ângulo do gantry, e a medida de ângulo do leitor. */
    graus: com("°", 0),
    /** Tempo de rotação. */
    s: com(" s", 1),
    /** Velocidade da mesa. */
    mmPorS: com(" mm/s", 0),
    /** Dose: CTDIvol e SSDE em mGy, DLP em mGy·cm, efetiva em mSv. */
    mGy: com(" mGy", 1),
    mGycm: com(" mGy·cm", 0),
    mSv: com(" mSv", 2),
    /** Unidades Hounsfield — a leitura quantitativa da imagem. */
    hu: com(" HU", 1),
    /** Fração da imagem, no planejamento da faixa. */
    pct: com("%", 0),

    /**
     * Valor para `input[type=number]`: decimal com PONTO.
     *
     * O navegador descarta em silêncio um valor com vírgula, e o campo aparece
     * vazio — o protocolo tem 0,6 mm de colimação, o editor mostra em branco, e
     * salvar por cima apagaria. Vazio quando não há número.
     */
    paraCampo: function (v) { return ehNumero(v) ? String(v) : ""; },

    AUSENTE: AUSENTE
  };

  window.SimTC = window.SimTC || {};
  SimTC.fmt = fmt;

})();
