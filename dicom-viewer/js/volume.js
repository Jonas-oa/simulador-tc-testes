/**
 * Montagem do volume 3D a partir de uma série DICOM.
 *
 * O volume é reorientado para um sistema canônico LPS, em que os índices
 * crescem sempre no mesmo sentido anatômico:
 *
 *   x  ->  esquerda do paciente   (L)
 *   y  ->  posterior              (P)
 *   z  ->  superior               (S)
 *
 * Assim os três planos do MPR saem diretamente do arranjo, sem depender de
 * como a série foi adquirida (axial, sagital ou coronal).
 */

import { ArquivoDicom, TAG } from './dicom.js';

const EIXOS = ['x', 'y', 'z'];

function produtoVetorial(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norma(v) { return Math.hypot(...v); }

function produtoEscalar(a, b) { return a.reduce((s, x, i) => s + x * b[i], 0); }

function eixoDominante(v) {
  let melhor = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(v[i]) > Math.abs(v[melhor])) melhor = i;
  return { eixo: melhor, sinal: v[melhor] >= 0 ? 1 : -1, pureza: Math.abs(v[melhor]) };
}

export class Volume {
  constructor(campos) { Object.assign(this, campos); }

  /** Valor bruto no índice canônico (x, y, z). */
  valor(x, y, z) {
    return this.dados[z * this.dims[0] * this.dims[1] + y * this.dims[0] + x];
  }

  /** Extensão física em mm de cada eixo. */
  get extensao() {
    return [this.dims[0] * this.espacamento[0],
      this.dims[1] * this.espacamento[1],
      this.dims[2] * this.espacamento[2]];
  }

  /**
   * Coordenada LPS (mm) do voxel canônico.
   * Por construção cada índice canônico cresce no sentido positivo do seu
   * eixo anatômico, então o mapeamento é uma simples escala + translação.
   */
  paciente(x, y, z) {
    return [
      this.origem[0] + x * this.espacamento[0],
      this.origem[1] + y * this.espacamento[1],
      this.origem[2] + z * this.espacamento[2],
    ];
  }
}

/**
 * @param {ArquivoDicom[]} arquivos  fatias de UMA série
 * @param {(msg:string, frac:number)=>void} progresso
 * @param {{reducaoPlano?:number, passoFatia?:number}} opcoes
 *        reducaoPlano  agrupa N×N pixels no plano (média) — 1 mantém o original
 *        passoFatia    mantém 1 fatia a cada N
 *        Usados em aparelhos com pouca memória; a geometria em milímetros
 *        continua correta porque o espaçamento é escalado junto.
 */
export function montarVolume(arquivos, progresso = () => {}, opcoes = {}) {
  const reducao = Math.max(1, Math.round(opcoes.reducaoPlano || 1));
  const passoFatia = Math.max(1, Math.round(opcoes.passoFatia || 1));
  if (!arquivos.length) throw new Error('Nenhum arquivo DICOM válido.');

  const naoSuportados = arquivos.filter((a) => !a.suportado);
  if (naoSuportados.length === arquivos.length) {
    throw new Error(
      `Todos os arquivos usam uma sintaxe de transferência não suportada `
      + `(${naoSuportados[0].sintaxeNome}). Este leitor abre DICOM não comprimido `
      + `(Implicit/Explicit VR LE, Explicit VR BE) e RLE Lossless.`);
  }
  const validos = arquivos.filter((a) => a.suportado && a.linhas > 0 && a.colunas > 0);
  if (!validos.length) throw new Error('Nenhuma imagem legível na série.');

  const referencia = validos[0];
  const modalidade = referencia.texto(TAG.Modality);
  if (modalidade !== 'CT') {
    throw new Error(`Este leitor foi configurado exclusivamente para tomografia (CT). `
      + `A série selecionada informa modalidade ${modalidade || 'desconhecida'}.`);
  }
  if (validos.some((a) => a.texto(TAG.Modality) !== 'CT')) {
    throw new Error('A série mistura modalidades diferentes e não pode ser tratada como uma TC.');
  }
  const geo = referencia.geometria();
  const largura = referencia.colunas;   // índice i
  const altura = referencia.linhas;     // índice j

  const consistentes = validos.filter((a) => a.colunas === largura && a.linhas === altura);
  const descartados = validos.length - consistentes.length;

  // Direções em coordenadas do paciente (LPS)
  const dirI = geo.orientacao.slice(0, 3);   // sentido de crescimento da coluna
  const dirJ = geo.orientacao.slice(3, 6);   // sentido de crescimento da linha
  let dirK = produtoVetorial(dirI, dirJ);
  if (!geo.temOrientacao || Math.abs(norma(dirI) - 1) > 1e-3
      || Math.abs(norma(dirJ) - 1) > 1e-3 || Math.abs(produtoEscalar(dirI, dirJ)) > 1e-3) {
    throw new Error('ImageOrientationPatient ausente ou inválido; não é possível reconstruir '
      + 'a TC com coordenadas anatômicas seguras.');
  }

  // ---- ordenação das fatias -------------------------------------------------
  const fatias = consistentes.map((a) => {
    const g = a.geometria();
    const proj = g.posicao[0] * dirK[0] + g.posicao[1] * dirK[1] + g.posicao[2] * dirK[2];
    return { arquivo: a, geo: g, proj };
  });

  const temPosicao = fatias.every((f) => f.geo.temPosicao);
  if (!temPosicao) {
    throw new Error('ImagePositionPatient ausente; não é possível ordenar os cortes nem medir '
      + 'a TC com segurança.');
  }
  const orientacaoConsistente = fatias.every((f) => {
    if (!f.geo.temOrientacao) return false;
    return f.geo.orientacao.every((v, i) => Math.abs(v - geo.orientacao[i]) <= 1e-4);
  });
  const pixelConsistente = fatias.every((f) => f.geo.espacamentoPixel.every(
    (v, i) => Number.isFinite(v) && v > 0
      && Math.abs(v - geo.espacamentoPixel[i]) <= Math.max(1e-4, geo.espacamentoPixel[i] * 1e-3)));
  if (!orientacaoConsistente || !pixelConsistente) {
    throw new Error('A orientação ou o espaçamento de pixel varia entre os cortes; exporte uma '
      + 'série CT geometricamente consistente.');
  }
  fatias.sort((a, b) => a.proj - b.proj);

  // Multiquadro clássico: uma única instância com vários quadros e geometria
  // no cabeçalho principal. Enhanced CT guarda geometria por quadro em
  // sequências funcionais; enquanto elas não forem interpretadas, é mais seguro
  // recusar do que apresentar coordenadas anatômicas incorretas.
  let indicesQuadro = null;
  if (fatias.length === 1 && fatias[0].arquivo.quadros > 1) {
    if (!geo.temOrientacao || !geo.temPosicao) {
      throw new Error('TC multiquadro aprimorada sem geometria no cabeçalho principal não é '
        + 'suportada com segurança. Exporte a série como imagens DICOM clássicas.');
    }
    indicesQuadro = [];
    for (let q = 0; q < fatias[0].arquivo.quadros; q += passoFatia) indicesQuadro.push(q);
  }

  // ---- espaçamento entre cortes --------------------------------------------
  let dz;
  const gaps = [];
  for (let i = 1; i < fatias.length; i++) gaps.push(fatias[i].proj - fatias[i - 1].proj);
  if (temPosicao && gaps.length) {
    gaps.sort((a, b) => a - b);
    dz = gaps[Math.floor(gaps.length / 2)];   // mediana: robusta a fatias faltantes
  }
  if (!dz || !Number.isFinite(dz) || Math.abs(dz) < 1e-6) {
    dz = geo.espacamentoCortes || geo.espessura || 1;
  }
  const espacamentoIrregular = temPosicao && gaps.length > 1
    && (Math.max(...gaps) - Math.min(...gaps)) > Math.abs(dz) * 0.15;
  const inclinacaoGantry = fatias.slice(1).some((f, i) => {
    const anterior = fatias[i];
    const delta = f.geo.posicao.map((v, c) => v - anterior.geo.posicao[c]);
    const avanco = produtoEscalar(delta, dirK);
    return norma(delta.map((v, c) => v - avanco * dirK[c])) > 0.05;
  });

  if (dz < 0) { dz = -dz; dirK = dirK.map((v) => -v); }

  // ---- subamostragem opcional ----------------------------------------------
  // Aplicada depois da ordenação, para que o descarte seja regular no espaço.
  if (passoFatia > 1 && !indicesQuadro) {
    for (let i = 1, w = 1; i < fatias.length; i++) {
      if (i % passoFatia === 0) fatias[w++] = fatias[i];
      if (i === fatias.length - 1) fatias.length = w;
    }
    dz *= passoFatia;
  } else if (passoFatia > 1 && indicesQuadro) {
    dz *= passoFatia;
  }

  const numFatias = indicesQuadro ? indicesQuadro.length : fatias.length;
  if (numFatias < 2) throw new Error('A série tem apenas uma imagem — não é um volume.');

  const largura2 = Math.max(1, Math.floor(largura / reducao));
  const altura2 = Math.max(1, Math.floor(altura / reducao));
  const passoI = geo.espacamentoPixel[1] * reducao;   // mm por coluna
  const passoJ = geo.espacamentoPixel[0] * reducao;   // mm por linha

  // ---- mapeamento dos eixos do voxel para os eixos do paciente -------------
  const eixos = [eixoDominante(dirI), eixoDominante(dirJ), eixoDominante(dirK)];
  // O arranjo abaixo só permuta/inverte eixos; ele não interpola uma grade
  // oblíqua. Exija alinhamento praticamente exato (erro angular < ~2,6°).
  const obliquo = eixos.some((e) => e.pureza < 0.999);

  if (obliquo || inclinacaoGantry) {
    throw new Error('Aquisição oblíqua ou com inclinação do gantry: este leitor não faz '
      + 'reamostragem espacial completa e, por segurança, não exibirá medidas aproximadas.');
  }
  if (espacamentoIrregular) {
    throw new Error('A série possui cortes ausentes ou espaçamento irregular. Exporte uma série '
      + 'contínua antes de usar MPR e medidas espaciais.');
  }

  // permutação: para cada eixo do paciente, qual eixo do voxel o alimenta
  const deVoxel = [-1, -1, -1];
  eixos.forEach((e, iVoxel) => { deVoxel[e.eixo] = iVoxel; });
  if (deVoxel.includes(-1)) {
    throw new Error('Não foi possível mapear a orientação da série para os eixos anatômicos.');
  }

  const formaVoxel = [largura2, altura2, numFatias];
  const passoVoxel = [passoI, passoJ, Math.abs(dz)];

  const dims = deVoxel.map((iv) => formaVoxel[iv]);
  const espacamento = deVoxel.map((iv) => passoVoxel[iv]);
  const sinais = deVoxel.map((iv) => eixos[iv].sinal);

  // strides no arranjo canônico para cada eixo do voxel
  const strideCanonico = [1, dims[0], dims[0] * dims[1]];
  const strideDe = [0, 0, 0];   // por eixo de voxel
  const baseDe = [0, 0, 0];
  for (let ep = 0; ep < 3; ep++) {
    const iv = deVoxel[ep];
    strideDe[iv] = strideCanonico[ep] * sinais[ep];
    baseDe[iv] = sinais[ep] > 0 ? 0 : (dims[ep] - 1) * strideCanonico[ep];
  }

  // ---- preenchimento --------------------------------------------------------
  const total = dims[0] * dims[1] * dims[2];
  const dados = consistentes.some((a) => a.requerFloat)
    ? new Float32Array(total) : new Int16Array(total);
  let minimo = Infinity;
  let maximo = -Infinity;

  for (let k = 0; k < numFatias; k++) {
    const idxArquivo = indicesQuadro ? 0 : k;
    const quadro = indicesQuadro ? indicesQuadro[k] : 0;
    const plano = fatias[idxArquivo].arquivo.pixels(quadro);

    const baseK = baseDe[2] + k * strideDe[2];
    const divisor = reducao * reducao;
    for (let j = 0; j < altura2; j++) {
      const baseJ = baseK + baseDe[1] + j * strideDe[1];
      for (let i = 0; i < largura2; i++) {
        let v;
        if (reducao === 1) {
          v = plano[j * largura + i];
        } else {
          // média do bloco reducao×reducao: reduz ruído em vez de só descartar
          let soma = 0;
          for (let dj = 0; dj < reducao; dj++) {
            const linha = (j * reducao + dj) * largura + i * reducao;
            for (let di = 0; di < reducao; di++) soma += plano[linha + di];
          }
          v = dados instanceof Float32Array ? soma / divisor : Math.round(soma / divisor);
        }
        dados[baseJ + baseDe[0] + i * strideDe[0]] = v;
        if (v < minimo) minimo = v;
        if (v > maximo) maximo = v;
      }
    }
    if ((k & 7) === 0) progresso(`Montando volume (${k + 1}/${numFatias})`, k / numFatias);
  }

  // ---- janela padrão --------------------------------------------------------
  const meio = fatias[Math.floor(fatias.length / 2)].arquivo;
  let centro = meio.numero(TAG.WindowCenter, null);
  let largura_janela = meio.numero(TAG.WindowWidth, null);
  if (centro === null || largura_janela === null || largura_janela <= 0) {
    const p = percentis(dados, [0.02, 0.98]);
    centro = Math.round((p[0] + p[1]) / 2);
    largura_janela = Math.max(1, Math.round(p[1] - p[0]));
  }

  // Origem: coordenada do paciente correspondente ao voxel canônico (0,0,0).
  // Quando um eixo foi invertido, esse voxel vem da outra ponta da aquisição.
  const ipp0 = fatias[0].geo.posicao;
  const direcoes = [dirI, dirJ, dirK];
  const origemCanonica = [...ipp0];
  // com redução no plano, o novo voxel fica no centro do bloco agrupado
  if (reducao > 1) {
    const meio = (reducao - 1) / 2;
    for (let c = 0; c < 3; c++) {
      origemCanonica[c] += meio * geo.espacamentoPixel[1] * dirI[c]
        + meio * geo.espacamentoPixel[0] * dirJ[c];
    }
  }
  for (let ep = 0; ep < 3; ep++) {
    if (sinais[ep] > 0) continue;
    const iv = deVoxel[ep];
    const n = formaVoxel[iv] - 1;
    for (let c = 0; c < 3; c++) origemCanonica[c] += n * passoVoxel[iv] * direcoes[iv][c];
  }

  return new Volume({
    dados,
    dims,
    espacamento,
    origem: origemCanonica,
    minimo,
    maximo,
    janela: { centro, largura: largura_janela },
    modalidade,
    descricaoSerie: referencia.texto(TAG.SeriesDescription),
    descricaoEstudo: referencia.texto(TAG.StudyDescription),
    fabricante: referencia.texto(TAG.Manufacturer),
    idPaciente: referencia.texto(TAG.PatientID),
    sintaxe: referencia.sintaxeNome,
    numFatias,
    obliquo,
    espacamentoIrregular,
    descartados,
    unidadeHU: (referencia.texto(TAG.Modality) === 'CT'),
    inverterMonocromatico: referencia.texto(TAG.PhotometricInterpretation) === 'MONOCHROME1',
  });
}

/** Percentis aproximados via histograma — usado quando não há janela no cabeçalho. */
function percentis(dados, fracoes) {
  if (!(dados instanceof Int16Array)) {
    const passo = Math.max(1, Math.ceil(dados.length / 500000));
    const amostra = [];
    for (let i = 0; i < dados.length; i += passo) {
      if (Number.isFinite(dados[i])) amostra.push(dados[i]);
    }
    amostra.sort((a, b) => a - b);
    if (!amostra.length) return fracoes.map(() => 0);
    return fracoes.map((f) => amostra[Math.min(amostra.length - 1,
      Math.max(0, Math.round(f * (amostra.length - 1))))]);
  }
  const hist = new Uint32Array(65536);
  const passo = dados.length > 4e6 ? 7 : 1;   // amostragem em volumes grandes
  let n = 0;
  for (let i = 0; i < dados.length; i += passo) { hist[dados[i] + 32768]++; n++; }
  const alvos = fracoes.map((f) => f * n);
  const saida = [];
  let acumulado = 0;
  let alvo = 0;
  for (let b = 0; b < 65536 && alvo < alvos.length; b++) {
    acumulado += hist[b];
    while (alvo < alvos.length && acumulado >= alvos[alvo]) {
      saida.push(b - 32768);
      alvo++;
    }
  }
  while (saida.length < fracoes.length) saida.push(32767);
  return saida;
}

/**
 * Baixa e analisa uma lista de URLs com concorrência limitada.
 */
export async function carregarUrls(urls, progresso = () => {}, concorrencia = 8, sinal = null) {
  const arquivos = new Array(urls.length);
  let concluidos = 0;
  let proximo = 0;

  async function trabalhador() {
    for (;;) {
      const i = proximo++;
      if (i >= urls.length) return;
      const resp = await fetch(urls[i], { signal: sinal });
      if (!resp.ok) throw new Error(`Falha ao baixar ${urls[i]} (HTTP ${resp.status})`);
      arquivos[i] = new ArquivoDicom(await resp.arrayBuffer(), urls[i].split('/').pop());
      concluidos++;
      if (concluidos % 4 === 0 || concluidos === urls.length) {
        progresso(`Baixando fatias (${concluidos}/${urls.length})`, concluidos / urls.length);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concorrencia, urls.length) }, trabalhador));
  return arquivos.filter(Boolean);
}

/**
 * Lê arquivos locais (input[type=file] ou arrastar-e-soltar) e agrupa por série.
 */
export async function carregarArquivosLocais(fileList, progresso = () => {}) {
  const lista = Array.from(fileList).filter((f) => {
    const n = f.name.toLowerCase();
    return !n.endsWith('.png') && !n.endsWith('.jpg') && !n.endsWith('.json')
      && !n.endsWith('.md') && !n.endsWith('.zip') && n !== 'dicomdir';
  });

  const arquivos = [];
  for (let i = 0; i < lista.length; i++) {
    try {
      arquivos.push(new ArquivoDicom(await lista[i].arrayBuffer(), lista[i].name));
    } catch { /* não é DICOM — ignora */ }
    if (i % 8 === 0) {
      progresso(`Lendo arquivos (${i + 1}/${lista.length})`, i / lista.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const series = new Map();
  for (const a of arquivos) {
    if (a.texto(TAG.Modality) !== 'CT') continue;
    const uid = a.texto(TAG.SeriesInstanceUID) || `sem-uid:${a.nome}`;
    if (!series.has(uid)) series.set(uid, []);
    series.get(uid).push(a);
  }
  return [...series.entries()]
    .map(([uid, itens]) => ({ uid, arquivos: itens }))
    .sort((a, b) => b.arquivos.length - a.arquivos.length);
}
