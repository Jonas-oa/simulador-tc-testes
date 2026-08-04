/**
 * Peças compartilhadas pelas duas interfaces (computador e celular).
 * Nada aqui toca no DOM de uma versão específica.
 */

export const PRESETS = {
  CT: [
    { nome: 'Partes moles', centro: 40, largura: 400 },
    { nome: 'Pulmão', centro: -600, largura: 1500 },
    { nome: 'Osso', centro: 400, largura: 1800 },
    { nome: 'Cérebro', centro: 40, largura: 80 },
    { nome: 'Fígado', centro: 60, largura: 160 },
    { nome: 'Angio', centro: 200, largura: 600 },
  ],
};

export const TRANSFER_PADRAO = { CT: 'osso' };
export const PALETA_PADRAO = { CT: 'cinza' };

/** Traduz uma predefinição de janela para valores concretos. */
export function resolverPreset(p, volume) {
  if (p.auto) return { centro: volume.janela.centro, largura: volume.janela.largura };
  if (p.amplo) {
    return {
      centro: Math.round((volume.maximo + volume.minimo) / 2),
      largura: Math.max(1, volume.maximo - volume.minimo),
    };
  }
  return { centro: p.centro, largura: p.largura };
}

// ---------------------------------------------------------------------------
// Perfis de carga — usados na versão de celular, onde memória e rede pesam.
// `voxels` é o teto aproximado de voxels do volume montado.
// ---------------------------------------------------------------------------
export const PERFIS = {
  leve: { rotulo: 'Leve', voxels: 12e6, ladoMax: 256, cortesMax: 100, textura3d: 128 },
  media: { rotulo: 'Média', voxels: 30e6, ladoMax: 384, cortesMax: 220, textura3d: 192 },
  completa: {
    rotulo: 'Completa', voxels: Infinity, ladoMax: Infinity,
    cortesMax: Infinity, textura3d: 256,
  },
};

/**
 * Escolhe redução no plano e passo entre cortes para caber num perfil.
 *
 * `cortesMax` é o que segura o tamanho do download — pular cortes evita baixar
 * os arquivos; reduzir no plano só economiza memória, porque o arquivo é
 * baixado inteiro de qualquer jeito.
 *
 * @param {{rows:number, columns:number, files:number, bytes?:number}} serie
 */
export function planoDeCarga(serie, perfil) {
  const p = PERFIS[perfil] || PERFIS.media;

  let reducao = 1;
  while (Math.max(serie.rows, serie.columns) / reducao > p.ladoMax) reducao++;

  let passoFatia = Math.max(1, Math.ceil(serie.files / p.cortesMax));

  const voxels = () => Math.floor(serie.rows / reducao) * Math.floor(serie.columns / reducao)
    * Math.ceil(serie.files / passoFatia);

  // se ainda não couber, alterna entre afinar os cortes e reduzir o plano
  let alternar = false;
  while (voxels() > p.voxels && (reducao <= 8 || passoFatia <= 8)) {
    if (alternar) reducao++;
    else passoFatia++;
    alternar = !alternar;
  }

  return {
    reducaoPlano: reducao,
    passoFatia,
    textura3d: p.textura3d,
    cortes: Math.ceil(serie.files / passoFatia),
    matriz: [Math.floor(serie.columns / reducao), Math.floor(serie.rows / reducao)],
    bytes: Math.round((serie.bytes || 0) / passoFatia),
    reduzido: reducao > 1 || passoFatia > 1,
  };
}

/** Perfil inicial sugerido a partir do que o aparelho informa. */
export function perfilSugerido() {
  const mem = navigator.deviceMemory || 4;          // GB, aproximado
  if (mem <= 3) return 'leve';
  if (mem >= 8) return 'completa';
  return 'media';
}

/** Heurística para mandar o visitante à interface de toque. */
export function pareceCelular() {
  const toque = window.matchMedia?.('(pointer: coarse)').matches;
  const estreito = Math.min(window.innerWidth, window.innerHeight) < 820;
  return !!toque && estreito;
}

// ---------------------------------------------------------------------------
export async function carregarManifesto() {
  const resp = await fetch('datasets/manifest.json');
  if (!resp.ok) throw new Error(`manifest.json (HTTP ${resp.status})`);
  return (await resp.json()).series.filter((s) => s.modality === 'CT');
}

/** URLs das fatias de uma série do manifesto, aplicando o passo entre cortes. */
export function urlsDaSerie(serie, passoFatia = 1) {
  const urls = [];
  for (let i = 1; i <= serie.files; i += passoFatia) {
    urls.push(`${serie.path}/${String(i).padStart(4, '0')}.dcm`);
  }
  return urls;
}

export function formatarBytes(n) {
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;
}

/** Monta um cartão sem interpretar metadados ou manifesto como HTML. */
export function criarCartaoExame(serie, resumo) {
  const botao = document.createElement('button');
  botao.className = 'cartao';
  botao.dataset.id = serie.id;

  const img = document.createElement('img');
  img.src = `datasets/${encodeURIComponent(serie.id)}.png`;
  img.alt = '';
  img.loading = 'lazy';

  const corpo = document.createElement('span');
  const titulo = document.createElement('b');
  titulo.textContent = serie.label;
  const regiao = document.createElement('small');
  regiao.textContent = serie.region;
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = resumo;
  corpo.append(titulo, regiao, tag);
  botao.append(img, corpo);
  return botao;
}

/** Opção de série local; o texto vem de cabeçalhos DICOM não confiáveis. */
export function criarOpcaoSerie(titulo, resumo, classeCartao = false) {
  const botao = document.createElement('button');
  if (classeCartao) {
    botao.className = 'cartao';
    botao.style.gridTemplateColumns = '1fr';
  }
  const corpo = document.createElement('span');
  const forte = document.createElement('b');
  forte.textContent = titulo;
  const pequeno = document.createElement('small');
  pequeno.textContent = resumo;
  corpo.append(forte, pequeno);
  botao.append(corpo);
  return botao;
}

/** Preenche o quadro de detalhes sem `innerHTML`, evitando injeção por DICOM. */
export function preencherDetalhes(elemento, linhas, avisos = []) {
  const nos = [];
  for (const [chave, valor] of linhas) {
    const linha = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = chave;
    dd.textContent = String(valor);
    linha.append(dt, dd);
    nos.push(linha);
  }
  if (avisos.length) {
    const obs = document.createElement('span');
    obs.className = 'obs';
    avisos.forEach((aviso, i) => {
      if (i) obs.append(document.createElement('br'));
      obs.append(document.createTextNode(aviso));
    });
    nos.push(obs);
  }
  elemento.replaceChildren(...nos);
}

/** Extrai arquivos de um drop, entrando em subpastas quando possível. */
export async function arquivosDoDrop(dt) {
  const itens = Array.from(dt.items || []);
  const entradas = itens
    .map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (!entradas.length) return Array.from(dt.files || []);

  const saida = [];
  async function percorrer(entrada) {
    if (entrada.isFile) {
      saida.push(await new Promise((res, rej) => entrada.file(res, rej)));
    } else if (entrada.isDirectory) {
      const leitor = entrada.createReader();
      for (;;) {
        const lote = await new Promise((res, rej) => leitor.readEntries(res, rej));
        if (!lote.length) break;
        for (const e of lote) await percorrer(e);
      }
    }
  }
  for (const e of entradas) await percorrer(e);
  return saida;
}
