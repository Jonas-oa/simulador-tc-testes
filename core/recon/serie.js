/**
 * core/recon/serie.js
 * Dado bruto e reconstrução de séries.
 *
 * A Fase 4 provou a física, mas com um atalho arquitetural: espessura e FOV
 * agiam ANTES da projeção. Isso não é reconstruir — é readquirir. Num
 * tomógrafo o paciente é irradiado UMA vez; espessura, incremento, kernel,
 * FOV e matriz são escolhas feitas DEPOIS, sobre o mesmo dado bruto. É por
 * isso que o operador consegue tirar do mesmo exame uma série de encéfalo em
 * 5 mm e outra de osso em 1,25 mm sem irradiar de novo.
 *
 * Aqui isso passa a valer:
 *
 *   adquirirBruto()      irradia uma vez → sinogramas por LINHA de detector,
 *                        com ruído de fótons próprio de cada linha
 *   reconstruirSerie()   combina linhas (espessura), filtra (kernel) e
 *                        retroprojeta na grade (FOV/matriz)
 *
 * Combinar N linhas no domínio da projeção é o que a eletrônica do detector
 * faz ao somar canais: a média de N medidas independentes reduz o ruído por
 * √N. A relação σ ∝ 1/√espessura deixa de ser um fator aplicado ao N0 e passa
 * a ser consequência da combinação.
 *
 * SEM dependência de DOM. Script clássico.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};

  /**
   * IRRADIAÇÃO. Produz o dado bruto de uma faixa: um sinograma por linha de
   * detector, cada um com sua própria realização de ruído.
   *
   * @param {object} o
   * @param {Volume} o.volume
   * @param {object} o.plano          { inicioMm, fimMm } no eixo CC do volume
   * @param {object} o.aquisicao      { kv, mas, pitch, modo, colimacao }
   * @param {number} [o.linhaMm]      espessura da linha de detector; padrão =
   *                                  espaçamento do volume (o mais fino que a
   *                                  fonte permite representar)
   * @param {number} [o.vistas=180]
   * @param {number} [o.detectores]   padrão = matriz do volume
   * @param {function} [o.aoProgresso]
   */
  function adquirirBruto(o) {
    var F = Core.fisica, P = Core.projetor;
    var vol = o.volume;
    var linhaMm = o.linhaMm || vol.spacingMm[2];
    var ini = Math.min(o.plano.inicioMm, o.plano.fimMm);
    var fim = Math.max(o.plano.inicioMm, o.plano.fimMm);
    var comprimento = fim - ini;
    if (!isFinite(comprimento) || comprimento <= 0) {
      throw new Error("Faixa de aquisicao invalida: comprimento " + comprimento + " mm.");
    }
    var nLinhas = Math.max(1, Math.round(comprimento / linhaMm));

    // Fótons por raio de UMA linha de detector. Note que aqui a espessura é a
    // da LINHA (colimação), não a do corte reconstruído — é a distinção que a
    // Fase 4 não fazia.
    //
    // Com AEC, o mAs varia ao longo do eixo Z: cada linha recebe a corrente
    // que a atenuação daquele nível pediu. É isto que faz a modulação
    // REALIMENTAR a imagem, em vez de ser só um número no relatório.
    function n0Da(centroMm) {
      var mas = o.aquisicao.mas;
      if (o.modulacaoAEC) {
        var m = Core.aec.masEm(o.modulacaoAEC, centroMm);
        if (m > 0) mas = m;
      }
      return F.fotonsPorRaio({
        mas: mas, pitch: o.aquisicao.pitch, modo: o.aquisicao.modo,
        kv: o.aquisicao.kv, espessuraMm: linhaMm
      });
    }
    var n0 = n0Da((ini + fim) / 2);   // referência para o relatório

    // RESOLUCAO DE PROJECAO x COBERTURA DO DETECTOR.
    //
    // Reduzir o numero de canais do detector para ganhar velocidade parece
    // inofensivo e NAO E: se o detector cobre menos que o objeto, os raios que
    // faltam produzem TRUNCAMENTO, e a imagem inteira sai com o nivel
    // deslocado (o ar fora do paciente reconstruia em -609 HU em vez de
    // -1000). O barato precisa vir de reduzir a RESOLUCAO mantendo o CAMPO,
    // nao de recortar o campo.
    //
    // Logo: reamostra-se o slab para nProj pixels cobrindo a extensao TOTAL,
    // e o detector recebe canais suficientes para conter a diagonal.
    var nNativo = vol.dims[0];
    var nProj = Math.max(32, Math.min(nNativo, o.resolucao || nNativo));
    var escalaProj = nNativo / nProj;
    var pixelProjMm = vol.spacingMm[0] * escalaProj;
    // 1,45 ~ raiz(2) + folga: o objeto gira dentro do campo do detector.
    var detectores = o.detectores || Math.ceil(nProj * 1.45);
    if (detectores < Math.ceil(nProj * 1.42)) {
      detectores = Math.ceil(nProj * 1.42);   // nunca truncar, mesmo se pedirem
    }
    var vistas = o.vistas || 180;
    var linhas = [];

    /** Reduz o slab para nProj preservando a EXTENSAO fisica. */
    function reduzirSlab(slab) {
      if (nProj === nNativo) return slab.hu;
      var out = new Float32Array(nProj * nProj);
      var f = escalaProj;
      for (var y = 0; y < nProj; y++) {
        var sy = Math.min(slab.ny - 1, Math.floor(y * f));
        for (var x = 0; x < nProj; x++) {
          var sx = Math.min(slab.nx - 1, Math.floor(x * f));
          // media do bloco f x f, para nao perder sinal por subamostragem
          var acc = 0, c = 0;
          for (var dy = 0; dy < f; dy++) {
            var yy = sy + dy; if (yy >= slab.ny) break;
            for (var dx = 0; dx < f; dx++) {
              var xx = sx + dx; if (xx >= slab.nx) break;
              acc += slab.hu[yy * slab.nx + xx]; c++;
            }
          }
          out[y * nProj + x] = c ? acc / c : -1000;
        }
      }
      return out;
    }

    for (var i = 0; i < nLinhas; i++) {
      var centro = ini + (i + 0.5) * linhaMm;
      var slab = Core.scan.extrairSlab(vol, centro, linhaMm);

      // Projeta na resolução NATIVA do volume. FOV e matriz não entram aqui:
      // são parâmetros de reconstrução, e o dado bruto não os conhece.
      var mu = P.huParaMu(reduzirSlab(slab), o.aquisicao.kv);
      var sino = P.projetar(mu, {
        n: nProj, pixelMm: pixelProjMm,
        vistas: vistas, detectores: detectores
      });

      var n0Linha = n0Da(centro);
      if (!o.semRuido && n0Linha > 0) {
        sino = {
          dados: Core.ruido.aplicarRuido(sino.dados, n0Linha, {
            semente: (o.semente || 1) + i * 7919,
            ruidoEletronicoDP: o.ruidoEletronicoDP
          }),
          vistas: sino.vistas, detectores: sino.detectores, passoMm: sino.passoMm
        };
      }
      linhas.push({ sino: sino, centroMm: centro, n0: n0Linha });
      if (o.aoProgresso) o.aoProgresso(i + 1, nLinhas);
    }

    return {
      linhas: linhas,
      linhaMm: linhaMm,
      inicioMm: ini,
      fimMm: fim,
      comprimentoMm: comprimento,
      n0PorLinha: n0,
      vistas: vistas,
      detectores: detectores,
      passoMm: pixelProjMm,
      resolucaoProj: nProj,
      aquisicao: o.aquisicao,
      modulacaoAEC: o.modulacaoAEC || null,
      volumeId: vol.id,
      extensaoVolumeMm: vol.extentMm()
    };
  }

  /** Média de sinogramas — é o que a soma de canais do detector faz. */
  function combinarLinhas(linhas, indices) {
    var ref = linhas[indices[0]].sino;
    var out = new Float32Array(ref.dados.length);
    for (var k = 0; k < indices.length; k++) {
      var d = linhas[indices[k]].sino.dados;
      for (var i = 0; i < out.length; i++) out[i] += d[i];
    }
    for (i = 0; i < out.length; i++) out[i] /= indices.length;
    return { dados: out, vistas: ref.vistas, detectores: ref.detectores, passoMm: ref.passoMm };
  }

  /**
   * RECONSTRUÇÃO. Do mesmo bruto, produz uma série com os parâmetros pedidos.
   *
   * @param {object} bruto      saída de adquirirBruto
   * @param {object} rec        { nome, espessuraMm, incrementoMm, kernel, fovMm, matriz }
   * @param {function} [aoProgresso]
   */
  function reconstruirSerie(bruto, rec, aoProgresso) {
    var P = Core.projetor, F = Core.fisica;
    var espessura = Math.max(bruto.linhaMm, rec.espessuraMm || bruto.linhaMm);
    var incremento = rec.incrementoMm || espessura;
    var matriz = rec.matriz || 512;
    var fovMm = rec.fovMm || bruto.extensaoVolumeMm[0];
    var pixelMm = fovMm / matriz;

    var nCortes = Math.max(1, Math.round(bruto.comprimentoMm / incremento));
    var cortes = [];
    var posicoes = [];

    for (var c = 0; c < nCortes; c++) {
      var centro = bruto.inicioMm + (c + 0.5) * (bruto.comprimentoMm / nCortes);
      posicoes.push(centro);

      // Linhas que caem dentro da espessura deste corte.
      var meia = espessura / 2;
      var indices = [];
      for (var i = 0; i < bruto.linhas.length; i++) {
        var d = Math.abs(bruto.linhas[i].centroMm - centro);
        if (d <= meia) indices.push(i);
      }
      if (!indices.length) {
        // Espessura menor que a linha: usa a linha mais próxima.
        var melhor = 0, dist = Infinity;
        for (i = 0; i < bruto.linhas.length; i++) {
          var dd = Math.abs(bruto.linhas[i].centroMm - centro);
          if (dd < dist) { dist = dd; melhor = i; }
        }
        indices = [melhor];
      }

      var sino = indices.length === 1
        ? bruto.linhas[indices[0]].sino
        : combinarLinhas(bruto.linhas, indices);

      var filtrado = P.filtrar(sino, rec.kernel || "padrao");
      var imgMu = P.retroprojetar(filtrado, { n: matriz, pixelMm: pixelMm });
      var hu = P.muParaHU(imgMu, F.muAgua(bruto.aquisicao.kv));

      cortes.push({ hu: hu, n: matriz, pixelMm: pixelMm, centroMm: centro, linhasCombinadas: indices.length });
      if (aoProgresso) aoProgresso(c + 1, nCortes);
    }

    return {
      nome: rec.nome || "Série",
      cortes: cortes,
      posicoesMm: posicoes,
      espessuraMm: espessura,
      incrementoMm: incremento,
      kernel: rec.kernel || "padrao",
      fovMm: fovMm,
      matriz: matriz,
      pixelMm: pixelMm,
      // Rastro do que gerou a série — vai para o DICOM na Fase 7.
      origem: {
        kv: bruto.aquisicao.kv, mas: bruto.aquisicao.mas,
        pitch: bruto.aquisicao.pitch, modo: bruto.aquisicao.modo,
        linhaMm: bruto.linhaMm, n0PorLinha: bruto.n0PorLinha
      }
    };
  }

  /**
   * Reconstrói TODAS as séries previstas no protocolo, a partir de um único
   * dado bruto. É o que torna real a frase "duas séries do mesmo scan".
   */
  function reconstruirTodas(bruto, reconstrucoes, aoProgresso) {
    var saida = [];
    for (var i = 0; i < reconstrucoes.length; i++) {
      saida.push(reconstruirSerie(bruto, reconstrucoes[i], function (feito, total) {
        if (aoProgresso) aoProgresso(i, reconstrucoes.length, feito, total);
      }));
    }
    return saida;
  }

  /**
   * Nitidez de borda: largura, em pixels, da transição 10%-90% num degrau.
   * Kernel nítido produz transição mais curta; kernel liso, mais longa. É a
   * medida que distingue os kernels sem depender de inspeção visual.
   */
  function larguraDeBorda(hu, n, y, x0, x1) {
    var vals = [];
    for (var x = x0; x <= x1; x++) vals.push(hu[y * n + x]);
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var faixa = mx - mn;
    if (faixa < 50) return NaN;
    var lim10 = mn + faixa * 0.1, lim90 = mn + faixa * 0.9;
    var i10 = -1, i90 = -1;
    for (var i = 0; i < vals.length; i++) {
      if (i10 < 0 && vals[i] >= lim10) i10 = i;
      if (vals[i] >= lim90) { i90 = i; break; }
    }
    return (i10 >= 0 && i90 >= 0) ? Math.abs(i90 - i10) : NaN;
  }

  Core.recon = {
    adquirirBruto: adquirirBruto,
    combinarLinhas: combinarLinhas,
    reconstruirSerie: reconstruirSerie,
    reconstruirTodas: reconstruirTodas,
    larguraDeBorda: larguraDeBorda
  };

})(typeof self !== "undefined" ? self : this);
