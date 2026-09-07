/**
 * js/aquisicao/box-planejamento.js
 * Dono do estado e da lógica de validação da caixa de planejamento de aquisição.
 * Desacoplado da UI, focado nas regras físicas (cobertura do topograma, limites).
 */
(function () {
  "use strict";

  var MIN_GAP = 6; // % mínimo entre linhas opostas

  var BOX_PRESET = {
    lateral: {
      def: { top: 42, bottom: 94, left: 7, right: 66 },
      target: { top: [30, 54], bottom: [84, 100], left: [2, 18], right: [56, 76] }
    },
    frontal: {
      def: { top: 10, bottom: 74, left: 24, right: 76 },
      target: { top: [2, 22], bottom: [64, 88], left: [14, 36], right: [64, 86] }
    }
  };

  var state = { top: 42, bottom: 94, left: 7, right: 66 };

  function isFrontal(protocolParamsProvider) {
    var p = protocolParamsProvider();
    return p && p.scout === "frontal";
  }

  function applyPreset(orientacao) {
    var p = BOX_PRESET[orientacao] ? BOX_PRESET[orientacao].def : BOX_PRESET.lateral.def;
    state.top = p.top;
    state.bottom = p.bottom;
    state.left = p.left;
    state.right = p.right;
  }

  function rangeSpan(protocolParamsProvider) {
    return isFrontal(protocolParamsProvider) ? (state.bottom - state.top) : (state.right - state.left);
  }

  function fovSpan(protocolParamsProvider) {
    return isFrontal(protocolParamsProvider) ? (state.right - state.left) : (state.bottom - state.top);
  }

  function faixaEmMm(protocolParamsProvider, topoLenMmProvider, regiaoDoProtocoloProvider) {
    var fr = isFrontal(protocolParamsProvider);
    var a = fr ? state.top : state.left;
    var b = fr ? state.bottom : state.right;
    
    var reg = regiaoDoProtocoloProvider();
    var conv = SimTC.FonteVolume && SimTC.FonteVolume.fracaoCCparaMm;
    var L = topoLenMmProvider();
    
    function paraMm(pct) {
      var f = pct / 100;
      var mm = conv ? SimTC.FonteVolume.fracaoCCparaMm(reg, f) : null;
      return mm == null ? (1 - f) * L : mm; 
    }
    
    var mmA = paraMm(a), mmB = paraMm(b);
    return { inicioMm: Math.min(mmA, mmB), fimMm: Math.max(mmA, mmB) };
  }

  function validar(protocolParamsProvider, regiaoDoProtocoloProvider) {
    var p = [];
    var fr = isFrontal(protocolParamsProvider);
    var ccA = fr ? state.top : state.left;
    var ccB = fr ? state.bottom : state.right;
    var pA = fr ? state.left : state.top;
    var pB = fr ? state.right : state.bottom;
    var faixa = Math.abs(ccB - ccA);
    var fov = Math.abs(pB - pA);

    if (!isFinite(ccA) || !isFinite(ccB) || !isFinite(pA) || !isFinite(pB)) {
      p.push("Planejamento inválido — refaça a faixa. (Um dos limites perdeu a referência de posição.)");
      return p;
    }
    if (ccB - ccA < MIN_GAP) {
      p.push("A faixa de varredura está invertida ou curta demais — arraste as linhas para cobrir a região de interesse.");
      return p;
    }
    if (pB - pA < MIN_GAP) {
      p.push("O FOV está invertido ou estreito demais.");
      return p;
    }

    var lim = (SimTC.FonteVolume && SimTC.FonteVolume.limitesAnatomicos(
      regiaoDoProtocoloProvider(), fr ? "frontal" : "lateral"));
    if (!lim) return p;

    var ccMin = lim.cc[0] * 100, ccMax = lim.cc[1] * 100;
    var pMin = lim.perp[0] * 100, pMax = lim.perp[1] * 100;

    var sobrepoe = Math.max(0, Math.min(ccB, ccMax) - Math.max(ccA, ccMin));
    if (sobrepoe <= 0) {
      p.push("A faixa está fora do paciente — não há anatomia nesse trecho do topograma.");
      return p;
    }
    var forcaAr = 1 - sobrepoe / faixa;
    if (forcaAr > 0.25) {
      p.push("Cerca de " + Math.round(forcaAr * 100) +
        "% da faixa está fora do paciente: seria irradiação sem imagem útil. Aproxime as linhas da anatomia.");
    }

    if (pA > pMin + 2 || pB < pMax - 2) {
      p.push("O FOV não cobre toda a largura do paciente — a borda seria truncada. Afaste as linhas do FOV.");
    }
    return p;
  }

  window.SimTC = window.SimTC || {};
  SimTC.BoxPlanejamento = {
    state: state,
    BOX_PRESET: BOX_PRESET,
    applyPreset: applyPreset,
    isFrontal: isFrontal,
    rangeSpan: rangeSpan,
    fovSpan: fovSpan,
    faixaEmMm: faixaEmMm,
    validar: validar
  };

})();
