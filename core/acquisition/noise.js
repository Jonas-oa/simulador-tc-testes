/**
 * core/acquisition/noise.js
 * Estatística de fótons — a origem do ruído da imagem.
 *
 * Este é o módulo que faz o mAs importar de verdade. Na versão auditada, o
 * ruído não existia: mudar mAs de 300 para 30 devolvia a imagem BYTE A BYTE
 * IDÊNTICA (B-02). A alternativa preguiçosa seria desenhar ruído proporcional
 * a 1/√mAs. Aqui não se desenha ruído: sorteia-se a contagem de fótons, e a
 * relação σ ∝ 1/√mAs EMERGE — junto com tudo que vem de brinde (o ruído
 * cresce onde o paciente é mais espesso, porque lá chegam menos fótons).
 *
 *   N ~ Poisson(N0 · e^(−∫μ·dl))     detecção
 *   p = −ln(N / N0)                   projeção medida
 *
 * SEM dependência de DOM. Script clássico.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};

  /**
   * Gerador congruente linear com semente. Math.random() não é semeável, e
   * sem semente os testes de física ficam não determinísticos — não daria
   * para afirmar "dobrar o mAs reduziu o ruído em √2 ± 10%" de forma
   * reprodutível.
   */
  function Aleatorio(semente) {
    this.s = (semente >>> 0) || 88675123;
  }
  Aleatorio.prototype.uniforme = function () {
    // xorshift32 — barato e de qualidade suficiente para ruído de imagem
    var x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.s = x;
    return (x >>> 8) / 16777216;   // 24 bits em [0,1)
  };
  /** Normal padrão por Box-Muller. */
  Aleatorio.prototype.normal = function () {
    if (this._guardado != null) { var g = this._guardado; this._guardado = null; return g; }
    var u1 = Math.max(1e-12, this.uniforme()), u2 = this.uniforme();
    var r = Math.sqrt(-2 * Math.log(u1)), t = 2 * Math.PI * u2;
    this._guardado = r * Math.sin(t);
    return r * Math.cos(t);
  };

  /**
   * Amostra de Poisson(lambda).
   *
   * Para lambda pequeno usa o método de Knuth (produto de uniformes). Para
   * lambda grande (>30) o Knuth fica lento e o produto satura em zero; ali a
   * normal de mesma média e variância é indistinguível na prática — e é o
   * regime em que a TC opera (dezenas de milhares de fótons por raio).
   */
  Aleatorio.prototype.poisson = function (lambda) {
    if (!(lambda > 0)) return 0;
    if (lambda < 30) {
      var L = Math.exp(-lambda), k = 0, p = 1;
      do { k++; p *= this.uniforme(); } while (p > L);
      return k - 1;
    }
    var v = Math.round(lambda + Math.sqrt(lambda) * this.normal());
    return v < 0 ? 0 : v;
  };

  /**
   * Converte um sinograma de linhas-integrais IDEAIS em um sinograma MEDIDO,
   * com ruído de contagem.
   *
   * @param {Float32Array} integrais  ∫μ·dl por raio (adimensional)
   * @param {number} n0               fótons incidentes por raio
   * @param {object} [opts]
   * @param {number} [opts.semente]
   * @param {number} [opts.ruidoEletronicoDP=8]  desvio-padrão do ruído de
   *        leitura, em contagens. Domina quando pouquíssimos fótons chegam
   *        (paciente muito espesso, mAs muito baixo) e é o que produz as
   *        estrias de foto-inanição.
   * @returns {Float32Array} projeções medidas p = −ln(N/N0)
   */
  function aplicarRuido(integrais, n0, opts) {
    opts = opts || {};
    var rnd = new Aleatorio(opts.semente || 12345);
    var dpEletronico = opts.ruidoEletronicoDP == null ? 8 : opts.ruidoEletronicoDP;
    var saida = new Float32Array(integrais.length);
    // Piso de contagem: sem ele, N=0 produz −ln(0) = Infinito e a imagem
    // inteira se perde por causa de um único raio.
    var piso = 0.5;

    for (var i = 0; i < integrais.length; i++) {
      var esperado = n0 * Math.exp(-integrais[i]);
      var n = rnd.poisson(esperado);
      if (dpEletronico > 0) n += rnd.normal() * dpEletronico;
      if (n < piso) n = piso;
      saida[i] = -Math.log(n / n0);
    }
    return saida;
  }

  /**
   * Variante determinística: mesma média, sem sorteio. Serve para comparar
   * "a imagem que existiria sem ruído" nos testes e no material didático.
   */
  function semRuido(integrais) {
    return integrais.slice ? Float32Array.from(integrais) : integrais;
  }

  Core.ruido = {
    Aleatorio: Aleatorio,
    aplicarRuido: aplicarRuido,
    semRuido: semRuido
  };

})(typeof self !== "undefined" ? self : this);
