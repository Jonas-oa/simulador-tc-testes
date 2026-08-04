/**
 * Parser DICOM (PS3.10) sem dependências externas.
 *
 * Sintaxes de transferência suportadas:
 *   1.2.840.10008.1.2      Implicit VR Little Endian
 *   1.2.840.10008.1.2.1    Explicit VR Little Endian
 *   1.2.840.10008.1.2.2    Explicit VR Big Endian
 *   1.2.840.10008.1.2.5    RLE Lossless
 *
 * Sintaxes comprimidas (JPEG, JPEG-LS, JPEG 2000) são detectadas e reportadas
 * com uma mensagem clara em vez de produzirem lixo na tela.
 */

const VR_COM_TAMANHO_LONGO = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT']);

/** VR das tags que precisamos ler quando o arquivo usa Implicit VR. */
const DICIONARIO = {
  '00080008': 'CS', '00080016': 'UI', '00080018': 'UI', '00080060': 'CS',
  '00080070': 'LO', '00081030': 'LO', '0008103E': 'LO',
  '00100010': 'PN', '00100020': 'LO',
  '00180050': 'DS', '00180088': 'DS', '00181114': 'DS', '00181120': 'DS',
  '0020000D': 'UI', '0020000E': 'UI', '00200011': 'IS', '00200013': 'IS',
  '00200032': 'DS', '00200037': 'DS', '00201041': 'DS',
  '00280002': 'US', '00280004': 'CS', '00280006': 'US', '00280008': 'IS', '00280010': 'US',
  '00280011': 'US', '00280030': 'DS', '00280100': 'US', '00280101': 'US',
  '00280102': 'US', '00280103': 'US', '00280106': 'US', '00280107': 'US',
  '00281050': 'DS', '00281051': 'DS', '00281052': 'DS', '00281053': 'DS',
  '00289110': 'SQ', '52009229': 'SQ', '52009230': 'SQ',
  '7FE00010': 'OW',
};

export const TAG = {
  SOPClassUID: '00080016',
  Modality: '00080060',
  Manufacturer: '00080070',
  StudyDescription: '00081030',
  SeriesDescription: '0008103E',
  PatientName: '00100010',
  PatientID: '00100020',
  SliceThickness: '00180050',
  SpacingBetweenSlices: '00180088',
  StudyInstanceUID: '0020000D',
  SeriesInstanceUID: '0020000E',
  SeriesNumber: '00200011',
  InstanceNumber: '00200013',
  ImagePositionPatient: '00200032',
  ImageOrientationPatient: '00200037',
  SliceLocation: '00201041',
  SamplesPerPixel: '00280002',
  PhotometricInterpretation: '00280004',
  PlanarConfiguration: '00280006',
  NumberOfFrames: '00280008',
  Rows: '00280010',
  Columns: '00280011',
  PixelSpacing: '00280030',
  BitsAllocated: '00280100',
  BitsStored: '00280101',
  HighBit: '00280102',
  PixelRepresentation: '00280103',
  WindowCenter: '00281050',
  WindowWidth: '00281051',
  RescaleIntercept: '00281052',
  RescaleSlope: '00281053',
  PixelData: '7FE00010',
};

const SINTAXES = {
  '1.2.840.10008.1.2': { nome: 'Implicit VR Little Endian', explicit: false, bigEndian: false },
  '1.2.840.10008.1.2.1': { nome: 'Explicit VR Little Endian', explicit: true, bigEndian: false },
  '1.2.840.10008.1.2.2': { nome: 'Explicit VR Big Endian', explicit: true, bigEndian: true },
  '1.2.840.10008.1.2.5': { nome: 'RLE Lossless', explicit: true, bigEndian: false, encapsulado: 'rle' },
};

const SINTAXES_NAO_SUPORTADAS = {
  '1.2.840.10008.1.2.1.99': 'Deflated Explicit VR Little Endian',
  '1.2.840.10008.1.2.4.50': 'JPEG Baseline',
  '1.2.840.10008.1.2.4.51': 'JPEG Extended',
  '1.2.840.10008.1.2.4.57': 'JPEG Lossless',
  '1.2.840.10008.1.2.4.70': 'JPEG Lossless SV1',
  '1.2.840.10008.1.2.4.80': 'JPEG-LS Lossless',
  '1.2.840.10008.1.2.4.81': 'JPEG-LS Near-Lossless',
  '1.2.840.10008.1.2.4.90': 'JPEG 2000 Lossless',
  '1.2.840.10008.1.2.4.91': 'JPEG 2000',
};

function hexTag(grupo, elemento) {
  return (grupo.toString(16).padStart(4, '0') + elemento.toString(16).padStart(4, '0')).toUpperCase();
}

/**
 * Percorre um dataset e devolve um mapa tag -> {vr, offset, length}.
 * Sequências são percorridas apenas para serem puladas corretamente.
 */
function lerElementos(view, inicio, fim, explicit, bigEndian, saida) {
  let p = inicio;
  const le = !bigEndian;

  while (p + 8 <= fim) {
    const grupo = view.getUint16(p, le);
    const elemento = view.getUint16(p + 2, le);
    p += 4;

    // Delimitadores de item/sequência
    if (grupo === 0xfffe) {
      const len = view.getUint32(p, le);
      p += 4;
      if (elemento === 0xe000 && len !== 0xffffffff) p += len;
      continue;
    }

    let vr;
    let len;
    if (explicit) {
      vr = String.fromCharCode(view.getUint8(p), view.getUint8(p + 1));
      if (VR_COM_TAMANHO_LONGO.has(vr)) {
        len = view.getUint32(p + 4, le);
        p += 8;
      } else {
        len = view.getUint16(p + 2, le);
        p += 4;
      }
    } else {
      const tag = hexTag(grupo, elemento);
      vr = DICIONARIO[tag] || 'UN';
      len = view.getUint32(p, le);
      p += 4;
    }

    const tag = hexTag(grupo, elemento);

    // Sequência de tamanho indefinido: percorre os itens
    if (len === 0xffffffff) {
      if (vr === 'SQ' || (!explicit && vr === 'UN')) {
        p = pularSequenciaIndefinida(view, p, fim, explicit, bigEndian);
        continue;
      }
      // Pixel data encapsulado
      saida.set(tag, { vr, offset: p, length: -1, encapsulado: true });
      p = pularSequenciaIndefinida(view, p, fim, explicit, bigEndian);
      continue;
    }

    if (vr === 'SQ') {
      p += len;
      continue;
    }

    saida.set(tag, { vr, offset: p, length: len });
    p += len;
    if (len % 2 === 1) p += 1; // elementos têm tamanho par
  }
  return saida;
}

function pularSequenciaIndefinida(view, p, fim, explicit, bigEndian) {
  const le = !bigEndian;
  while (p + 8 <= fim) {
    const grupo = view.getUint16(p, le);
    const elemento = view.getUint16(p + 2, le);
    const len = view.getUint32(p + 4, le);
    p += 8;
    if (grupo === 0xfffe && elemento === 0xe0dd) return p;      // fim da sequência
    if (grupo === 0xfffe && elemento === 0xe000) {
      if (len === 0xffffffff) {
        p = pularItemIndefinido(view, p, fim, explicit, bigEndian);
      } else {
        p += len;
      }
      continue;
    }
    p += len === 0xffffffff ? 0 : len;
  }
  return fim;
}

function pularItemIndefinido(view, p, fim, explicit, bigEndian) {
  const le = !bigEndian;
  while (p + 8 <= fim) {
    const grupo = view.getUint16(p, le);
    const elemento = view.getUint16(p + 2, le);
    if (grupo === 0xfffe && elemento === 0xe00d) return p + 8;  // fim do item
    const salvo = p;
    p += 4;
    let len;
    if (explicit) {
      const vr = String.fromCharCode(view.getUint8(p), view.getUint8(p + 1));
      if (VR_COM_TAMANHO_LONGO.has(vr)) { len = view.getUint32(p + 4, le); p += 8; }
      else { len = view.getUint16(p + 2, le); p += 4; }
    } else {
      len = view.getUint32(p, le);
      p += 4;
    }
    if (len === 0xffffffff) { p = pularSequenciaIndefinida(view, p, fim, explicit, bigEndian); continue; }
    p += len;
    if (p <= salvo) return fim;
  }
  return fim;
}

/**
 * Localiza os fragmentos de um pixel data encapsulado.
 * O primeiro item é sempre a Basic Offset Table, não um quadro — ele é
 * devolvido separadamente para que `frags[0]` seja de fato o primeiro quadro.
 */
function lerFragmentos(view, p, fim, le) {
  const frags = [];
  while (p + 8 <= fim) {
    const grupo = view.getUint16(p, le);
    const elemento = view.getUint16(p + 2, le);
    const len = view.getUint32(p + 4, le);
    p += 8;
    if (grupo === 0xfffe && elemento === 0xe0dd) break;
    if (grupo !== 0xfffe || elemento !== 0xe000) break;
    frags.push({ offset: p, length: len });
    p += len;
  }
  return frags.slice(1);   // descarta a Basic Offset Table
}

/** Descompressão RLE (PS3.5 anexo G). */
function descomprimirRLE(buffer, offset, length, largura, altura, bytesPorAmostra, amostras) {
  const view = new DataView(buffer, offset, length);
  const numSegmentos = view.getUint32(0, true);
  const totalPixels = largura * altura;
  const saida = new Uint8Array(totalPixels * bytesPorAmostra * amostras);

  for (let s = 0; s < numSegmentos; s++) {
    const inicio = view.getUint32(4 + s * 4, true);
    const fim = s + 1 < numSegmentos ? view.getUint32(4 + (s + 1) * 4, true) : length;
    if (!inicio) continue;

    // O segmento s guarda o byte (bytesPorAmostra-1-s%bytes) da amostra s/bytes,
    // do mais significativo para o menos significativo.
    const amostra = Math.floor(s / bytesPorAmostra);
    const byteIdx = bytesPorAmostra - 1 - (s % bytesPorAmostra);
    let destino = amostra * bytesPorAmostra + byteIdx;
    const passo = bytesPorAmostra * amostras;

    let p = inicio;
    let escritos = 0;
    while (p < fim && escritos < totalPixels) {
      const n = view.getInt8(p++);
      if (n >= 0) {
        for (let i = 0; i <= n && p < fim && escritos < totalPixels; i++, escritos++) {
          saida[destino] = view.getUint8(p++);
          destino += passo;
        }
      } else if (n !== -128) {
        const valor = view.getUint8(p++);
        for (let i = 0; i < 1 - n && escritos < totalPixels; i++, escritos++) {
          saida[destino] = valor;
          destino += passo;
        }
      }
    }
  }
  return saida;
}

export class ArquivoDicom {
  constructor(buffer, nome = '') {
    this.buffer = buffer;
    this.nome = nome;
    this.view = new DataView(buffer);
    this.elementos = new Map();
    this._analisar();
  }

  _analisar() {
    const view = this.view;
    let p = 0;

    // Preâmbulo + "DICM"
    if (buffer_tem_magic(view, 128)) {
      p = 132;
    } else if (buffer_tem_magic(view, 0)) {
      p = 4;
    } else {
      p = 0; // dataset cru, sem meta — assume Implicit VR LE
      this.sintaxeUID = '1.2.840.10008.1.2';
    }

    if (p > 0) {
      // Grupo 0002 é sempre Explicit VR Little Endian
      const meta = new Map();
      // Descobre o tamanho do grupo meta (0002,0000)
      lerElementos(view, p, Math.min(view.byteLength, p + 4096), true, false, meta);
      const el = meta.get('00020010');
      this.sintaxeUID = el ? this._texto(el).trim() : '1.2.840.10008.1.2.1';
      const grupoLen = meta.get('00020000');
      if (grupoLen) {
        p = grupoLen.offset + grupoLen.length + view.getUint32(grupoLen.offset, true);
      } else {
        // fallback: procura o fim do grupo 0002
        let q = p;
        while (q + 8 <= view.byteLength && view.getUint16(q, true) === 0x0002) {
          const m = new Map();
          lerElementos(view, q, q + 8, true, false, m);
          const [only] = m.values();
          if (!only) break;
          q = only.offset + only.length;
        }
        p = q;
      }
      for (const [k, v] of meta) if (k.startsWith('0002')) this.elementos.set(k, v);
    }

    const info = SINTAXES[this.sintaxeUID];
    this.sintaxeNome = info ? info.nome
      : (SINTAXES_NAO_SUPORTADAS[this.sintaxeUID] || this.sintaxeUID);
    this.suportado = !!info;
    this.encapsulado = info ? info.encapsulado : null;

    if (!info) {
      // ainda assim lê os cabeçalhos: são Explicit VR LE em todas as
      // sintaxes comprimidas, o que permite descrever o arquivo ao usuário.
      lerElementos(view, p, view.byteLength, true, false, this.elementos);
      return;
    }
    lerElementos(view, p, view.byteLength, info.explicit, info.bigEndian, this.elementos);
    this.bigEndian = info.bigEndian;
  }

  _texto(el) {
    if (!el || el.length <= 0) return '';
    const bytes = new Uint8Array(this.buffer, el.offset, el.length);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s.replace(/\0+$/, '');
  }

  /** Valor textual de uma tag. */
  texto(tag) {
    const el = this.elementos.get(tag);
    if (!el) return '';
    if (el.vr === 'US') return String(this.view.getUint16(el.offset, !this.bigEndian));
    if (el.vr === 'UL') return String(this.view.getUint32(el.offset, !this.bigEndian));
    return this._texto(el).trim();
  }

  /** Primeiro número de uma tag (aceita valores múltiplos "a\b\c"). */
  numero(tag, padrao = null) {
    const v = this.numeros(tag);
    return v.length ? v[0] : padrao;
  }

  /** Todos os números de uma tag. */
  numeros(tag) {
    const el = this.elementos.get(tag);
    if (!el) return [];
    const le = !this.bigEndian;
    switch (el.vr) {
      case 'US': {
        const n = el.length / 2, out = [];
        for (let i = 0; i < n; i++) out.push(this.view.getUint16(el.offset + i * 2, le));
        return out;
      }
      case 'SS': {
        const n = el.length / 2, out = [];
        for (let i = 0; i < n; i++) out.push(this.view.getInt16(el.offset + i * 2, le));
        return out;
      }
      case 'UL': {
        const n = el.length / 4, out = [];
        for (let i = 0; i < n; i++) out.push(this.view.getUint32(el.offset + i * 4, le));
        return out;
      }
      case 'SL': {
        const n = el.length / 4, out = [];
        for (let i = 0; i < n; i++) out.push(this.view.getInt32(el.offset + i * 4, le));
        return out;
      }
      case 'FL': {
        const n = el.length / 4, out = [];
        for (let i = 0; i < n; i++) out.push(this.view.getFloat32(el.offset + i * 4, le));
        return out;
      }
      case 'FD': {
        const n = el.length / 8, out = [];
        for (let i = 0; i < n; i++) out.push(this.view.getFloat64(el.offset + i * 8, le));
        return out;
      }
      default:
        return this._texto(el).split('\\')
          .map((s) => parseFloat(s))
          .filter((x) => Number.isFinite(x));
    }
  }

  get linhas() { return this.numero(TAG.Rows, 0); }
  get colunas() { return this.numero(TAG.Columns, 0); }
  get quadros() { return this.numero(TAG.NumberOfFrames, 1) || 1; }

  /**
   * Pixels do quadro, já convertidos para Int16 e com rescale aplicado
   * (unidades reais: HU para TC).
   */
  pixels(quadro = 0) {
    if (!this.suportado) {
      throw new Error(`Sintaxe de transferência não suportada: ${this.sintaxeNome}`);
    }
    const el = this.elementos.get(TAG.PixelData);
    if (!el) throw new Error('Arquivo sem Pixel Data (7FE0,0010)');

    const largura = this.colunas;
    const altura = this.linhas;
    const total = largura * altura;
    const bitsAlocados = this.numero(TAG.BitsAllocated, 16);
    const bitsArmazenados = this.numero(TAG.BitsStored, bitsAlocados);
    const bitAlto = this.numero(TAG.HighBit, bitsArmazenados - 1);
    const assinado = this.numero(TAG.PixelRepresentation, 0) === 1;
    const amostras = this.numero(TAG.SamplesPerPixel, 1);
    const planar = this.numero(TAG.PlanarConfiguration, 0);
    const bytesPorAmostra = Math.ceil(bitsAlocados / 8);
    const le = !this.bigEndian;

    if (![8, 16, 32].includes(bitsAlocados)) {
      throw new Error(`Bits Allocated não suportado: ${bitsAlocados}`);
    }
    if (quadro < 0 || quadro >= this.quadros) {
      throw new Error(`Quadro ${quadro + 1} fora do intervalo (1–${this.quadros})`);
    }

    let bruto; // acesso por índice de amostra
    if (el.encapsulado) {
      const frags = lerFragmentos(this.view, el.offset, this.buffer.byteLength, le);
      const frag = frags[Math.min(quadro, frags.length - 1)];
      if (!frag) throw new Error('Pixel data encapsulado sem fragmentos');
      if (this.encapsulado !== 'rle') {
        throw new Error(`Sintaxe comprimida não suportada: ${this.sintaxeNome}`);
      }
      const bytes = descomprimirRLE(this.buffer, frag.offset, frag.length,
        largura, altura, bytesPorAmostra, amostras);
      bruto = new DataView(bytes.buffer);
      // A descompressão acima já intercala as amostras de cada pixel.
      return this._converter(bruto, 0, total, bitsAlocados, bitsArmazenados,
        bitAlto, assinado, amostras, true, 0);
    }

    const bytesQuadro = total * bytesPorAmostra * amostras;
    const offset = el.offset + quadro * bytesQuadro;
    return this._converter(this.view, offset, total, bitsAlocados, bitsArmazenados,
      bitAlto, assinado, amostras, le, planar);
  }

  /**
   * `true` quando o intervalo possível ou o rescale não cabem sem perda em
   * Int16. TC convencional continua em Int16 para não dobrar o uso de memória;
   * aquisições quantitativas ou fora dessa faixa usam Float32.
   */
  get requerFloat() {
    const inclinacao = this.numero(TAG.RescaleSlope, 1) ?? 1;
    const intercepto = this.numero(TAG.RescaleIntercept, 0) ?? 0;
    const bits = Math.max(1, Math.min(32,
      this.numero(TAG.BitsStored, this.numero(TAG.BitsAllocated, 16))));
    const assinado = this.numero(TAG.PixelRepresentation, 0) === 1;
    const minimoBruto = assinado ? -(2 ** (bits - 1)) : 0;
    const maximoBruto = assinado ? 2 ** (bits - 1) - 1 : 2 ** bits - 1;
    const extremos = [minimoBruto * inclinacao + intercepto,
      maximoBruto * inclinacao + intercepto];
    return !Number.isInteger(inclinacao) || !Number.isInteger(intercepto)
      || Math.min(...extremos) < -32768 || Math.max(...extremos) > 32767;
  }

  _converter(view, offset, total, bitsAlocados, bitsArmazenados, bitAlto,
    assinado, amostras, le, planar) {
    const saida = this.requerFloat ? new Float32Array(total) : new Int16Array(total);
    const inclinacao = this.numero(TAG.RescaleSlope, 1) ?? 1;
    const intercepto = this.numero(TAG.RescaleIntercept, 0) ?? 0;
    const bits = Math.max(1, Math.min(bitsAlocados, bitsArmazenados));
    const deslocamento = Math.max(0, bitAlto - bits + 1);
    const modulo = 2 ** bits;
    const limiteSinal = modulo / 2;
    const bytesPorAmostra = bitsAlocados / 8;

    const lerAmostra = (indice) => {
      const o = offset + indice * bytesPorAmostra;
      let bruto;
      if (bitsAlocados === 8) bruto = view.getUint8(o);
      else if (bitsAlocados === 16) bruto = view.getUint16(o, le);
      else bruto = view.getUint32(o, le);

      let v = Math.floor(bruto / (2 ** deslocamento)) % modulo;
      if (assinado && v >= limiteSinal) v -= modulo;
      return v;
    };

    for (let i = 0; i < total; i++) {
      let v;
      if (amostras >= 3) {
        const indice = (canal) => planar === 1 ? canal * total + i : i * amostras + canal;
        v = lerAmostra(indice(0)) * 0.299 + lerAmostra(indice(1)) * 0.587
          + lerAmostra(indice(2)) * 0.114;
      } else {
        v = lerAmostra(i);
      }
      v = v * inclinacao + intercepto;
      saida[i] = saida instanceof Int16Array ? Math.round(v) : v;
    }
    return saida;
  }

  /** Metadados usados na montagem do volume. */
  geometria() {
    const iop = this.numeros(TAG.ImageOrientationPatient);
    const ipp = this.numeros(TAG.ImagePositionPatient);
    const ps = this.numeros(TAG.PixelSpacing);
    return {
      orientacao: iop.length === 6 ? iop : [1, 0, 0, 0, 1, 0],
      posicao: ipp.length === 3 ? ipp : [0, 0, 0],
      espacamentoPixel: ps.length === 2 ? ps : [1, 1],
      espessura: this.numero(TAG.SliceThickness, null),
      espacamentoCortes: this.numero(TAG.SpacingBetweenSlices, null),
      localizacao: this.numero(TAG.SliceLocation, null),
      instancia: this.numero(TAG.InstanceNumber, null),
      temOrientacao: iop.length === 6,
      temPosicao: ipp.length === 3,
    };
  }
}

function buffer_tem_magic(view, offset) {
  if (view.byteLength < offset + 4) return false;
  return view.getUint8(offset) === 0x44 && view.getUint8(offset + 1) === 0x49
    && view.getUint8(offset + 2) === 0x43 && view.getUint8(offset + 3) === 0x4d;
}

export { SINTAXES_NAO_SUPORTADAS };
