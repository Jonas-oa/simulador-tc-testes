/**
 * core/dose/ctdi.js
 * Dose: CTDIvol, DLP, SSDE e dose efetiva.
 *
 * Substitui o modelo auditado, em que o CTDIvol era um TEXTO DIGITADO no
 * protocolo ("≈55 mGy (ref.)") e lido por expressão regular. Consequência
 * direta: mudar o kV ou o mAs não mudava a dose, e um paciente de 45 kg
 * recebia o mesmo número que um de 120 kg.
 *
 * Aqui o CTDIvol é calculado, e a dose específica por tamanho (SSDE) usa o
 * diâmetro efetivo medido NO PRÓPRIO VOLUME — não uma estimativa por peso.
 *
 * NATUREZA DE CADA NÚMERO:
 *   [DEFINIÇÃO]    decorre da definição da grandeza
 *   [PUBLICADO]    ajuste ou fator de norma/relatório citado
 *   [APROXIMAÇÃO]  modelo educacional; a interface diz isso ao aluno
 *
 * SEM dependência de DOM. Script clássico.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};

  /**
   * CTDIw normalizado, em mGy por 100 mAs, a 120 kVp.
   *
   * [APROXIMAÇÃO] Não existe "o" valor: depende do tomógrafo, da filtração e
   * da geometria. A literatura reporta 7–24 mGy/100 mAs a 120 kVp no fantoma
   * de corpo. Adotamos valores centrais e a interface deixa claro que são de
   * referência, não do equipamento do usuário.
   *
   * Fantoma de CABEÇA = PMMA 16 cm; de CORPO = PMMA 32 cm. Confundir os dois
   * é o erro clássico de leitura de dose — o mesmo exame "vale" mais que o
   * dobro no fantoma pequeno.
   */
  var CTDIW_POR_100MAS_120KV = {
    cabeca: 29.0,   // fantoma 16 cm
    corpo: 12.0     // fantoma 32 cm
  };

  /** Regiões que se referem ao fantoma de cabeça. */
  var REGIOES_CABECA = ["Crânio", "Cranio", "Face", "Seios da face", "Órbitas", "ATM", "Pescoço", "Pescoco"];

  function fantomaDaRegiao(regiao) {
    return REGIOES_CABECA.indexOf(regiao) >= 0 ? "cabeca" : "corpo";
  }

  /**
   * CTDIw para kV e mAs dados.
   *   CTDIw ∝ mAs                       [DEFINIÇÃO] linear com a carga
   *   CTDIw ∝ kV^2.5                     [APROXIMAÇÃO] a literatura de
   *          otimização reporta expoente 2,0–2,5; usamos o mesmo do modelo de
   *          fluência, para que dose e ruído fiquem coerentes entre si.
   */
  function ctdiw(o) {
    var base = CTDIW_POR_100MAS_120KV[o.fantoma || "corpo"];
    var kv = o.kv || 120;
    var mas = o.mas;
    if (!(mas > 0)) return null;
    return base * (mas / 100) * Math.pow(kv / 120, 2.5);
  }

  /**
   * CTDIvol = CTDIw / pitch            [DEFINIÇÃO]
   * No modo sequencial sem sobreposição, pitch = 1 por definição.
   */
  function ctdivol(o) {
    var w = ctdiw(o);
    if (w == null) return null;
    var pitch = (o.modo === "sequencial" || !(o.pitch > 0)) ? 1 : o.pitch;
    return w / pitch;
  }

  /**
   * DLP = CTDIvol × comprimento_irradiado (cm)    [DEFINIÇÃO]
   */
  function dlp(ctdivolMGy, comprimentoMm) {
    if (!(ctdivolMGy > 0) || !(comprimentoMm > 0)) return null;
    return ctdivolMGy * (comprimentoMm / 10);
  }

  /**
   * Fatores k de conversão DLP → dose efetiva, em mSv/(mGy·cm), adulto.
   * [PUBLICADO] ordem de grandeza dos fatores europeus (EUR 16262) e do
   * AAPM Report 96. São ESTIMATIVAS: a dose efetiva depende do sexo, da
   * idade e da composição do paciente.
   */
  var K_POR_REGIAO = {
    "Crânio": 0.0021, "Cranio": 0.0021, "Face": 0.0021,
    "Seios da face": 0.0021, "Órbitas": 0.0021, "ATM": 0.0021,
    "Pescoço": 0.0059, "Pescoco": 0.0059,
    "Tórax": 0.014, "Torax": 0.014,
    "Abdome": 0.015, "Pelve": 0.015,
    "Coluna": 0.015, "Membros": 0.0008
  };

  function doseEfetiva(dlpMGyCm, regiao) {
    var k = K_POR_REGIAO[regiao];
    if (k == null || !(dlpMGyCm > 0)) return null;
    return { mSv: dlpMGyCm * k, k: k };
  }

  /**
   * DIÂMETRO EFETIVO do paciente, medido no volume.
   *
   *   Deff = 2·√(A/π)        [DEFINIÇÃO, AAPM 204]
   *
   * onde A é a área da secção transversal do paciente. Medir no volume é
   * melhor que estimar por peso: é o que o próprio relatório define, e o dado
   * já está disponível.
   *
   * @param {Volume} volume
   * @param {number} centroMm  posição no eixo crânio-caudal
   * @param {number} [limiarHU=-300]  acima disso é paciente, abaixo é ar/mesa
   */
  function diametroEfetivoMm(volume, centroMm, limiarHU) {
    var lim = limiarHU == null ? -300 : limiarHU;
    var nx = volume.dims[0], ny = volume.dims[1];
    var iz = Math.round(centroMm / volume.spacingMm[2]);
    iz = Math.max(0, Math.min(volume.dims[2] - 1, iz));
    var base = iz * nx * ny;
    var contagem = 0;
    for (var i = 0; i < nx * ny; i++) if (volume.dados[base + i] > lim) contagem++;
    if (!contagem) return null;
    var areaMm2 = contagem * volume.spacingMm[0] * volume.spacingMm[1];
    return 2 * Math.sqrt(areaMm2 / Math.PI);
  }

  /**
   * SSDE = CTDIvol × f(Deff)             [PUBLICADO, AAPM Report 204]
   *
   * Ajustes exponenciais do relatório:
   *   f₃₂(D) = 3,704369 · e^(−0,03671937·D)
   *   f₁₆(D) = 1,874799 · e^(−0,03871313·D)
   * com D em cm.
   *
   * É a correção que faltava: o CTDIvol é a dose no FANTOMA, não no paciente.
   * Um adulto magro recebe mais que o CTDIvol sugere; um obeso, menos.
   */
  function fatorSSDE(diametroEfetivoCm, fantoma) {
    if (!(diametroEfetivoCm > 0)) return null;
    return (fantoma === "cabeca")
      ? 1.874799 * Math.exp(-0.03871313 * diametroEfetivoCm)
      : 3.704369 * Math.exp(-0.03671937 * diametroEfetivoCm);
  }

  function ssde(ctdivolMGy, diametroEfetivoCm, fantoma) {
    var f = fatorSSDE(diametroEfetivoCm, fantoma);
    if (f == null || !(ctdivolMGy > 0)) return null;
    return { mGy: ctdivolMGy * f, fator: f };
  }

  /**
   * Níveis de referência de diagnóstico (DRL) — valores DIDÁTICOS de ordem de
   * grandeza para adulto. [APROXIMAÇÃO] Cada país e cada serviço publica os
   * seus; a plataforma sinaliza ultrapassagem para provocar a discussão, não
   * para reprovar um protocolo.
   */
  var DRL_DLP = {
    "Crânio": 1000, "Cranio": 1000, "Face": 360, "Seios da face": 360,
    "Órbitas": 360, "ATM": 360, "Pescoço": 600, "Pescoco": 600,
    "Tórax": 400, "Torax": 400, "Abdome": 800, "Pelve": 600,
    "Coluna": 600, "Membros": 150
  };

  /**
   * Relatório completo de dose de uma aquisição.
   * Devolve null nos campos que não puderam ser calculados — nunca um número
   * inventado para preencher a tela.
   */
  function relatorio(o) {
    var fantoma = fantomaDaRegiao(o.regiao);
    var w = ctdiw({ kv: o.kv, mas: o.mas, fantoma: fantoma });
    var vol = ctdivol({ kv: o.kv, mas: o.mas, pitch: o.pitch, modo: o.modo, fantoma: fantoma });
    var d = dlp(vol, o.comprimentoMm);
    var eff = doseEfetiva(d, o.regiao);
    var deffCm = o.diametroEfetivoMm ? o.diametroEfetivoMm / 10 : null;
    var s = deffCm ? ssde(vol, deffCm, fantoma) : null;
    var drl = DRL_DLP[o.regiao] || null;

    return {
      fantoma: fantoma,
      fantomaCm: fantoma === "cabeca" ? 16 : 32,
      ctdiw: w,
      ctdivol: vol,
      dlp: d,
      doseEfetivaMSv: eff ? eff.mSv : null,
      kEfetiva: eff ? eff.k : null,
      diametroEfetivoCm: deffCm,
      ssdeMGy: s ? s.mGy : null,
      fatorSSDE: s ? s.fator : null,
      drlDLP: drl,
      acimaDoDRL: (drl && d) ? d > drl : false,
      comprimentoMm: o.comprimentoMm
    };
  }

  Core.dose = {
    CTDIW_POR_100MAS_120KV: CTDIW_POR_100MAS_120KV,
    K_POR_REGIAO: K_POR_REGIAO,
    DRL_DLP: DRL_DLP,
    fantomaDaRegiao: fantomaDaRegiao,
    ctdiw: ctdiw,
    ctdivol: ctdivol,
    dlp: dlp,
    doseEfetiva: doseEfetiva,
    diametroEfetivoMm: diametroEfetivoMm,
    fatorSSDE: fatorSSDE,
    ssde: ssde,
    relatorio: relatorio
  };

})(typeof self !== "undefined" ? self : this);
