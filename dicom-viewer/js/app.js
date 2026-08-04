/**
 * Leitor DICOM — orquestração da interface.
 */

import { montarVolume, carregarUrls, carregarArquivosLocais } from './volume.js';
import { Viewport, PALETAS, construirLut } from './mpr.js';
import { Renderizador3D, TRANSFERENCIAS } from './render3d.js';
import { instalarPonteSimulador } from './simulator-bridge.js';
import {
  PRESETS, TRANSFER_PADRAO, PALETA_PADRAO, resolverPreset,
  carregarManifesto as buscarManifesto, urlsDaSerie, arquivosDoDrop,
  criarCartaoExame, criarOpcaoSerie, preencherDetalhes,
} from './comum.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
const estado = {
  volume: null,
  cursor: [0, 0, 0],
  janela: { centro: 40, largura: 400 },
  lut: construirLut(40, 400),
  paleta: 'cinza',
  suavizar: true,
  mostrarCrosshair: true,
  ferramenta: 'cursor',
  redesenhar,
  aoMoverCursor,
  aoMudarJanela,
  aoPassarMouse,
  aoSairMouse,
};

let viewports = [];
let render3d = null;
let manifesto = [];
let anim3d = null;
let sequenciaCarga = 0;
let controladorCarga = null;

function novaCarga() {
  controladorCarga?.abort();
  controladorCarga = new AbortController();
  const id = ++sequenciaCarga;
  return { id, sinal: controladorCarga.signal, atual: () => id === sequenciaCarga };
}

// ---------------------------------------------------------------------------
function iniciar() {
  viewports = [
    new Viewport($('cvAxial'), 'axial', estado),
    new Viewport($('cvCoronal'), 'coronal', estado),
    new Viewport($('cvSagital'), 'sagital', estado),
  ];

  render3d = new Renderizador3D($('cv3d'));
  if (!render3d.disponivel) {
    $('aviso3d').hidden = false;
    $('aviso3d').textContent = render3d.erro
      + ' A reconstrução MPR (axial, coronal e sagital) continua funcionando normalmente.';
  } else {
    render3d.aoMudar = agendar3d;
  }

  preencherSelects();
  ligarControles();
  ligarArrastarSoltar();
  ligarExpandir();

  window.addEventListener('resize', dimensionar);
  dimensionar();
  carregarManifesto();
}

function preencherSelects() {
  const sp = $('ctrlPaleta');
  for (const [k, v] of Object.entries(PALETAS)) {
    sp.append(new Option(v.rotulo, k));
  }
  const st = $('ctrlTransfer');
  for (const [k, v] of Object.entries(TRANSFERENCIAS)) {
    st.append(new Option(v.rotulo, k));
  }
}

// ---------------------------------------------------------------------------
async function carregarManifesto() {
  const lista = $('listaExames');
  try {
    manifesto = await buscarManifesto();
  } catch {
    const aviso = document.createElement('p');
    aviso.className = 'dica';
    aviso.textContent = 'Nenhum exame de exemplo encontrado. Rode '
      + 'python3 scripts/prepare_datasets.py all ou abra uma pasta local.';
    lista.replaceChildren(aviso);
    return;
  }

  lista.replaceChildren();
  for (const s of manifesto) {
    const b = criarCartaoExame(s,
      `${s.modality} · ${s.files} cortes · ${(s.bytes / 1e6).toFixed(0)} MB`);
    b.addEventListener('click', () => abrirExame(s));
    lista.append(b);
  }
}

async function abrirExame(s) {
  const carga = novaCarga();
  document.querySelectorAll('.cartao').forEach((c) => {
    c.classList.toggle('ativo', c.dataset.id === s.id);
  });
  const urls = urlsDaSerie(s);
  await comProgresso(async (p) => {
    const arquivos = await carregarUrls(urls, p, 8, carga.sinal);
    if (!carga.atual()) return;
    p('Montando volume…', 0.9);
    aplicarVolume(montarVolume(arquivos, p), s);
  }, carga.id);
}

// ---------------------------------------------------------------------------
function aplicarVolume(volume, meta = null) {
  estado.volume = volume;
  estado.cursor = volume.dims.map((n) => Math.floor(n / 2));
  estado.paleta = PALETA_PADRAO[volume.modalidade] || 'cinza';
  $('ctrlPaleta').value = estado.paleta;

  const presets = PRESETS.CT;
  definirJanela(resolverPreset(presets[0], volume));
  montarPresets(presets);

  $('blocoControles').hidden = false;
  $('blocoDetalhes').hidden = false;
  $('bloco3d').hidden = !render3d.disponivel;

  $('infoSerie').textContent = meta
    ? `${meta.label} — ${volume.dims.join(' × ')}`
    : `${volume.descricaoSerie || volume.modalidade} — ${volume.dims.join(' × ')}`;

  mostrarDetalhes(volume, meta);

  const faixa = Math.max(200, volume.maximo - volume.minimo);
  $('ctrlCentro').min = volume.minimo - faixa * 0.1;
  $('ctrlCentro').max = volume.maximo + faixa * 0.1;
  $('ctrlLargura').max = Math.round(faixa * 1.4);

  viewports.forEach((v) => v.ajustar());

  if (render3d.disponivel) {
    const t = TRANSFER_PADRAO.CT;
    $('ctrlTransfer').value = t;
    render3d.definirTransferencia(t);
    render3d.janela = estado.janela;
    render3d.definirVolume(volume, 256);
    agendar3d();
  }

  atualizarStatus();
  dimensionar();
}

function montarPresets(presets) {
  const cont = $('presets');
  cont.replaceChildren();
  presets.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'chip' + (i === 0 ? ' ativo' : '');
    b.textContent = p.nome;
    b.addEventListener('click', () => {
      cont.querySelectorAll('.chip').forEach((c) => c.classList.remove('ativo'));
      b.classList.add('ativo');
      definirJanela(resolverPreset(p, estado.volume));
    });
    cont.append(b);
  });
}

function definirJanela({ centro, largura }) {
  estado.janela.centro = centro;
  estado.janela.largura = largura;
  aoMudarJanela();
}

function mostrarDetalhes(v, meta) {
  const mm = v.extensao.map((e) => e.toFixed(0));
  const linhas = [
    ['Modalidade', v.modalidade],
    ['Dimensões', v.dims.join(' × ')],
    ['Voxel (mm)', v.espacamento.map((e) => e.toFixed(2)).join(' × ')],
    ['Campo (mm)', mm.join(' × ')],
    ['Faixa', `${v.minimo} … ${v.maximo}${v.unidadeHU ? ' HU' : ''}`],
    ['Sintaxe', v.sintaxe],
  ];
  if (v.descricaoSerie) linhas.unshift(['Série', v.descricaoSerie]);
  if (v.fabricante) linhas.push(['Equipamento', v.fabricante]);

  const avisos = [];
  if (v.descartados) avisos.push(`${v.descartados} imagem(ns) com dimensão divergente foram ignoradas.`);
  if (meta?.notes) avisos.push(meta.notes);
  if (meta?.attribution) avisos.push(`Fonte: ${meta.attribution}.`);

  preencherDetalhes($('detalhes'), linhas, avisos);
}

// ---------------------------------------------------------------------------
function redesenhar() {
  if (!estado.volume) return;
  viewports.forEach((v) => v.desenhar());
}

function aoMoverCursor() {
  redesenhar();
  atualizarStatus();
}

function aoMudarJanela() {
  const j = estado.janela;
  j.largura = Math.max(1, Math.round(j.largura));
  j.centro = Math.round(j.centro);
  estado.lut = construirLut(j.centro, j.largura);
  $('ctrlCentro').value = j.centro;
  $('ctrlLargura').value = j.largura;
  $('valCentro').textContent = j.centro;
  $('valLargura').textContent = j.largura;
  $('statusJanela').textContent = `C ${j.centro} / L ${j.largura}`;
  redesenhar();
  agendar3d();
}

function aoPassarMouse(viewport, cx, cy) {
  const v = estado.volume;
  if (!v) return;
  const p = viewport.canvasParaVoxel(cx, cy).map((x, i) => Math.round(
    i === viewport.def.eixoFixo ? estado.cursor[i] : x));
  if (p.some((x, i) => x < 0 || x >= v.dims[i])) { atualizarStatus(); return; }
  const valor = v.valor(p[0], p[1], p[2]);
  const mm = v.paciente(p[0], p[1], p[2]);
  $('statusCursor').textContent =
    `voxel [${p.join(', ')}]   LPS (${mm.map((m) => m.toFixed(1)).join(', ')}) mm   `
    + `valor ${valor}${v.unidadeHU ? ' HU' : ''}`;
}

function aoSairMouse() { atualizarStatus(); }

function atualizarStatus() {
  const v = estado.volume;
  if (!v) return;
  const c = estado.cursor;
  const mm = v.paciente(c[0], c[1], c[2]);
  $('statusCursor').textContent =
    `cursor [${c.join(', ')}]   LPS (${mm.map((m) => m.toFixed(1)).join(', ')}) mm   `
    + `valor ${v.valor(c[0], c[1], c[2])}${v.unidadeHU ? ' HU' : ''}`;
}

function agendar3d() {
  if (!render3d?.disponivel || !estado.volume) return;
  render3d.janela = estado.janela;
  if (anim3d) return;
  anim3d = requestAnimationFrame(() => { anim3d = null; render3d.desenhar(); });
}

function dimensionar() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const v of viewports) {
    const r = v.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (v.canvas.width !== w || v.canvas.height !== h) {
      v.canvas.width = w;
      v.canvas.height = h;
    }
  }
  redesenhar();
  agendar3d();
}

// ---------------------------------------------------------------------------
function ligarControles() {
  $('ctrlCentro').addEventListener('input', (e) => {
    estado.janela.centro = +e.target.value; aoMudarJanela();
  });
  $('ctrlLargura').addEventListener('input', (e) => {
    estado.janela.largura = +e.target.value; aoMudarJanela();
  });
  $('ctrlPaleta').addEventListener('change', (e) => {
    estado.paleta = e.target.value; redesenhar();
  });
  $('ctrlSuavizar').addEventListener('change', (e) => {
    estado.suavizar = e.target.checked; redesenhar();
  });
  $('ctrlCrosshair').addEventListener('change', (e) => {
    estado.mostrarCrosshair = e.target.checked; redesenhar();
  });

  $('modos3d').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    $('modos3d').querySelectorAll('.chip').forEach((c) => c.classList.remove('ativo'));
    b.classList.add('ativo');
    render3d.modo = b.dataset.modo;
    agendar3d();
  });
  $('vistas3d').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    render3d.vista(b.dataset.vista);
    agendar3d();
  });
  $('ctrlTransfer').addEventListener('change', (e) => {
    render3d.definirTransferencia(e.target.value); agendar3d();
  });
  $('ctrlOpacidade').addEventListener('input', (e) => {
    render3d.opacidade = e.target.value / 100;
    $('valOpacidade').textContent = render3d.opacidade.toFixed(1).replace('.', ',');
    agendar3d();
  });
  $('ctrlCorte').addEventListener('input', (e) => {
    render3d.corte = e.target.value / 100;
    $('valCorte').textContent = `${e.target.value}%`;
    agendar3d();
  });
  $('ctrlQualidade').addEventListener('change', (e) => {
    render3d.qualidade = +e.target.value; agendar3d();
  });
  $('ctrlSombra').addEventListener('change', (e) => {
    render3d.sombrear = e.target.checked; agendar3d();
  });

  for (const id of ['entradaPasta', 'entradaArquivos']) {
    $(id).addEventListener('change', async (e) => {
      await abrirLocais(e.target.files);
      e.target.value = '';
    });
  }
  $('fecharErro').addEventListener('click', () => { $('erro').hidden = true; });
  $('cancelarSerie').addEventListener('click', () => { $('seletorSerie').hidden = true; });

  document.addEventListener('keydown', (e) => {
    if (!estado.volume) return;
    const passo = e.shiftKey ? 10 : 1;
    const mapa = { ArrowUp: [2, 1], ArrowDown: [2, -1], PageUp: [2, 1], PageDown: [2, -1] };
    const m = mapa[e.key];
    if (m) {
      e.preventDefault();
      const n = estado.volume.dims[m[0]];
      estado.cursor[m[0]] = Math.max(0, Math.min(n - 1, estado.cursor[m[0]] + m[1] * passo));
      aoMoverCursor();
    }
  });
}

function ligarExpandir() {
  const grade = $('grade');
  grade.addEventListener('click', (e) => {
    const botao = e.target.closest('.expandir');
    if (!botao) return;
    const fig = botao.closest('.viewport');
    const jaFoco = fig.classList.contains('foco') && grade.classList.contains('expandida');
    grade.querySelectorAll('.viewport').forEach((f) => f.classList.remove('foco'));
    grade.classList.toggle('expandida', !jaFoco);
    if (!jaFoco) fig.classList.add('foco');
    requestAnimationFrame(dimensionar);
  });
}

function ligarArrastarSoltar() {
  let contador = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault(); contador++; document.body.classList.add('arrastando');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => {
    if (--contador <= 0) document.body.classList.remove('arrastando');
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    contador = 0;
    document.body.classList.remove('arrastando');
    const arquivos = await arquivosDoDrop(e.dataTransfer);
    if (arquivos.length) abrirLocais(arquivos);
  });
}

async function abrirLocais(fileList) {
  if (!fileList || !fileList.length) return;
  const carga = novaCarga();
  await comProgresso(async (p) => {
    const series = await carregarArquivosLocais(fileList, p);
    if (!carga.atual()) return;
    if (!series.length) throw new Error('Nenhuma série de tomografia (CT) legível foi encontrada.');
    if (series.length === 1) {
      document.querySelectorAll('.cartao').forEach((c) => c.classList.remove('ativo'));
      aplicarVolume(montarVolume(series[0].arquivos, p));
      return;
    }
    escolherSerie(series);
  }, carga.id);
}

function escolherSerie(series) {
  const cont = $('listaSeries');
  cont.replaceChildren();
  for (const s of series) {
    const a = s.arquivos[0];
    const b = criarOpcaoSerie(
      a.texto('0008103E') || a.texto('00080060') || 'Série',
      `${a.texto('00080060')} · ${s.arquivos.length} imagens · `
        + `${a.colunas}×${a.linhas} · ${a.sintaxeNome}`);
    b.addEventListener('click', async () => {
      $('seletorSerie').hidden = true;
      const carga = novaCarga();
      await comProgresso(async (pp) => {
        document.querySelectorAll('.cartao').forEach((c) => c.classList.remove('ativo'));
        if (!carga.atual()) return;
        aplicarVolume(montarVolume(s.arquivos, pp));
      }, carga.id);
    });
    cont.append(b);
  }
  $('seletorSerie').hidden = false;
}

// ---------------------------------------------------------------------------
async function comProgresso(tarefa, cargaId = sequenciaCarga) {
  const caixa = $('carregando');
  const barra = $('barraProgresso');
  const texto = $('textoProgresso');
  caixa.hidden = false;
  barra.style.width = '0%';
  texto.textContent = 'Carregando…';
  const p = (msg, frac) => {
    texto.textContent = msg;
    barra.style.width = `${Math.round((frac || 0) * 100)}%`;
  };
  try {
    await tarefa(p);
  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error(err);
    $('textoErro').textContent = err.message || String(err);
    $('erro').hidden = false;
  } finally {
    if (cargaId === sequenciaCarga) caixa.hidden = true;
  }
}

iniciar();
instalarPonteSimulador(aplicarVolume);

// Exposto para inspeção no console do navegador (depuração).
window.leitorDicom = { estado, get viewports() { return viewports; }, get render3d() { return render3d; } };
