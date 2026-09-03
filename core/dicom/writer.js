/**
 * core/dicom/writer.js
 * Escrita de arquivos DICOM Part 10 (CT Image Storage).
 *
 * O que a auditoria encontrou na saída anterior: um objeto improvisado, com
 * `origem: [0,0,0]`, `idPaciente: "SIMULADO"`, espaçamento errado por fator 2
 * (B-04) e "HU" que cobriam −160..+223 declarados como verdadeiros (B-05).
 * Nada disso abriria num visualizador DICOM de verdade — nem deveria.
 *
 * Aqui o exame sai como DICOM conformante: UIDs próprios no ramo 2.25,
 * geometria coerente entre cortes, Rescale correto e os parâmetros técnicos
 * que geraram a imagem (KVP, corrente, pitch, colimação, kernel, CTDIvol),
 * que é o que permite auditar depois o que foi feito.
 *
 * Transfer Syntax: Explicit VR Little Endian (1.2.840.10008.1.2.1) — sem
 * compressão. É a mais interoperável e mantém o escritor simples.
 *
 * SEM dependência de DOM. Script clássico.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};

  var SOP_CLASS_CT = "1.2.840.10008.5.1.4.1.1.2";      // CT Image Storage
  var TS_EXPLICITO_LE = "1.2.840.10008.1.2.1";
  var IMPL_UID = "2.25.1234567890";                     // raiz desta plataforma
  var IMPL_NOME = "SIMULADOR_TC_EDU";

  // ---- montagem de bytes ------------------------------------------------
  function Escritor() { this.partes = []; this.tamanho = 0; }
  Escritor.prototype.push = function (u8) { this.partes.push(u8); this.tamanho += u8.length; };
  Escritor.prototype.finalizar = function () {
    var out = new Uint8Array(this.tamanho), o = 0;
    for (var i = 0; i < this.partes.length; i++) { out.set(this.partes[i], o); o += this.partes[i].length; }
    return out;
  };

  function u16(v) { var b = new Uint8Array(2); b[0] = v & 255; b[1] = (v >> 8) & 255; return b; }
  function u32(v) {
    var b = new Uint8Array(4);
    b[0] = v & 255; b[1] = (v >> 8) & 255; b[2] = (v >> 16) & 255; b[3] = (v >>> 24) & 255;
    return b;
  }
  function ascii(s) {
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
    return b;
  }
  /** Valores DICOM têm comprimento PAR: preenche com espaço, ou NUL em UI. */
  function padronizar(s, vr) {
    if (s.length % 2 === 0) return s;
    return s + (vr === "UI" ? "\0" : " ");
  }

  var VR_COM_RESERVA = ["OB", "OW", "OF", "SQ", "UT", "UN"];

  /**
   * Um elemento em Explicit VR Little Endian.
   * VRs curtos: tag(4) + VR(2) + comprimento(2)
   * VRs longos: tag(4) + VR(2) + reservado(2) + comprimento(4)
   */
  function elemento(grupo, elem, vr, valorBytes) {
    var e = new Escritor();
    e.push(u16(grupo)); e.push(u16(elem)); e.push(ascii(vr));
    if (VR_COM_RESERVA.indexOf(vr) >= 0) {
      e.push(u16(0)); e.push(u32(valorBytes.length));
    } else {
      e.push(u16(valorBytes.length));
    }
    e.push(valorBytes);
    return e.finalizar();
  }

  function elTexto(grupo, elem, vr, texto) {
    return elemento(grupo, elem, vr, ascii(padronizar(String(texto == null ? "" : texto), vr)));
  }
  function elUS(grupo, elem, v) { return elemento(grupo, elem, "US", u16(v)); }
  function elIS(grupo, elem, v) { return elTexto(grupo, elem, "IS", String(Math.round(v))); }
  function elDS(grupo, elem, v) {
    var s = Array.isArray(v) ? v.map(formatarDS).join("\\") : formatarDS(v);
    return elTexto(grupo, elem, "DS", s);
  }
  function formatarDS(n) {
    if (n == null || !isFinite(n)) return "";
    var s = Number(n).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    return s.length > 16 ? Number(n).toPrecision(10) : s;
  }

  function dataDICOM(d) {
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }
  function horaDICOM(d) {
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  var KERNEL_DICOM = { liso: "SOFT", padrao: "STANDARD", nitido: "BONE" };

  /**
   * Gera UM arquivo DICOM de um corte.
   *
   * @param {object} o
   * @param {Int16Array} o.pixels     HU do corte (n×n)
   * @param {number} o.n              matriz
   * @param {number} o.pixelMm
   * @param {number[]} o.posicaoPaciente  ImagePositionPatient [x,y,z] em mm
   * @param {number} o.espessuraMm
   * @param {number} o.espacamentoZMm
   * @param {number} o.instancia      InstanceNumber (1-based)
   * @param {object} o.paciente       { nome, id, nascimento, sexo }
   * @param {object} o.estudo         { studyUID, frameUID, data, descricao }
   * @param {object} o.serie          { seriesUID, numero, descricao, kernel }
   * @param {object} o.tecnica        { kv, mas, tempoRotacaoS, pitch, colimacaoMm, ctdivol }
   * @returns {Uint8Array}
   */
  function gerarCorte(o) {
    var agora = new Date();
    var sopUID = Core.model.novoUID();

    // ---- preâmbulo + meta (grupo 0002, sempre Explicit VR LE) ----
    var e = new Escritor();
    e.push(new Uint8Array(128));         // preâmbulo de 128 zeros
    e.push(ascii("DICM"));

    var meta = new Escritor();
    meta.push(elemento(0x0002, 0x0002, "UI", ascii(padronizar(SOP_CLASS_CT, "UI"))));
    meta.push(elemento(0x0002, 0x0003, "UI", ascii(padronizar(sopUID, "UI"))));
    meta.push(elemento(0x0002, 0x0010, "UI", ascii(padronizar(TS_EXPLICITO_LE, "UI"))));
    meta.push(elemento(0x0002, 0x0012, "UI", ascii(padronizar(IMPL_UID, "UI"))));
    meta.push(elemento(0x0002, 0x0013, "SH", ascii(padronizar(IMPL_NOME, "SH"))));
    var metaBytes = meta.finalizar();
    // (0002,0000) File Meta Information Group Length
    e.push(elemento(0x0002, 0x0000, "UL", u32(metaBytes.length)));
    e.push(metaBytes);

    // ---- conjunto de dados ----
    var d = new Escritor();
    var pac = o.paciente || {}, est = o.estudo || {}, ser = o.serie || {}, tec = o.tecnica || {};

    d.push(elTexto(0x0008, 0x0005, "CS", "ISO_IR 192"));        // UTF-8
    d.push(elTexto(0x0008, 0x0016, "UI", SOP_CLASS_CT));
    d.push(elTexto(0x0008, 0x0018, "UI", sopUID));
    d.push(elTexto(0x0008, 0x0020, "DA", est.data || dataDICOM(agora)));
    d.push(elTexto(0x0008, 0x0030, "TM", est.hora || horaDICOM(agora)));
    d.push(elTexto(0x0008, 0x0060, "CS", "CT"));
    d.push(elTexto(0x0008, 0x0070, "LO", "Simulador TC Educacional"));
    d.push(elTexto(0x0008, 0x1030, "LO", est.descricao || "Simulacao educacional de TC"));
    d.push(elTexto(0x0008, 0x103E, "LO", ser.descricao || "Serie"));

    d.push(elTexto(0x0010, 0x0010, "PN", pac.nome || "ANONIMO"));
    d.push(elTexto(0x0010, 0x0020, "LO", pac.id || "SIM"));
    d.push(elTexto(0x0010, 0x0030, "DA", pac.nascimento || ""));
    d.push(elTexto(0x0010, 0x0040, "CS", pac.sexo || ""));

    // Técnica: é o que permite auditar depois COMO a imagem foi feita.
    if (tec.kv != null) d.push(elDS(0x0018, 0x0060, tec.kv));                 // KVP
    d.push(elTexto(0x0018, 0x0050, "DS", formatarDS(o.espessuraMm)));         // SliceThickness
    if (o.espacamentoZMm != null) d.push(elDS(0x0018, 0x0088, o.espacamentoZMm)); // SpacingBetweenSlices
    if (tec.colimacaoMm != null) {
      d.push(elDS(0x0018, 0x9306, tec.colimacaoMm));                          // SingleCollimationWidth
      d.push(elDS(0x0018, 0x9307, tec.colimacaoMm));                          // TotalCollimationWidth
    }
    if (tec.tempoRotacaoS != null) d.push(elDS(0x0018, 0x1150, tec.tempoRotacaoS * 1000)); // ExposureTime (ms)
    if (tec.mas != null && tec.tempoRotacaoS) {
      d.push(elIS(0x0018, 0x1151, tec.mas / tec.tempoRotacaoS));              // XRayTubeCurrent (mA)
      d.push(elIS(0x0018, 0x1152, tec.mas));                                  // Exposure (mAs)
    }
    if (tec.pitch != null) d.push(elDS(0x0018, 0x9311, tec.pitch));           // SpiralPitchFactor
    d.push(elTexto(0x0018, 0x1210, "SH", KERNEL_DICOM[ser.kernel] || "STANDARD")); // ConvolutionKernel
    if (tec.ctdivol != null) d.push(elDS(0x0018, 0x9345, tec.ctdivol));       // CTDIvol

    d.push(elTexto(0x0020, 0x000D, "UI", est.studyUID));
    d.push(elTexto(0x0020, 0x000E, "UI", ser.seriesUID));
    d.push(elIS(0x0020, 0x0011, ser.numero || 1));                            // SeriesNumber
    d.push(elIS(0x0020, 0x0013, o.instancia));                                // InstanceNumber
    d.push(elDS(0x0020, 0x0032, o.posicaoPaciente));                          // ImagePositionPatient
    d.push(elDS(0x0020, 0x0037, [1, 0, 0, 0, 1, 0]));                         // ImageOrientationPatient
    d.push(elTexto(0x0020, 0x0052, "UI", est.frameUID));                      // FrameOfReferenceUID

    d.push(elUS(0x0028, 0x0002, 1));                                          // SamplesPerPixel
    d.push(elTexto(0x0028, 0x0004, "CS", "MONOCHROME2"));
    d.push(elUS(0x0028, 0x0010, o.n));                                        // Rows
    d.push(elUS(0x0028, 0x0011, o.n));                                        // Columns
    d.push(elDS(0x0028, 0x0030, [o.pixelMm, o.pixelMm]));                     // PixelSpacing
    d.push(elUS(0x0028, 0x0100, 16));                                         // BitsAllocated
    d.push(elUS(0x0028, 0x0101, 16));                                         // BitsStored
    d.push(elUS(0x0028, 0x0102, 15));                                         // HighBit
    d.push(elUS(0x0028, 0x0103, 1));                                          // PixelRepresentation: com sinal
    d.push(elDS(0x0028, 0x1050, o.janela ? o.janela.wl : 40));                // WindowCenter
    d.push(elDS(0x0028, 0x1051, o.janela ? o.janela.ww : 400));               // WindowWidth
    // Rescale: os pixels JÁ estão em HU, logo slope 1 e intercept 0.
    d.push(elDS(0x0028, 0x1052, 0));                                          // RescaleIntercept
    d.push(elDS(0x0028, 0x1053, 1));                                          // RescaleSlope
    d.push(elTexto(0x0028, 0x1054, "LO", "HU"));                              // RescaleType

    // PixelData: Int16 little-endian
    var px = new Uint8Array(o.pixels.buffer, o.pixels.byteOffset, o.pixels.length * 2);
    d.push(elemento(0x7FE0, 0x0010, "OW", px));

    e.push(d.finalizar());
    return e.finalizar();
  }

  /**
   * Gera todos os arquivos de uma série reconstruída.
   *
   * A geometria é a parte que a versão anterior errava: `ImagePositionPatient`
   * precisa AVANÇAR exatamente `SpacingBetweenSlices` entre cortes vizinhos,
   * senão o visualizador reconstrói o volume deformado ou recusa a série.
   *
   * @returns {Array<{nome:string, bytes:Uint8Array}>}
   */
  function gerarSerie(o) {
    var s = o.serie;
    var n = s.matriz;
    var seriesUID = Core.model.novoUID();
    var arquivos = [];
    var fovMetade = (s.fovMm || n * s.pixelMm) / 2;

    for (var i = 0; i < s.cortes; i++) {
      var pixels = s.hu.subarray(i * n * n, (i + 1) * n * n);
      var z = s.posicoesMm ? s.posicoesMm[i] : i * s.incrementoMm;
      arquivos.push({
        nome: "IM" + String(i + 1).padStart(5, "0") + ".dcm",
        bytes: gerarCorte({
          pixels: pixels, n: n, pixelMm: s.pixelMm,
          // Canto superior esquerdo do primeiro pixel, em coordenadas do
          // paciente. O avanço em z entre cortes é o incremento.
          posicaoPaciente: [-fovMetade, -fovMetade, z],
          espessuraMm: s.espessuraMm,
          espacamentoZMm: s.incrementoMm,
          instancia: i + 1,
          paciente: o.paciente, estudo: o.estudo,
          serie: {
            seriesUID: seriesUID, numero: o.numeroSerie || 1,
            descricao: s.nome, kernel: s.kernel
          },
          tecnica: o.tecnica,
          janela: o.janela
        })
      });
    }
    return { seriesUID: seriesUID, arquivos: arquivos };
  }

  Core.dicom = {
    gerarCorte: gerarCorte,
    gerarSerie: gerarSerie,
    SOP_CLASS_CT: SOP_CLASS_CT,
    TS_EXPLICITO_LE: TS_EXPLICITO_LE
  };

})(typeof self !== "undefined" ? self : this);
