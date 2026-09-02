/**
 * core/dose/aec.js
 * Controle automático de exposição — modulação da corrente do tubo.
 *
 * A AEC é a diferença entre um exame que entrega ruído uniforme e um que
 * entrega ombros ruidosos e pulmões superexpostos. E ela só existe de verdade
 * quando REALIMENTA A IMAGEM: modular o mA e não mudar o ruído seria mais um
 * parâmetro decorativo, exatamente o que a auditoria encontrou em kV e mAs.
 *
 * Aqui a modulação sai do topograma — como no equipamento real, que usa o
 * scout para medir a atenuação do paciente ao longo do eixo Z — e o mA
 * resultante entra no cálculo de fótons de cada linha de detector.
 *
 * ESTRATÉGIAS (é onde os fabricantes divergem; a plataforma explica em vez de
 * escolher uma e silenciar as outras):
 *
 *   "mAsReferencia"  parte do mAs que produziria a qualidade desejada num
 *                    paciente PADRÃO e escala pela atenuação do paciente real.
 *                    É o raciocínio do CARE Dose4D da Siemens.
 *   "ruidoAlvo"      parte de um desvio-padrão alvo na imagem e resolve o mA
 *                    necessário para atingi-lo. É o raciocínio do SUREExposure
 *                    da Canon e, com outra parametrização, do DoseRight da
 *                    Philips (que trabalha com um nível de referência de
 *                    imagem).
 *
 * [APROXIMAÇÃO] O comportamento real de cada fabricante é proprietário e
 * envolve curvas de adaptação que não são publicadas. O que se reproduz aqui é
 * o PRINCÍPIO e a consequência mensurável, não a curva de um equipamento.
 *
 * SEM dependência de DOM. Script clássico.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};

  /**
   * Perfil de atenuação ao longo do eixo crânio-caudal, medido no volume.
   * É o que o topograma entrega ao equipamento real.
   *
   * @returns {{z:number[], integral:number[], mediana:number}}
   *   `integral` é ∫μ·dl médio daquele nível (adimensional).
   */
  function perfilAtenuacao(volume, inicioMm, fimMm, passoMm, kv) {
    var F = Core.fisica;
    var muAgua = F.muAgua(kv || 120);
    var nx = volume.dims[0], ny = volume.dims[1];
    var sx = volume.spacingMm[0];
    var passo = passoMm || volume.spacingMm[2];
    var z = [], integral = [];

    for (var pos = inicioMm; pos <= fimMm; pos += passo) {
      var iz = Math.round(pos / volume.spacingMm[2]);
      if (iz < 0 || iz >= volume.dims[2]) continue;
      var base = iz * nx * ny;
      // Média das integrais de linha horizontais: aproxima o que o feixe
      // "vê" atravessando o paciente naquele nível.
      var soma = 0, linhas = 0;
      for (var y = 0; y < ny; y += 4) {
        var acc = 0;
        for (var x = 0; x < nx; x++) {
          var hu = volume.dados[base + y * nx + x];
          acc += Math.max(0, 1 + hu / 1000);
        }
        soma += acc * muAgua * sx;
        linhas++;
      }
      z.push(pos);
      integral.push(linhas ? soma / linhas : 0);
    }

    var ord = integral.slice().sort(function (a, b) { return a - b; });
    var mediana = ord.length ? ord[Math.floor(ord.length / 2)] : 0;
    return { z: z, integral: integral, mediana: mediana };
  }

  /**
   * Modulação longitudinal do mA.
   *
   * Para manter o RUÍDO constante, a contagem de fótons transmitida precisa
   * ser constante:
   *
   *   N ∝ mA · e^(−∫μ) = constante   ⇒   mA ∝ e^(+∫μ)      [Poisson]
   *
   * Compensação total (α = 1) é o ideal teórico e a prática NÃO usa: os
   * ombros exigiriam correntes altas demais. Os equipamentos aplicam
   * compensação PARCIAL, aceitando algum aumento de ruído nas regiões mais
   * espessas em troca de dose. O expoente α expõe essa escolha ao aluno.
   *
   * @param {object} perfil        saída de perfilAtenuacao
   * @param {object} o
   * @param {number} o.masReferencia
   * @param {number} [o.alfa=0.6]  grau de compensação, 0 = sem modulação
   * @param {number} [o.masMin]    limites do tubo
   * @param {number} [o.masMax]
   */
  function modularLongitudinal(perfil, o) {
    var alfa = o.alfa == null ? 0.6 : o.alfa;
    var ref = o.masReferencia;
    var min = o.masMin != null ? o.masMin : ref * 0.25;
    var max = o.masMax != null ? o.masMax : ref * 3.0;
    var mas = [], somaMas = 0;

    for (var i = 0; i < perfil.integral.length; i++) {
      var delta = perfil.integral[i] - perfil.mediana;
      var v = ref * Math.exp(alfa * delta);
      if (v < min) v = min;
      if (v > max) v = max;
      mas.push(v);
      somaMas += v;
    }
    var medio = mas.length ? somaMas / mas.length : ref;
    return {
      z: perfil.z, mas: mas,
      masMedio: medio,
      // Razão entre o mAs médio modulado e o de referência: é o que diz se a
      // AEC POUPOU ou GASTOU dose neste paciente.
      razaoDose: ref > 0 ? medio / ref : 1,
      alfa: alfa, masMin: min, masMax: max
    };
  }

  /** mAs modulado na posição z (interpolado). */
  function masEm(modulacao, zMm) {
    if (!modulacao || !modulacao.z.length) return null;
    var z = modulacao.z, m = modulacao.mas;
    if (zMm <= z[0]) return m[0];
    if (zMm >= z[z.length - 1]) return m[m.length - 1];
    for (var i = 0; i < z.length - 1; i++) {
      if (zMm >= z[i] && zMm <= z[i + 1]) {
        var t = (zMm - z[i]) / (z[i + 1] - z[i]);
        return m[i] + (m[i + 1] - m[i]) * t;
      }
    }
    return modulacao.masMedio;
  }

  /**
   * Descrição didática do que a AEC fez, em linguagem de operador.
   */
  function explicar(modulacao) {
    if (!modulacao) return "AEC desligada — corrente fixa em todo o percurso.";
    var pct = Math.round((modulacao.razaoDose - 1) * 100);
    var mn = Math.min.apply(null, modulacao.mas);
    var mx = Math.max.apply(null, modulacao.mas);
    return "AEC ativa: corrente variou entre " + Math.round(mn) + " e " + Math.round(mx) +
      " mAs ao longo do exame (média " + Math.round(modulacao.masMedio) + " mAs, " +
      (pct >= 0 ? "+" : "") + pct + "% em relação à referência). " +
      "Compensação parcial (α = " + modulacao.alfa + "): regiões mais espessas recebem mais " +
      "corrente, mas não o bastante para igualar totalmente o ruído — é o compromisso " +
      "que os equipamentos reais adotam para não elevar demais a dose nos ombros.";
  }

  Core.aec = {
    perfilAtenuacao: perfilAtenuacao,
    modularLongitudinal: modularLongitudinal,
    masEm: masEm,
    explicar: explicar
  };

})(typeof self !== "undefined" ? self : this);
