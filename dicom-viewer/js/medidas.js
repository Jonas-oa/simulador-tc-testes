/**
 * dicom-viewer/js/medidas.js
 * Ferramentas de medida sobre os cortes reformatados.
 *
 * Três ferramentas, e o motivo de cada uma:
 *
 *   DISTÂNCIA  Em milímetros do PACIENTE, não em pixels. A conversão passa
 *              pelo espaçamento do volume em cada eixo — num volume anisotrópico
 *              uma linha vertical e uma horizontal do mesmo comprimento em
 *              pixels têm comprimentos diferentes em milímetros, e medir em
 *              pixels esconderia isso.
 *
 *   ÂNGULO     Três pontos, vértice no meio. Calculado no espaço do paciente
 *              pela mesma razão: em grade anisotrópica o ângulo aparente na
 *              tela não é o ângulo real.
 *
 *   ROI        Média e desvio-padrão em HU dentro de um círculo. É a medida
 *              que sustenta a leitura quantitativa da imagem — dizer "isto tem
 *              40 HU" só tem sentido se o valor vier do dado, não do cinza
 *              exibido. O desvio-padrão na ROI é a leitura de RUÍDO, que é
 *              como se compara protocolos.
 *
 * As medidas pertencem ao CORTE em que foram feitas: mudar de corte deixa de
 * mostrá-las, porque a estrutura medida não está mais ali. Mudar de plano
 * idem.
 *
 * ES module, como o resto do leitor.
 */

export const FERRAMENTAS = {
  distancia: { rotulo: 'Distância', pontos: 2, cor: '#4fd1ff' },
  angulo: { rotulo: 'Ângulo', pontos: 3, cor: '#ffd24f' },
  roi: { rotulo: 'ROI (HU)', pontos: 2, cor: '#7dff9e' },
};

export function ehFerramentaDeMedida(nome) {
  return Object.prototype.hasOwnProperty.call(FERRAMENTAS, nome);
}

/** Posição do voxel no espaço do paciente, em mm. */
function mm(volume, p) {
  return volume.paciente(p[0], p[1], p[2]);
}

function subtrair(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function norma(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/**
 * Estatística de HU dentro de um círculo no plano do corte.
 *
 * O raio é dado por dois pontos (centro e borda) em voxels, mas a média é
 * calculada varrendo a grade do plano — cada voxel entra uma vez, sem
 * reamostragem, para que o número não dependa do zoom da tela.
 */
function estatisticaROI(volume, def, centro, borda, fixo) {
  const eC = def.eixoColuna;
  const eL = def.eixoLinha;
  const raioC = Math.abs(borda[eC] - centro[eC]);
  const raioL = Math.abs(borda[eL] - centro[eL]);
  const raio = Math.max(0.5, Math.sqrt(raioC * raioC + raioL * raioL));

  const nC = volume.dims[eC];
  const nL = volume.dims[eL];
  const c0 = Math.max(0, Math.floor(centro[eC] - raio));
  const c1 = Math.min(nC - 1, Math.ceil(centro[eC] + raio));
  const l0 = Math.max(0, Math.floor(centro[eL] - raio));
  const l1 = Math.min(nL - 1, Math.ceil(centro[eL] + raio));

  let n = 0;
  let soma = 0;
  let soma2 = 0;
  let menor = Infinity;
  let maior = -Infinity;
  const p = [0, 0, 0];
  p[def.eixoFixo] = fixo;
  for (let l = l0; l <= l1; l++) {
    for (let c = c0; c <= c1; c++) {
      const dc = c - centro[eC];
      const dl = l - centro[eL];
      if (dc * dc + dl * dl > raio * raio) continue;
      p[eC] = c;
      p[eL] = l;
      const hu = volume.valor(p[0], p[1], p[2]);
      if (!Number.isFinite(hu)) continue;
      n += 1;
      soma += hu;
      soma2 += hu * hu;
      if (hu < menor) menor = hu;
      if (hu > maior) maior = hu;
    }
  }
  if (!n) return null;
  const media = soma / n;
  // Variância populacional; com n grande a diferença para a amostral é
  // irrelevante, e negativo por erro de ponto flutuante vira zero.
  const dp = Math.sqrt(Math.max(0, soma2 / n - media * media));

  // Área em mm²: o pixel do plano tem lados diferentes se o volume for
  // anisotrópico, então a área do voxel é o produto dos dois espaçamentos.
  const areaVoxel = volume.espacamento[eC] * volume.espacamento[eL];
  return { n, media, dp, menor, maior, areaMm2: n * areaVoxel };
}

/**
 * Calcula o resultado de uma medida completa.
 * @returns {{texto:string, detalhe:string}|null}
 */
export function calcular(medida, volume, def) {
  if (!volume || !medida || medida.pontos.length < FERRAMENTAS[medida.tipo].pontos) return null;

  if (medida.tipo === 'distancia') {
    const a = mm(volume, medida.pontos[0]);
    const b = mm(volume, medida.pontos[1]);
    const d = norma(subtrair(b, a));
    return {
      texto: d >= 10 ? `${(d / 10).toFixed(2)} cm` : `${d.toFixed(1)} mm`,
      detalhe: `${d.toFixed(1)} mm`,
    };
  }

  if (medida.tipo === 'angulo') {
    const v = mm(volume, medida.pontos[1]);          // vértice
    const u1 = subtrair(mm(volume, medida.pontos[0]), v);
    const u2 = subtrair(mm(volume, medida.pontos[2]), v);
    const n1 = norma(u1);
    const n2 = norma(u2);
    if (!n1 || !n2) return null;
    const cos = Math.max(-1, Math.min(1,
      (u1[0] * u2[0] + u1[1] * u2[1] + u1[2] * u2[2]) / (n1 * n2)));
    const graus = (Math.acos(cos) * 180) / Math.PI;
    return { texto: `${graus.toFixed(1)}°`, detalhe: `${graus.toFixed(1)}°` };
  }

  if (medida.tipo === 'roi') {
    const e = estatisticaROI(volume, def, medida.pontos[0], medida.pontos[1], medida.fixo);
    if (!e) return null;
    return {
      texto: `${e.media.toFixed(1)} ± ${e.dp.toFixed(1)} HU`,
      detalhe: `média ${e.media.toFixed(1)} · DP ${e.dp.toFixed(1)} · `
        + `min ${e.menor.toFixed(0)} · máx ${e.maior.toFixed(0)} HU · `
        + `${e.n} voxels · ${(e.areaMm2 / 100).toFixed(2)} cm²`,
    };
  }
  return null;
}

/** Desenha uma medida sobre o canvas do viewport. */
export function desenhar(ctx, medida, viewport, u = 1) {
  const cor = FERRAMENTAS[medida.tipo].cor;
  const pts = medida.pontos.map((p) => viewport.voxelParaCanvas(p));
  if (!pts.length) return;

  ctx.save();
  ctx.strokeStyle = cor;
  ctx.fillStyle = cor;
  ctx.lineWidth = 1.4 * u;
  ctx.font = `${11 * u}px ui-monospace, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';

  if (medida.tipo === 'roi' && pts.length >= 2) {
    const r = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], Math.max(2, r), 0, Math.PI * 2);
    ctx.stroke();
  } else if (pts.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }

  // marcadores dos pontos
  for (const [x, y] of pts) {
    ctx.beginPath();
    ctx.arc(x, y, 2.5 * u, 0, Math.PI * 2);
    ctx.fill();
  }

  if (medida.resultado) {
    const [x, y] = pts[pts.length - 1];
    const texto = medida.resultado.texto;
    const larg = ctx.measureText(texto).width;
    // fundo escuro atrás do texto: sobre osso branco o rótulo sumiria
    ctx.fillStyle = 'rgba(6,10,16,.72)';
    ctx.fillRect(x + 6 * u - 2, y - 14 * u, larg + 6, 14 * u);
    ctx.fillStyle = cor;
    ctx.fillText(texto, x + 6 * u, y - 2 * u);
  }
  ctx.restore();
}

/**
 * Medidas visíveis num viewport: mesmo plano e mesmo corte.
 * Com slab ligado, uma medida feita em qualquer corte DENTRO da faixa continua
 * visível — o que está na tela é a combinação daqueles cortes.
 */
export function visiveis(medidas, plano, fixo, faixa) {
  const ini = faixa ? faixa.inicio : fixo;
  const fim = faixa ? faixa.inicio + faixa.n - 1 : fixo;
  return medidas.filter((m) => m.plano === plano && m.fixo >= ini && m.fixo <= fim);
}

export function novaMedida(tipo, plano, fixo) {
  return { id: `m${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    tipo, plano, fixo, pontos: [], resultado: null };
}
