/**
 * Ponte same-origin entre o Simulador TC e o motor do Leitor-Dicon.
 *
 * O simulador envia um volume canônico LPS em Int16. A validação rígida
 * abaixo impede que mensagens externas ou buffers inconsistentes sejam
 * usados para alocar volumes arbitrários dentro do leitor incorporado.
 */

import { Volume } from './volume.js?v=20260907ao';

const TIPO_ENTRADA = 'ct-simulator:volume';
const TIPO_SAUDACAO = 'ct-simulator:hello';
const MAX_VOXELS = 64 * 1024 * 1024;

function triplaInteira(valor, nome) {
  if (!Array.isArray(valor) || valor.length !== 3) throw new Error(`${nome} inválido.`);
  const saida = valor.map(Number);
  if (saida.some((n) => !Number.isInteger(n) || n < 2 || n > 4096)) {
    throw new Error(`${nome} fora dos limites aceitos.`);
  }
  return saida;
}

function triplaPositiva(valor, nome) {
  if (!Array.isArray(valor) || valor.length !== 3) throw new Error(`${nome} inválido.`);
  const saida = valor.map(Number);
  if (saida.some((n) => !Number.isFinite(n) || n <= 0 || n > 100)) {
    throw new Error(`${nome} fora dos limites aceitos.`);
  }
  return saida;
}

function triplaFinita(valor, nome) {
  if (!Array.isArray(valor) || valor.length !== 3) throw new Error(`${nome} inválido.`);
  const saida = valor.map(Number);
  if (saida.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e6)) {
    throw new Error(`${nome} fora dos limites aceitos.`);
  }
  return saida;
}

function numero(valor, fallback, minimo, maximo) {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.max(minimo, Math.min(maximo, n)) : fallback;
}

function texto(valor, fallback = '') {
  return typeof valor === 'string' ? valor.slice(0, 300) : fallback;
}

function montarVolumeSimulado(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Volume ausente.');
  const dims = triplaInteira(payload.dims, 'Dimensões');
  const total = dims[0] * dims[1] * dims[2];
  if (!Number.isSafeInteger(total) || total > MAX_VOXELS) {
    throw new Error('O volume excede o limite de memória do ambiente educacional.');
  }
  if (!(payload.buffer instanceof ArrayBuffer) || payload.buffer.byteLength !== total * 2) {
    throw new Error('Buffer de pixels incompatível com as dimensões informadas.');
  }

  const espacamento = triplaPositiva(payload.espacamento, 'Espaçamento');
  const origem = triplaFinita(payload.origem, 'Origem');
  const minimo = Math.round(numero(payload.minimo, -1024, -32768, 32767));
  const maximo = Math.round(numero(payload.maximo, 3071, -32768, 32767));
  const centro = numero(payload.janela?.centro, 40, -32768, 32767);
  const largura = numero(payload.janela?.largura, 400, 1, 65535);

  return new Volume({
    dados: new Int16Array(payload.buffer),
    dims,
    espacamento,
    origem,
    minimo: Math.min(minimo, maximo),
    maximo: Math.max(minimo, maximo),
    janela: { centro, largura },
    modalidade: 'CT',
    descricaoSerie: texto(payload.descricaoSerie, 'Aquisição simulada'),
    descricaoEstudo: texto(payload.descricaoEstudo, 'Simulação educacional de TC'),
    fabricante: texto(payload.fabricante, 'Simulador TC Educacional'),
    idPaciente: texto(payload.idPaciente, 'SIMULADO'),
    sintaxe: texto(payload.sintaxe, 'Volume didático'),
    numFatias: dims[2],
    obliquo: false,
    espacamentoIrregular: false,
    descartados: 0,
    unidadeHU: true,
    inverterMonocromatico: false,
  });
}

export function instalarPonteSimulador(aplicar, depois = () => {}) {
  const incorporado = new URLSearchParams(location.search).get('embedded') === '1';
  if (!incorporado || window.parent === window) return;

  const responder = (mensagem) => window.parent.postMessage(mensagem, location.origin);

  // Handshake idempotente: o "pronto" emitido uma única vez se perdia quando
  // o pai ainda não tinha instalado o listener (postMessage não tem buffer).
  // Agora anunciamos repetidamente até o pai dar sinal de vida, e também
  // respondemos ao "hello" dele — qualquer um dos dois lados destrava.
  let anunciado = false;
  let tentativas = 0;
  let timer = null;
  const pararAnuncio = () => { if (timer) { clearInterval(timer); timer = null; } };
  const anunciar = () => {
    responder({ type: 'ct-dicom-viewer:ready' });
    if (timer || anunciado) return;
    timer = setInterval(() => {
      if (anunciado || tentativas >= 20) { pararAnuncio(); return; }
      tentativas++;
      responder({ type: 'ct-dicom-viewer:ready' });
    }, 250);
  };

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    if (!event.data) return;
    if (event.data.type === TIPO_SAUDACAO) { anunciado = true; pararAnuncio(); responder({ type: 'ct-dicom-viewer:ready' }); return; }
    if (event.data.type !== TIPO_ENTRADA) return;
    anunciado = true; pararAnuncio();
    try {
      const payload = event.data.payload;
      const volume = montarVolumeSimulado(payload);
      aplicar(volume, {
        label: texto(payload.label, 'Exame simulado'),
        notes: texto(payload.notes, 'Volume destinado exclusivamente ao treinamento.'),
        attribution: texto(payload.attribution, 'Simulador TC Educacional'),
      });
      depois();
      responder({ type: 'ct-dicom-viewer:volume-applied', dims: volume.dims });
    } catch (error) {
      console.error(error);
      responder({ type: 'ct-dicom-viewer:error', message: error.message || String(error) });
    }
  });

  anunciar();
}
