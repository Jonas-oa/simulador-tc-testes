/**
 * core/phantom/volume.js
 * Fantoma volumétrico: um campo 3D de Hounsfield que o simulador varre.
 *
 * Substitui a pilha de PNG já janelados que servia de "imagem" até a Fase 2.
 * A diferença não é de qualidade visual, é de natureza: um PNG carrega 256
 * níveis de cinza dentro de uma janela fixa; a partir dele os HU originais são
 * IRRECUPERÁVEIS (B-05: a exportação cobria −160..+223 em vez de −1024..+3071,
 * e ainda assim declarava `unidadeHU: true`). Com HU reais:
 *
 *   • janelas de pulmão e osso passam a ter dado que as sustente (B-06);
 *   • medir HU numa ROI devolve o número certo;
 *   • a atenuação pode ser calculada, que é o que permite a Fase 4 fazer
 *     kV e mAs alterarem a imagem por física em vez de rótulo.
 *
 * REGRA DURA (lição do B-04): espaçamento e dimensões andam juntos. Ao
 * subamostrar por um fator f, o espaçamento é multiplicado por f. A extensão
 * física do volume é invariante, e `verificarEscala()` falha se mudar.
 *
 * SEM dependência de DOM — o módulo devolve arrays tipados, nunca canvas.
 * Script clássico, carrega em página e em Worker.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};

  var HU_AR = -1000;
  var HU_MIN = -1024;
  var HU_MAX = 3071;

  /**
   * @param {object} o
   * @param {Int16Array} o.dados      HU, ordem z,y,x
   * @param {number[]}   o.dims       [nx, ny, nz]
   * @param {number[]}   o.spacingMm  [sx, sy, sz]
   * @param {number[]}   [o.originMm] canto do voxel [0,0,0]
   */
  function Volume(o) {
    if (!o || !o.dados || !o.dims || !o.spacingMm) throw new Error("Volume: dados, dims e spacingMm são obrigatórios");
    this.dados = o.dados;
    this.dims = o.dims.slice();
    this.spacingMm = o.spacingMm.slice();
    this.originMm = (o.originMm || [0, 0, 0]).slice();
    this.id = o.id || "volume";
    this.rotulo = o.rotulo || this.id;
    this.fonte = o.fonte || null;
    this.janelaPadrao = o.janelaPadrao || { wl: 40, ww: 400 };

    var esperado = this.dims[0] * this.dims[1] * this.dims[2];
    if (this.dados.length !== esperado) {
      throw new Error("Volume: " + this.dados.length + " voxels para dims " +
        this.dims.join("×") + " (esperado " + esperado + ")");
    }
    this._nxy = this.dims[0] * this.dims[1];
  }

  /** HU por índice de voxel. Fora dos limites devolve ar. */
  Volume.prototype.huAt = function (ix, iy, iz) {
    var nx = this.dims[0], ny = this.dims[1], nz = this.dims[2];
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return HU_AR;
    return this.dados[iz * this._nxy + iy * nx + ix];
  };

  /** Extensão física em mm — o invariante que a subamostragem não pode mudar. */
  Volume.prototype.extentMm = function () {
    return [
      this.dims[0] * this.spacingMm[0],
      this.dims[1] * this.spacingMm[1],
      this.dims[2] * this.spacingMm[2]
    ];
  };

  Volume.prototype.bounds = function () {
    var e = this.extentMm(), o = this.originMm;
    return { min: o.slice(), max: [o[0] + e[0], o[1] + e[1], o[2] + e[2]] };
  };

  /**
   * HU numa posição física (mm, no referencial do volume), com interpolação
   * trilinear. É o que a Fase 4 usa para integrar atenuação ao longo do raio:
   * amostrar por voxel produziria degraus onde deveria haver gradiente.
   */
  Volume.prototype.sampleMm = function (x, y, z) {
    var s = this.spacingMm, o = this.originMm;
    var fx = (x - o[0]) / s[0] - 0.5;
    var fy = (y - o[1]) / s[1] - 0.5;
    var fz = (z - o[2]) / s[2] - 0.5;

    var x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
    var tx = fx - x0, ty = fy - y0, tz = fz - z0;

    var c000 = this.huAt(x0, y0, z0),     c100 = this.huAt(x0 + 1, y0, z0);
    var c010 = this.huAt(x0, y0 + 1, z0), c110 = this.huAt(x0 + 1, y0 + 1, z0);
    var c001 = this.huAt(x0, y0, z0 + 1),     c101 = this.huAt(x0 + 1, y0, z0 + 1);
    var c011 = this.huAt(x0, y0 + 1, z0 + 1), c111 = this.huAt(x0 + 1, y0 + 1, z0 + 1);

    var c00 = c000 + (c100 - c000) * tx, c01 = c001 + (c101 - c001) * tx;
    var c10 = c010 + (c110 - c010) * tx, c11 = c011 + (c111 - c011) * tx;
    var c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
    return c0 + (c1 - c0) * tz;
  };

  /**
   * Coeficiente de atenuação linear relativo à água.
   *   mu = mu_agua × (1 + HU/1000)      [definição de HU]
   * Devolve mu/mu_agua; a dependência de energia (kV) entra na Fase 4.
   */
  Volume.prototype.muRelativo = function (hu) {
    return Math.max(0, 1 + hu / 1000);
  };

  /**
   * Aplica janela e devolve tons de cinza 0..255.
   * Mesma convenção do DICOM (PS3.3 C.11.2.1.2): o valor no centro da janela
   * vira 128; a largura define o contraste.
   */
  function lutJanela(wl, ww) {
    ww = Math.max(1, ww);
    var baixo = wl - 0.5 - (ww - 1) / 2;
    var escala = 255 / (ww - 1);
    var lut = new Uint8ClampedArray(HU_MAX - HU_MIN + 1);
    for (var i = 0; i < lut.length; i++) {
      var v = (i + HU_MIN - baixo) * escala;
      lut[i] = v <= 0 ? 0 : v >= 255 ? 255 : v;
    }
    return lut;
  }

  function aplicarLut(lut, hu) {
    var i = Math.round(hu) - HU_MIN;
    if (i < 0) i = 0; else if (i >= lut.length) i = lut.length - 1;
    return lut[i];
  }

  /**
   * Corte axial em tons de cinza. Devolve { w, h, cinza } — sem canvas, para
   * que o núcleo permaneça utilizável em Worker.
   */
  Volume.prototype.fatiaAxial = function (iz, janela) {
    var j = janela || this.janelaPadrao;
    var lut = lutJanela(j.wl, j.ww);
    var nx = this.dims[0], ny = this.dims[1];
    iz = Math.max(0, Math.min(this.dims[2] - 1, Math.round(iz)));
    var saida = new Uint8ClampedArray(nx * ny);
    var base = iz * this._nxy;
    for (var i = 0; i < nx * ny; i++) saida[i] = aplicarLut(lut, this.dados[base + i]);
    return { w: nx, h: ny, cinza: saida };
  };

  /**
   * SCOUT (topograma) por projeção real, não por imagem pré-pronta.
   *
   * No equipamento, o scout é uma radiografia: o tubo fica parado numa
   * angulação e a mesa translada o paciente pelo feixe. O que se forma é a
   * INTEGRAL da atenuação ao longo de cada raio — um DRR. Aqui é isso:
   * soma-se mu ao longo do eixo de projeção e aplica-se Beer-Lambert.
   *
   * @param {string} orientacao "lateral" (projeta em x) ou "frontal" (em y)
   * @returns {{w:number,h:number,cinza:Uint8ClampedArray,mmPorPixel:number[]}}
   *          eixo horizontal = crânio-caudal; vertical = o eixo restante.
   */
  Volume.prototype.scout = function (orientacao) {
    var nx = this.dims[0], ny = this.dims[1], nz = this.dims[2];
    var sx = this.spacingMm[0], sy = this.spacingMm[1], sz = this.spacingMm[2];
    var lateral = orientacao !== "frontal";

    // Largura = eixo crânio-caudal (z). Altura = y (lateral) ou x (frontal).
    var w = nz;
    var h = lateral ? ny : nx;
    var passoMm = lateral ? sx : sy;   // espessura de cada amostra no raio
    var nRaio = lateral ? nx : ny;

    var soma = new Float32Array(w * h);
    var maxSoma = 0;

    for (var iz = 0; iz < nz; iz++) {
      var base = iz * this._nxy;
      for (var k = 0; k < h; k++) {
        var acc = 0;
        for (var t = 0; t < nRaio; t++) {
          var hu = lateral
            ? this.dados[base + k * nx + t]     // varre x, fixa y=k
            : this.dados[base + t * nx + k];    // varre y, fixa x=k
          acc += Math.max(0, 1 + hu / 1000);
        }
        acc *= passoMm * 0.001;                 // integral de mu (unidade arbitrária)
        var idx = k * w + iz;
        soma[idx] = acc;
        if (acc > maxSoma) maxSoma = acc;
      }
    }

    // Beer-Lambert: I/I0 = exp(-∫mu). Mais atenuação -> mais claro na imagem,
    // como num topograma (convenção radiográfica invertida).
    var cinza = new Uint8ClampedArray(w * h);
    var escala = maxSoma > 0 ? (3.2 / maxSoma) : 1;
    for (var i = 0; i < cinza.length; i++) {
      var trans = Math.exp(-soma[i] * escala);
      cinza[i] = Math.round(255 * (1 - trans));
    }
    return { w: w, h: h, cinza: cinza, mmPorPixel: [sz, lateral ? sy : sx] };
  };

  /**
   * LIMITES ANATÔMICOS no scout, em fração da imagem (0..1).
   *
   * Corrige B-21: as zonas que validavam a faixa planejada eram constantes
   * calibradas para o crânio ("leve o limite inferior até a base do crânio").
   * Num exame de tórax o sistema recusava faixas perfeitamente válidas com
   * essa mensagem. Aqui os limites saem do PRÓPRIO volume — onde o paciente
   * de fato está —, então valem para qualquer região do acervo.
   *
   * @param {string} orientacao "lateral" | "frontal"
   * @param {number} [limiarHU=-500]
   * @returns {{cc:[number,number], perp:[number,number]}} frações da imagem
   */
  /**
   * Menor intervalo de indices que contem `fracao` da massa do histograma.
   *
   * Existe porque MIN/MAX e um estimador fragil: um punhado de voxels soltos
   * decide a resposta inteira. Medido no cranio do acervo: entre -500 e -300 HU
   * ha 298 voxels de RUIDO (ar ruidoso chega a -400), e eles esticavam a caixa
   * de 150 para 183 mm em x e de 199 para 226 mm em y. Com isso, o validador
   * recusava o proprio protocolo de cranio de referencia — que e travado, de
   * modo que o operador nao tinha nem como corrigir.
   *
   * Aparar 0,25% de cada ponta descarta o ruido e nao toca na anatomia: num
   * corte de cabeca sao ~11 mil voxels ocupados, entao 0,25% sao 27 — menos do
   * que o ruido, e nada perto de qualquer estrutura de verdade.
   */
  function faixaRobusta(cont, total, fracao) {
    var apararCada = Math.floor(total * (1 - fracao) / 2);
    var i, acc = 0, ini = 0, fim = cont.length - 1;
    for (i = 0; i < cont.length; i++) {
      acc += cont[i];
      if (acc > apararCada) { ini = i; break; }
    }
    acc = 0;
    for (i = cont.length - 1; i >= 0; i--) {
      acc += cont[i];
      if (acc > apararCada) { fim = i; break; }
    }
    if (fim < ini) { ini = 0; fim = cont.length - 1; }
    return [ini, fim];
  }

  Volume.prototype.limitesAnatomicos = function (orientacao, limiarHU) {
    var lim = limiarHU == null ? -500 : limiarHU;
    var nx = this.dims[0], ny = this.dims[1], nz = this.dims[2];
    var lateral = orientacao !== "frontal";
    var perpN = lateral ? ny : nx;

    // Quantos voxels de tecido ha em cada indice de cada eixo. Contar, e nao
    // so marcar o primeiro e o ultimo, e o que permite aparar o ruido depois.
    //
    // O limiar continua em -500 HU de proposito: no TORAX o pulmao mora entre
    // -850 e -700, e subir o limiar para fugir do ruido apagaria o pulmao do
    // mapa. Quem trata o ruido e a apara, nao o limiar.
    var contZ = new Float64Array(nz);
    var contP = new Float64Array(perpN);
    var total = 0;

    for (var z = 0; z < nz; z++) {
      var base = z * this._nxy;
      for (var y = 0; y < ny; y++) {
        for (var x = 0; x < nx; x++) {
          if (this.dados[base + y * nx + x] <= lim) continue;
          contZ[z]++;
          contP[lateral ? y : x]++;
          total++;
        }
      }
    }

    if (!total) return { cc: [0, 1], perp: [0, 1] };

    var fz = faixaRobusta(contZ, total, 0.995);
    var fp = faixaRobusta(contP, total, 0.995);
    return {
      cc: [fz[0] / nz, (fz[1] + 1) / nz],
      perp: [fp[0] / perpN, (fp[1] + 1) / perpN]
    };
  };

  /**
   * Confere que dimensões e espaçamento continuam descrevendo a MESMA
   * extensão física. É a trava contra a regressão do B-04, em que o volume
   * era subamostrado 512→256 e o espaçamento permanecia 0,43 mm, entregando
   * um crânio de 110 mm de largura em vez de 220.
   */
  Volume.prototype.verificarEscala = function (extentEsperadoMm, tolMm) {
    var e = this.extentMm();
    var tol = tolMm == null ? 2 : tolMm;
    for (var i = 0; i < 3; i++) {
      if (Math.abs(e[i] - extentEsperadoMm[i]) > Math.max(tol, extentEsperadoMm[i] * 0.02)) {
        throw new Error("Escala do volume mudou no eixo " + "xyz"[i] + ": " +
          e[i].toFixed(1) + " mm, esperado " + extentEsperadoMm[i].toFixed(1) + " mm");
      }
    }
    return true;
  };

  /**
   * Subamostra por fator inteiro, CORRIGINDO o espaçamento. Existe para que
   * nenhum caminho do código possa reduzir a matriz sem ajustar a escala.
   */
  Volume.prototype.subamostrar = function (fator) {
    fator = Math.max(1, Math.round(fator));
    if (fator === 1) return this;
    var nx = this.dims[0], ny = this.dims[1], nz = this.dims[2];
    var mx = Math.floor(nx / fator), my = Math.floor(ny / fator), mz = nz;
    var saida = new Int16Array(mx * my * mz);
    var n2 = fator * fator;
    for (var z = 0; z < mz; z++) {
      var baseE = z * this._nxy, baseS = z * mx * my;
      for (var y = 0; y < my; y++) {
        for (var x = 0; x < mx; x++) {
          var acc = 0;
          for (var dy = 0; dy < fator; dy++) {
            var linha = baseE + (y * fator + dy) * nx + x * fator;
            for (var dx = 0; dx < fator; dx++) acc += this.dados[linha + dx];
          }
          saida[baseS + y * mx + x] = Math.round(acc / n2);
        }
      }
    }
    var v = new Volume({
      dados: saida,
      dims: [mx, my, mz],
      // A correção que o B-04 não fazia:
      spacingMm: [this.spacingMm[0] * fator, this.spacingMm[1] * fator, this.spacingMm[2]],
      originMm: this.originMm,
      id: this.id, rotulo: this.rotulo, fonte: this.fonte, janelaPadrao: this.janelaPadrao
    });
    v.verificarEscala(this.extentMm());
    return v;
  };

  Core.Volume = Volume;
  Core.lutJanela = lutJanela;
  Core.aplicarLut = aplicarLut;
  Core.HU = { AR: HU_AR, MIN: HU_MIN, MAX: HU_MAX };

})(typeof self !== "undefined" ? self : this);
