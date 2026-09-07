/**
 * Leitor DICOM — interface para celular.
 *
 * Mesmo motor da versão de computador (dicom.js, volume.js, mpr.js,
 * render3d.js); muda a casca: um plano por vez, gestos de toque, folhas
 * deslizantes e carga adaptada à memória do aparelho.
 */

import { montarVolume, carregarUrls, carregarArquivosLocais } from './volume.js?v=20260907q';
import { Viewport, PALETAS, construirLut } from './mpr.js?v=20260907q';
import { Renderizador3D, TRANSFERENCIAS } from './render3d.js?v=20260907q';
import { instalarPonteSimulador } from './simulator-bridge.js?v=20260907q';
import {
  PRESETS, TRANSFER_PADRAO, PALETA_PADRAO, resolverPreset, PERFIS,
  planoDeCarga, perfilSugerido, carregarManifesto, urlsDaSerie, formatarBytes,
  criarCartaoExame, criarOpcaoSerie, preencherDetalhes,
} from './comum.js?v=20260907q';

const $ = (id) => document.getElementById(id);

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
  aoPassarMouse: () => {},
  aoSairMouse: () => {},
  aoFocarViewport: () => {},
};

const viewports = {};
let render3d = null;
let manifesto = [];
let perfil = perfilSugerido();
let planoAtivo = 'axial';
let emGrade = false;
let anim3d = null;
let sequenciaCarga = 0;
let controladorCarga = null;
const NOMES_PRESETS_RAPIDOS = ['Pulmão', 'Partes moles', 'Osso'];

function novaCarga() {
  controladorCarga?.abort();
  controladorCarga = new AbortController();
  const id = ++sequenciaCarga;
  return { id, sinal: controladorCarga.signal, atual: () => id === sequenciaCarga };
}

// ---------------------------------------------------------------------------
function iniciar() {
  viewports.axial = new Viewport($('cvAxial'), 'axial', estado, { toque: true });
  viewports.coronal = new Viewport($('cvCoronal'), 'coronal', estado, { toque: true });
  viewports.sagital = new Viewport($('cvSagital'), 'sagital', estado, { toque: true });

  render3d = new Renderizador3D($('cv3d'));
  if (!render3d.disponivel) {
    $('aviso3d').hidden = false;
    $('aviso3d').textContent = `${render3d.erro} Os cortes axial, coronal e `
      + 'sagital continuam funcionando.';
  } else {
    render3d.aoMudar = agendar3d;
    render3d.qualidade = 0.75;   // o 3D é o item mais caro num celular
  }

  for (const [k, v] of Object.entries(PALETAS)) $('ctrlPaleta').append(new Option(v.rotulo, k));
  for (const [k, v] of Object.entries(TRANSFERENCIAS)) $('ctrlTransfer').append(new Option(v.rotulo, k));
  montarPresetsRapidos(PRESETS.CT);

  marcarPerfil(perfil);
  ligarNavegacao();
  ligarFolhas();
  ligarControles();

  const redimensionar = () => { dimensionar(); };
  window.addEventListener('resize', redimensionar);
  window.addEventListener('orientationchange', () => setTimeout(redimensionar, 250));

  dimensionar();
  montarListaExames();
  abrirFolha('folhaExames');
}

// ---------------------------------------------------------------------------
async function montarListaExames() {
  const lista = $('listaExames');
  if (!manifesto.length) {
    try {
      manifesto = await carregarManifesto();
    } catch {
      const aviso = document.createElement('p');
      aviso.className = 'nota';
      aviso.textContent = 'Nenhum exame de exemplo encontrado. Use “Abrir arquivos do aparelho”.';
      lista.replaceChildren(aviso);
      return;
    }
  }

  lista.replaceChildren();
  for (const s of manifesto) {
    const carga = planoDeCarga(s, perfil);
    const b = criarCartaoExame(s,
      `${s.modality} · ${carga.matriz[0]}×${carga.matriz[1]}×${carga.cortes} `
        + `· baixa ${formatarBytes(carga.bytes)}`);
    b.addEventListener('click', () => abrirExame(s));
    lista.append(b);
  }
  atualizarNotaQualidade();
}

function atualizarNotaQualidade() {
  const p = PERFIS[perfil];
  const texto = {
    leve: 'Menos cortes e metade da resolução: abre rápido e cabe em aparelhos simples.',
    media: 'Equilíbrio entre detalhe e memória. Recomendado para a maioria dos celulares.',
    completa: 'Resolução original das séries. Pode ficar pesado em aparelhos com pouca memória.',
  }[perfil];
  $('notaQualidade').textContent = `${p.rotulo} — ${texto}`;
}

function marcarPerfil(nome) {
  perfil = nome;
  $('segQualidade').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('ativo', b.dataset.perfil === nome);
  });
}

async function abrirExame(s) {
  const requisicao = novaCarga();
  const carga = planoDeCarga(s, perfil);
  document.querySelectorAll('.cartao').forEach((c) => {
    c.classList.toggle('ativo', c.dataset.id === s.id);
  });
  fecharFolhas();
  await comProgresso(async (p) => {
    const arquivos = await carregarUrls(urlsDaSerie(s, carga.passoFatia), p, 6,
      requisicao.sinal);
    if (!requisicao.atual()) return;
    p('Montando volume…', 0.9);
    aplicarVolume(montarVolume(arquivos, p, { reducaoPlano: carga.reducaoPlano }), s, carga);
  }, requisicao.id);
}

// ---------------------------------------------------------------------------
function aplicarVolume(volume, meta = null, carga = null) {
  estado.volume = volume;
  estado.cursor = volume.dims.map((n) => Math.floor(n / 2));
  estado.paleta = PALETA_PADRAO[volume.modalidade] || 'cinza';
  $('ctrlPaleta').value = estado.paleta;

  const presets = PRESETS.CT;
  definirJanela(resolverPreset(presets[0], volume));

  $('tituloExame').textContent = meta ? meta.label : (volume.descricaoSerie || volume.modalidade);
  $('subExame').textContent = `${volume.modalidade} · ${volume.dims.join('×')}`
    + (carga?.reduzido ? ' · reduzido' : '');

  const faixa = Math.max(200, volume.maximo - volume.minimo);
  $('ctrlJanelaCentro').min = Math.round(volume.minimo - faixa * 0.1);
  $('ctrlJanelaCentro').max = Math.round(volume.maximo + faixa * 0.1);
  $('ctrlJanelaLargura').max = Math.round(faixa * 1.4);

  Object.values(viewports).forEach((v) => v.ajustar());
  mostrarDetalhes(volume, meta, carga);

  if (render3d.disponivel) {
    const t = TRANSFER_PADRAO.CT;
    $('ctrlTransfer').value = t;
    render3d.definirTransferencia(t);
    render3d.janela = estado.janela;
    render3d.definirVolume(volume, carga?.textura3d || PERFIS[perfil].textura3d);
  }

  $('caixaCorte').hidden = false;
  $('leitura').hidden = false;
  sincronizarCorte();
  atualizarLeitura();
  dimensionar();
}

function montarPresetsRapidos(presets) {
  const cont = $('presetsRapidos');
  cont.replaceChildren();
  const rapidos = NOMES_PRESETS_RAPIDOS.map((nome) => presets.find((p) => p.nome === nome))
    .filter(Boolean);
  rapidos.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.nome;
    b.dataset.centro = p.centro;
    b.dataset.largura = p.largura;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      definirJanela(resolverPreset(p, estado.volume));
    });
    cont.append(b);
  });
  sincronizarPresetRapido();
}

function sincronizarPresetRapido() {
  const cont = $('presetsRapidos');
  if (!cont) return;
  cont.querySelectorAll('button').forEach((b) => {
    const ativo = +b.dataset.centro === estado.janela.centro
      && +b.dataset.largura === estado.janela.largura;
    b.classList.toggle('ativo', ativo);
    b.setAttribute('aria-pressed', String(ativo));
  });
}

function mostrarMenuJanela(mostrar) {
  $('menuJanela').hidden = !mostrar;
  const botao = $('ferramentas').querySelector('[data-fer="janela"]');
  botao.setAttribute('aria-expanded', String(mostrar));
}

function definirJanela({ centro, largura }) {
  estado.janela.centro = centro;
  estado.janela.largura = largura;
  aoMudarJanela();
}

function mostrarDetalhes(v, meta, carga) {
  const linhas = [
    ['Modalidade', v.modalidade],
    ['Dimensões', v.dims.join(' × ')],
    ['Voxel (mm)', v.espacamento.map((e) => e.toFixed(2)).join(' × ')],
    ['Campo (mm)', v.extensao.map((e) => e.toFixed(0)).join(' × ')],
    ['Faixa', `${v.minimo} … ${v.maximo}${v.unidadeHU ? ' HU' : ''}`],
    ['Sintaxe', v.sintaxe],
  ];
  if (v.descricaoSerie) linhas.unshift(['Série', v.descricaoSerie]);

  const avisos = [];
  if (carga?.reduzido) {
    const partes = [];
    if (carga.reducaoPlano > 1) partes.push(`${carga.reducaoPlano}× no plano (média dos pixels)`);
    if (carga.passoFatia > 1) partes.push(`1 corte a cada ${carga.passoFatia}`);
    avisos.push(`Carregado em qualidade ${PERFIS[perfil].rotulo.toLowerCase()}: `
      + `${partes.join(' e ')}. As medidas em milímetros continuam corretas.`);
  }
  if (meta?.notes) avisos.push(meta.notes);
  if (meta?.attribution) avisos.push(`Fonte: ${meta.attribution}.`);

  preencherDetalhes($('detalhes'), linhas, avisos);
}

// ---------------------------------------------------------------------------
function visiveis() {
  if (emGrade) return ['axial', 'coronal', 'sagital'];
  return planoAtivo === 'tridi' ? [] : [planoAtivo];
}

function redesenhar() {
  if (!estado.volume) return;
  for (const nome of visiveis()) viewports[nome].desenhar();
}

function aoMoverCursor() {
  redesenhar();
  sincronizarCorte();
  atualizarLeitura();
  if (emGrade || planoAtivo === 'tridi') agendar3d();
}

function aoMudarJanela() {
  const j = estado.janela;
  j.largura = Math.max(1, Math.round(j.largura));
  j.centro = Math.round(j.centro);
  estado.lut = construirLut(j.centro, j.largura);
  $('ctrlJanelaCentro').value = j.centro;
  $('ctrlJanelaLargura').value = j.largura;
  $('valCentro').textContent = j.centro;
  $('valLargura').textContent = j.largura;
  sincronizarPresetRapido();
  redesenhar();
  agendar3d();
}

function atualizarLeitura() {
  const v = estado.volume;
  if (!v) return;
  const c = estado.cursor;
  const mm = v.paciente(c[0], c[1], c[2]);
  $('leitura').textContent = `${v.valor(c[0], c[1], c[2])}${v.unidadeHU ? ' HU' : ''}`
    + `  ·  LPS ${mm.map((m) => m.toFixed(0)).join(', ')} mm`;
}

/** Mantém o controle deslizante de corte casado com o plano em foco. */
function sincronizarCorte() {
  const v = estado.volume;
  const barra = $('ctrlCorte');
  if (!v || planoAtivo === 'tridi' || emGrade) {
    $('caixaCorte').hidden = true;
    return;
  }
  $('caixaCorte').hidden = false;
  const eixo = viewports[planoAtivo].def.eixoFixo;
  barra.max = v.dims[eixo] - 1;
  barra.value = Math.round(estado.cursor[eixo]);
  $('rotuloCorte').textContent = `${+barra.value + 1}/${v.dims[eixo]}`;
}

function agendar3d() {
  if (!render3d?.disponivel || !estado.volume) return;
  if (!emGrade && planoAtivo !== 'tridi') return;
  render3d.janela = estado.janela;
  if (anim3d) return;
  anim3d = requestAnimationFrame(() => { anim3d = null; render3d.desenhar(); });
}

function dimensionar() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  for (const nome of visiveis()) {
    const c = viewports[nome].canvas;
    const r = c.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }
  redesenhar();
  agendar3d();
}

// ---------------------------------------------------------------------------
function ligarNavegacao() {
  $('abas').addEventListener('click', (e) => {
    const b = e.target.closest('.aba');
    if (!b) return;
    $('abas').querySelectorAll('.aba').forEach((x) => x.classList.remove('ativo'));
    b.classList.add('ativo');

    emGrade = b.dataset.plano === 'grade';
    $('palco').classList.toggle('grade', emGrade);
    if (!emGrade) planoAtivo = b.dataset.plano;

    document.querySelectorAll('.vp').forEach((f) => {
      f.classList.toggle('ativo', emGrade || f.dataset.plano === planoAtivo);
    });

    $('ferramentas').style.visibility = (!emGrade && planoAtivo === 'tridi') ? 'hidden' : '';
    // na grade 2×2 cada quadro já mostra os próprios dados; a leitura sobraria
    $('leitura').hidden = emGrade || !estado.volume;
    mostrarMenuJanela(false);
    sincronizarCorte();
    requestAnimationFrame(dimensionar);
  });

  $('ferramentas').addEventListener('click', (e) => {
    const b = e.target.closest('.fer');
    if (!b) return;
    const abrirPresets = b.dataset.fer === 'janela' && $('menuJanela').hidden;
    $('ferramentas').querySelectorAll('.fer').forEach((x) => x.classList.remove('ativo'));
    b.classList.add('ativo');
    estado.ferramenta = b.dataset.fer;
    mostrarMenuJanela(abrirPresets);
  });

  // no modo 2×2, tocar num viewport passa o foco do controle de corte para ele
  estado.aoFocarViewport = (vp) => {
    if (!emGrade) return;
    planoAtivo = vp.plano;
  };

  $('ctrlCorte').addEventListener('input', (e) => {
    if (!estado.volume) return;
    const eixo = viewports[planoAtivo].def.eixoFixo;
    estado.cursor[eixo] = Math.max(0, Math.min(estado.volume.dims[eixo] - 1, +e.target.value));
    redesenhar();
    atualizarLeitura();
    $('rotuloCorte').textContent = `${+e.target.value + 1}/${estado.volume.dims[eixo]}`;
  });
}

function ligarFolhas() {
  $('btExames').addEventListener('click', () => { montarListaExames(); abrirFolha('folhaExames'); });
  $('btAjustes').addEventListener('click', () => {
    if (!estado.volume) { abrirFolha('folhaExames'); return; }
    const so3d = !render3d.disponivel;
    for (const id of ['tit3d', 'modos3d', 'vistas3d']) $(id).hidden = so3d;
    abrirFolha('folhaAjustes');
  });
  $('cortina').addEventListener('click', fecharFolhas);

  $('segQualidade').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    marcarPerfil(b.dataset.perfil);
    montarListaExames();
  });

  $('entradaArquivos').addEventListener('change', async (e) => {
    await abrirLocais(e.target.files);
    e.target.value = '';
  });
  $('fecharErro').addEventListener('click', () => { $('erro').hidden = true; });
}

function abrirFolha(id) {
  mostrarMenuJanela(false);
  fecharFolhas();
  $('cortina').hidden = false;
  $(id).hidden = false;
}

function fecharFolhas() {
  $('cortina').hidden = true;
  for (const id of ['folhaExames', 'folhaAjustes', 'folhaSeries']) $(id).hidden = true;
}

function ligarControles() {
  $('ctrlJanelaCentro').addEventListener('input', (e) => {
    estado.janela.centro = +e.target.value; aoMudarJanela();
  });
  $('ctrlJanelaLargura').addEventListener('input', (e) => {
    estado.janela.largura = +e.target.value; aoMudarJanela();
  });
  $('ctrlPaleta').addEventListener('change', (e) => {
    estado.paleta = e.target.value; redesenhar();
  });
  $('modos3d').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $('modos3d').querySelectorAll('button').forEach((x) => x.classList.remove('ativo'));
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
  $('ctrlCorte3d').addEventListener('input', (e) => {
    render3d.corte = e.target.value / 100;
    $('valCorte3d').textContent = `${e.target.value}%`;
    agendar3d();
  });
}

// ---------------------------------------------------------------------------
async function abrirLocais(fileList) {
  if (!fileList || !fileList.length) return;
  const requisicao = novaCarga();
  fecharFolhas();
  await comProgresso(async (p) => {
    const series = await carregarArquivosLocais(fileList, p);
    if (!requisicao.atual()) return;
    if (!series.length) throw new Error('Nenhuma série de tomografia (CT) legível foi encontrada.');
    if (series.length === 1) {
      abrirSerieLocal(series[0], p);
      return;
    }
    escolherSerie(series);
  }, requisicao.id);
}

function abrirSerieLocal(serie, p) {
  const a = serie.arquivos[0];
  const carga = planoDeCarga({
    rows: a.linhas, columns: a.colunas,
    files: serie.arquivos.length === 1 ? a.quadros : serie.arquivos.length, bytes: 0,
  }, perfil);
  document.querySelectorAll('.cartao').forEach((c) => c.classList.remove('ativo'));
  aplicarVolume(montarVolume(serie.arquivos, p, {
    reducaoPlano: carga.reducaoPlano, passoFatia: carga.passoFatia,
  }), null, carga);
}

function escolherSerie(series) {
  const cont = $('listaSeries');
  cont.replaceChildren();
  for (const s of series) {
    const a = s.arquivos[0];
    const quantidade = s.arquivos.length === 1 ? a.quadros : s.arquivos.length;
    const b = criarOpcaoSerie(
      a.texto('0008103E') || a.texto('00080060') || 'Série',
      `${a.texto('00080060')} · ${quantidade} imagens · ${a.colunas}×${a.linhas}`, true);
    b.addEventListener('click', async () => {
      fecharFolhas();
      const requisicao = novaCarga();
      await comProgresso(async (pp) => {
        if (requisicao.atual()) abrirSerieLocal(s, pp);
      }, requisicao.id);
    });
    cont.append(b);
  }
  abrirFolha('folhaSeries');
}

async function comProgresso(tarefa, cargaId = sequenciaCarga) {
  const caixa = $('carregando');
  caixa.hidden = false;
  $('barraProgresso').style.width = '0%';
  $('textoProgresso').textContent = 'Carregando…';
  const p = (msg, frac) => {
    $('textoProgresso').textContent = msg;
    $('barraProgresso').style.width = `${Math.round((frac || 0) * 100)}%`;
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
instalarPonteSimulador(aplicarVolume, fecharFolhas);

// Exposto para inspeção no console do navegador e para os testes.
window.leitorDicom = { estado, viewports, get render3d() { return render3d; },
  get perfil() { return perfil; }, marcarPerfil, abrirExame, aplicarVolume, dimensionar };
