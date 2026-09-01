/**
 * core/acquisition/scan.js
 * Orquestra a aquisição: volume + protocolo + plano → cortes reconstruídos.
 *
 * Fecha a outra metade do B-03. Na versão auditada o número de cortes vinha
 * FIXO do manifesto do fantoma: planejar 177 mm ou 120 mm produzia 60 cortes
 * nos dois casos. Aqui vem de
 *
 *     n = round(comprimento_da_faixa / incremento)
 *
 * e cada corte é reconstruído de dados brutos próprios — o que também é o que
 * permite, na Fase 5, reconstruir o MESMO scan em espessuras e kernels
 * diferentes e obter séries distintas.
 *
 * CONVENÇÃO DE COORDENADAS: a faixa do plano é medida em mm ao longo do eixo
 * crânio-caudal DO VOLUME, com 0 no primeiro corte. A ponte com a posição da
 * mesa 3D é feita por quem chama.
 *
 * SEM dependência de DOM — roda em Worker. Script clássico.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};

  /**
   * Extrai um "slab": a média do volume ao longo da espessura do corte.
   *
   * É a razão física de a espessura importar. Um corte de 5 mm integra cinco
   * vezes mais material que um de 1 mm: recebe mais fótons (menos ruído) e
   * mistura estruturas vizinhas (mais volume parcial). As duas consequências
   * saem daqui e do N0, não de uma regra escrita à mão.
   */
  function extrairSlab(volume, centroMm, espessuraMm) {
    var nx = volume.dims[0], ny = volume.dims[1];
    var sz = volume.spacingMm[2];
    var meia = Math.max(sz, espessuraMm) / 2;
    var z0 = (centroMm - meia) / sz;
    var z1 = (centroMm + meia) / sz;
    var iz0 = Math.max(0, Math.floor(z0));
    var iz1 = Math.min(volume.dims[2] - 1, Math.ceil(z1) - 1);
    if (iz1 < iz0) iz1 = iz0;

    var n = nx * ny;
    var slab = new Float32Array(n);
    var contagem = iz1 - iz0 + 1;
    for (var z = iz0; z <= iz1; z++) {
      var base = z * n;
      for (var i = 0; i < n; i++) slab[i] += volume.dados[base + i];
    }
    for (i = 0; i < n; i++) slab[i] /= contagem;
    return { hu: slab, nx: nx, ny: ny, cortesIntegrados: contagem };
  }

  /**
   * Reamostra o slab para a matriz de reconstrução pedida, respeitando o FOV.
   * FOV menor que a extensão do volume RECORTA (zoom); maior, acrescenta ar.
   * pixel = FOV / matriz   [DEFINIÇÃO]
   */
  function reamostrarParaFOV(slab, volume, fovMm, matriz) {
    var out = new Float32Array(matriz * matriz);
    var pixelMm = fovMm / matriz;
    var sx = volume.spacingMm[0], sy = volume.spacingMm[1];
    var cxVol = (slab.nx - 1) / 2, cyVol = (slab.ny - 1) / 2;
    var c = (matriz - 1) / 2;

    for (var y = 0; y < matriz; y++) {
      var mmY = (y - c) * pixelMm;
      var vy = mmY / sy + cyVol;
      for (var x = 0; x < matriz; x++) {
        var mmX = (x - c) * pixelMm;
        var vx = mmX / sx + cxVol;
        var v = -1000;
        if (vx >= 0 && vy >= 0 && vx < slab.nx - 1 && vy < slab.ny - 1) {
          var x0 = vx | 0, y0 = vy | 0, fx = vx - x0, fy = vy - y0;
          var i0 = y0 * slab.nx + x0;
          v = slab.hu[i0] * (1 - fx) * (1 - fy)
            + slab.hu[i0 + 1] * fx * (1 - fy)
            + slab.hu[i0 + slab.nx] * (1 - fx) * fy
            + slab.hu[i0 + slab.nx + 1] * fx * fy;
        }
        out[y * matriz + x] = v;
      }
    }
    return { hu: out, n: matriz, pixelMm: pixelMm };
  }

  /**
   * Reconstrói UM corte, do slab ao HU final, passando por sinograma e ruído.
   *
   * @param {object} o
   * @param {Volume} o.volume
   * @param {number} o.centroMm      posição do corte no eixo CC do volume
   * @param {number} o.espessuraMm
   * @param {number} o.fovMm
   * @param {number} o.matriz
   * @param {number} o.kv
   * @param {number} o.mas
   * @param {number} [o.pitch]
   * @param {string} [o.modo]
   * @param {string} [o.kernel="padrao"]
   * @param {number} [o.vistas=180]
   * @param {boolean} [o.semRuido=false]
   * @param {number} [o.semente]
   * @returns {{hu:Int16Array, n:number, pixelMm:number, n0:number, masEfetivo:number}}
   */
  function reconstruirCorte(o) {
    var F = Core.fisica, P = Core.projetor;
    var slab = extrairSlab(o.volume, o.centroMm, o.espessuraMm);
    var grade = reamostrarParaFOV(slab, o.volume, o.fovMm, o.matriz);

    // HU → μ na tensão escolhida. É aqui que o kV entra na imagem.
    var mu = P.huParaMu(grade.hu, o.kv);

    var sino = P.projetar(mu, {
      n: grade.n, pixelMm: grade.pixelMm,
      vistas: o.vistas || 180, detectores: o.matriz
    });

    var masEf = F.masEfetivo(o.mas, o.pitch, o.modo);
    var n0 = F.fotonsPorRaio({
      mas: o.mas, pitch: o.pitch, modo: o.modo,
      kv: o.kv, espessuraMm: o.espessuraMm
    });

    if (!o.semRuido && n0 > 0) {
      sino = {
        dados: Core.ruido.aplicarRuido(sino.dados, n0, {
          semente: o.semente || 1, ruidoEletronicoDP: o.ruidoEletronicoDP
        }),
        vistas: sino.vistas, detectores: sino.detectores, passoMm: sino.passoMm
      };
    }

    var filtrado = P.filtrar(sino, o.kernel || "padrao");
    var imgMu = P.retroprojetar(filtrado, { n: grade.n, pixelMm: grade.pixelMm });
    var hu = P.muParaHU(imgMu, F.muAgua(o.kv));

    return { hu: hu, n: grade.n, pixelMm: grade.pixelMm, n0: n0, masEfetivo: masEf };
  }

  /**
   * Posições dos cortes ao longo da faixa planejada.
   * O primeiro e o último ficam meio incremento para dentro das bordas, de
   * modo que os n cortes preencham exatamente o comprimento pedido.
   */
  function posicoesDosCortes(inicioMm, fimMm, incrementoMm) {
    var L = Math.abs(fimMm - inicioMm);
    var ini = Math.min(inicioMm, fimMm);
    var n = Core.model.contarCortes({ inicioMm: inicioMm, fimMm: fimMm }, incrementoMm);
    var pos = [];
    for (var i = 0; i < n; i++) pos.push(ini + (i + 0.5) * (L / n));
    return pos;
  }

  /**
   * Executa a aquisição completa de uma faixa.
   * `aoProgresso(indice, total, corte)` é chamado a cada corte, para que a
   * interface possa mostrar a imagem se formando.
   */
  function executar(o) {
    var rec = o.reconstrucao;
    var pos = posicoesDosCortes(o.plano.inicioMm, o.plano.fimMm, rec.incrementoMm);
    var cortes = [];
    for (var i = 0; i < pos.length; i++) {
      var c = reconstruirCorte({
        volume: o.volume, centroMm: pos[i],
        espessuraMm: rec.espessuraMm, fovMm: rec.fovMm, matriz: rec.matriz,
        kernel: rec.kernel,
        kv: o.aquisicao.kv, mas: o.aquisicao.mas,
        pitch: o.aquisicao.pitch, modo: o.aquisicao.modo,
        vistas: o.vistas, semRuido: o.semRuido,
        semente: (o.semente || 1) + i * 7919
      });
      cortes.push(c);
      if (o.aoProgresso) o.aoProgresso(i, pos.length, c);
    }
    return {
      cortes: cortes,
      posicoesMm: pos,
      espessuraMm: rec.espessuraMm,
      incrementoMm: rec.incrementoMm,
      pixelMm: cortes.length ? cortes[0].pixelMm : null,
      matriz: rec.matriz
    };
  }

  /** Desvio-padrão de HU numa janela quadrada — usado nos testes de ruído. */
  function desvioEmROI(hu, n, cx, cy, lado) {
    var soma = 0, soma2 = 0, cont = 0;
    var meio = lado >> 1;
    for (var y = cy - meio; y <= cy + meio; y++) {
      for (var x = cx - meio; x <= cx + meio; x++) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        var v = hu[y * n + x];
        soma += v; soma2 += v * v; cont++;
      }
    }
    if (!cont) return { media: NaN, dp: NaN, n: 0 };
    var media = soma / cont;
    return { media: media, dp: Math.sqrt(Math.max(0, soma2 / cont - media * media)), n: cont };
  }

  Core.scan = {
    extrairSlab: extrairSlab,
    reamostrarParaFOV: reamostrarParaFOV,
    reconstruirCorte: reconstruirCorte,
    posicoesDosCortes: posicoesDosCortes,
    executar: executar,
    desvioEmROI: desvioEmROI
  };

})(typeof self !== "undefined" ? self : this);
