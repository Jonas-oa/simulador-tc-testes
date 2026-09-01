/**
 * core/acquisition/fisica.js
 * Relações físicas da aquisição de TC.
 *
 * Cada constante e cada fórmula aqui declara sua natureza:
 *   [DEFINIÇÃO]    decorre da definição da grandeza
 *   [MEDIDO]       valor tabelado da literatura, com a fonte
 *   [APROXIMAÇÃO]  modelo educacional de primeira ordem, explicitamente simples
 *
 * A distinção importa: a plataforma é educacional, e apresentar uma
 * aproximação como se fosse exata é pior do que não modelar.
 *
 * SEM dependência de DOM. Script clássico.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};

  // Coeficiente de atenuação linear da água, por mm, na energia EFETIVA do
  // feixe de cada tensão de tubo. Um feixe de 120 kVp tem energia efetiva de
  // ~60-70 keV depois da filtração; não é monoenergético, e tratá-lo como tal
  // é a primeira das aproximações deste módulo.
  // [MEDIDO] NIST XCOM, μ/ρ da água; ρ = 1,0 g/cm³.
  var MU_AGUA_POR_MM = {
    70: 0.0261,   // ~45 keV efetivos
    80: 0.0243,   // ~50 keV
    100: 0.0214,  // ~57 keV
    120: 0.0193,  // ~65 keV
    140: 0.0178   // ~72 keV
  };

  var KV_REFERENCIA = 120;
  var MAS_REFERENCIA = 200;

  /**
   * Fótons por raio na referência. Não é contagem física de um tubo real: é a
   * escala que faz o ruído resultante ficar na ordem de grandeza correta para
   * uma TC de abdome a 120 kV / 200 mAs (σ ≈ 10-15 HU em água).
   * [APROXIMAÇÃO] calibrado para o resultado, não derivado do tubo.
   */
  var N0_REFERENCIA = 2.6e5;

  function interpolarMuAgua(kv) {
    var chaves = [70, 80, 100, 120, 140];
    if (kv <= chaves[0]) return MU_AGUA_POR_MM[chaves[0]];
    if (kv >= chaves[chaves.length - 1]) return MU_AGUA_POR_MM[chaves[chaves.length - 1]];
    for (var i = 0; i < chaves.length - 1; i++) {
      var a = chaves[i], b = chaves[i + 1];
      if (kv >= a && kv <= b) {
        var t = (kv - a) / (b - a);
        return MU_AGUA_POR_MM[a] + (MU_AGUA_POR_MM[b] - MU_AGUA_POR_MM[a]) * t;
      }
    }
    return MU_AGUA_POR_MM[120];
  }

  /**
   * Fator de realce de materiais de número atômico alto (osso, iodo) em kV
   * baixo.
   *
   * Por que existe: a HU é definida em relação à água NA ENERGIA DO EXAME.
   * Materiais com Z alto têm efeito fotoelétrico muito mais forte em energia
   * baixa (o iodo tem borda K em 33,2 keV), então o número de TC do iodo e do
   * osso SOBE quando se reduz o kV — é exatamente por isso que angiotomografia
   * usa 80-100 kV. Modelar isso exige decomposição de materiais, que está fora
   * do escopo; aqui se aplica um ganho apenas aos HU positivos.
   *
   * [APROXIMAÇÃO] de primeira ordem. Reproduz o SENTIDO e a ordem de grandeza
   * (iodo ~1,7× mais atenuante a 80 kVp que a 120 kVp), não o valor exato de
   * um material específico.
   */
  function ganhoZAlto(kv) {
    return Math.pow(KV_REFERENCIA / Math.max(40, kv), 0.6);
  }

  /**
   * Coeficiente de atenuação linear, por mm, de um voxel com dado HU na
   * tensão de tubo informada.
   *
   *   mu = mu_agua(kV) × (1 + HU/1000)        [DEFINIÇÃO de HU]
   *
   * com o ganho de Z alto aplicado à parte positiva.
   */
  function muDeHU(hu, kv) {
    var muAgua = interpolarMuAgua(kv);
    var rel = hu / 1000;
    if (rel > 0) rel *= ganhoZAlto(kv);
    return Math.max(0, muAgua * (1 + rel));
  }

  /**
   * mAs efetivo = mAs / pitch = mA × t_rot / pitch    [DEFINIÇÃO, AAPM]
   * É esta grandeza — não o mAs nominal — que governa o ruído: reduzir o pitch
   * pela metade dobra a exposição por corte, exatamente como dobrar o mAs.
   */
  function masEfetivo(mas, pitch, modo) {
    if (!(mas > 0)) return null;
    if (modo === "sequencial" || !(pitch > 0)) return mas;
    return mas / pitch;
  }

  /**
   * Fótons incidentes por raio detector.
   *
   *   N0 ∝ mAs_efetivo                        [DEFINIÇÃO] fluência ∝ carga
   *   N0 ∝ kV^2.5                             [APROXIMAÇÃO] a dose a mAs
   *        constante varia com kV^2,0-2,5 na literatura de otimização; o
   *        mesmo expoente é usado aqui para a fluência.
   *   N0 ∝ espessura de corte                 [DEFINIÇÃO] abertura do detector
   */
  function fotonsPorRaio(o) {
    var masEf = masEfetivo(o.mas, o.pitch, o.modo);
    if (!(masEf > 0)) return null;
    var kv = o.kv || KV_REFERENCIA;
    var esp = o.espessuraMm > 0 ? o.espessuraMm : 5;
    return N0_REFERENCIA
      * (masEf / MAS_REFERENCIA)
      * Math.pow(kv / KV_REFERENCIA, 2.5)
      * (esp / 5);
  }

  /**
   * Velocidade da mesa no helicoidal.
   *   v = pitch × colimação_total / t_rot     [DEFINIÇÃO]
   */
  function velocidadeMesaMmS(pitch, colimacaoMm, tempoRotacaoS) {
    if (!(tempoRotacaoS > 0)) return 0;
    return (pitch || 1) * (colimacaoMm || 0) / tempoRotacaoS;
  }

  /**
   * Tempo de aquisição de uma faixa no helicoidal.
   *   t = comprimento / v                     [DEFINIÇÃO]
   */
  function tempoAquisicaoS(comprimentoMm, velocidadeMmS) {
    if (!(velocidadeMmS > 0)) return 0;
    return comprimentoMm / velocidadeMmS;
  }

  /**
   * Desvio-padrão ESPERADO do ruído na imagem, em HU. Serve de referência
   * para os testes: o ruído medido na imagem reconstruída deve seguir esta
   * proporcionalidade, ainda que a constante dependa do reconstrutor.
   *
   *   σ ∝ 1/√(mAs_efetivo)                    [Poisson]
   *   σ ∝ 1/√(espessura)                      [Poisson]
   */
  function ruidoRelativo(o) {
    var n0 = fotonsPorRaio(o);
    return n0 > 0 ? 1 / Math.sqrt(n0) : Infinity;
  }

  Core.fisica = {
    MU_AGUA_POR_MM: MU_AGUA_POR_MM,
    KV_REFERENCIA: KV_REFERENCIA,
    MAS_REFERENCIA: MAS_REFERENCIA,
    N0_REFERENCIA: N0_REFERENCIA,
    muAgua: interpolarMuAgua,
    ganhoZAlto: ganhoZAlto,
    muDeHU: muDeHU,
    masEfetivo: masEfetivo,
    fotonsPorRaio: fotonsPorRaio,
    velocidadeMesaMmS: velocidadeMesaMmS,
    tempoAquisicaoS: tempoAquisicaoS,
    ruidoRelativo: ruidoRelativo
  };

})(typeof self !== "undefined" ? self : this);
