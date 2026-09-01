/**
 * core/acquisition/projector.js
 * Projeção direta (Radon) e retroprojeção filtrada (FBP).
 *
 * É o coração do que a auditoria mostrou não existir. Antes, "reconstruir"
 * relia os mesmos PNG (B-03) e nenhum parâmetro alterava a imagem (B-02).
 * Aqui há de fato o ciclo:
 *
 *     volume HU → μ(kV) → sinograma ideal → contagem de fótons com ruído
 *               → filtro → retroprojeção → imagem em HU
 *
 * e por consequência mAs, kV, pitch, espessura, FOV, matriz e kernel passam a
 * agir sobre a imagem por FÍSICA, não por rótulo.
 *
 * SIMPLIFICAÇÃO DECLARADA: geometria de FEIXE PARALELO, não leque nem cone.
 * Um tomógrafo real é fan/cone-beam com rebinning. O feixe paralelo preserva
 * todas as relações que a plataforma ensina (ruído × dose, kernel × nitidez,
 * FOV/matriz × tamanho do pixel) e evita uma camada de geometria que não muda
 * nenhuma dessas lições. Artefatos específicos de geometria de leque — cone
 * beam, por exemplo — não são reproduzidos.
 *
 * SEM dependência de DOM. Script clássico.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};

  // ---------------------------------------------------------------------
  // FFT radix-2 in-place, para o filtro rampa no domínio da frequência
  // ---------------------------------------------------------------------
  function fft(re, im, inverso) {
    var n = re.length, i, j, k;
    for (i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = (inverso ? 2 : -2) * Math.PI / len;
      var wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < len / 2; k++) {
          var ur = re[i + k], ui = im[i + k];
          var vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          var vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          var ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
    if (inverso) for (i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  function proximaPotencia2(n) { var p = 1; while (p < n) p <<= 1; return p; }

  /**
   * Janelas do filtro rampa. São os KERNELS que o operador escolhe:
   *   ramlak  — rampa pura: máxima resolução espacial, máximo ruído  → "osso"
   *   shepp   — rampa × sinc: equilíbrio                             → "padrão"
   *   hann    — rampa × cosseno elevado: suave, menos ruído          → "partes moles"
   * É a mesma troca que o kernel de um tomógrafo real oferece.
   */
  var JANELAS = {
    ramlak: function () { return 1; },
    shepp: function (f) { return f === 0 ? 1 : Math.sin(Math.PI * f / 2) / (Math.PI * f / 2); },
    hann: function (f) { return 0.5 * (1 + Math.cos(Math.PI * f)); }
  };
  var KERNEL_PARA_JANELA = { nitido: "ramlak", padrao: "shepp", liso: "hann" };

  /**
   * PROJEÇÃO DIRETA. Integra μ ao longo de cada raio.
   *
   * @param {Float32Array} imagemMu  μ por pixel (por mm), tamanho n×n
   * @param {object} o
   * @param {number} o.n          lado da matriz
   * @param {number} o.pixelMm    tamanho do pixel em mm
   * @param {number} [o.vistas=180]   projeções em 180° (feixe paralelo)
   * @param {number} [o.detectores]   bins do detector (padrão = n)
   * @returns {{dados:Float32Array, vistas:number, detectores:number, passoMm:number}}
   */
  function projetar(imagemMu, o) {
    var n = o.n;
    var d = o.pixelMm;
    var K = o.vistas || 180;
    var M = o.detectores || n;
    var sino = new Float32Array(K * M);
    var centro = (n - 1) / 2;
    var raioAmostras = Math.ceil(n * 1.42);       // diagonal, para cobrir o campo
    var meio = (M - 1) / 2;

    for (var k = 0; k < K; k++) {
      var th = Math.PI * k / K;
      var ct = Math.cos(th), st = Math.sin(th);
      for (var m = 0; m < M; m++) {
        var t = (m - meio);                        // em pixels
        var soma = 0;
        // Anda ao longo do raio: P(s) = t·(cos,sin) + s·(−sin,cos)
        for (var s = -raioAmostras / 2; s < raioAmostras / 2; s++) {
          var x = t * ct - s * st + centro;
          var y = t * st + s * ct + centro;
          if (x < 0 || y < 0 || x >= n - 1 || y >= n - 1) continue;
          var x0 = x | 0, y0 = y | 0;
          var fx = x - x0, fy = y - y0;
          var i0 = y0 * n + x0;
          var v = imagemMu[i0] * (1 - fx) * (1 - fy)
                + imagemMu[i0 + 1] * fx * (1 - fy)
                + imagemMu[i0 + n] * (1 - fx) * fy
                + imagemMu[i0 + n + 1] * fx * fy;
          soma += v;
        }
        sino[k * M + m] = soma * d;                // ∫μ·dl, com dl = pixel em mm
      }
    }
    return { dados: sino, vistas: K, detectores: M, passoMm: d };
  }

  /**
   * Filtra o sinograma com o filtro rampa e a janela escolhida.
   * @param {object} sino  saída de projetar (ou o sinograma medido)
   * @param {string} [kernel="padrao"]  liso | padrao | nitido
   */
  function filtrar(sino, kernel) {
    var K = sino.vistas, M = sino.detectores;
    var nome = KERNEL_PARA_JANELA[kernel] || "shepp";
    var janela = JANELAS[nome];
    var N = proximaPotencia2(M * 2);
    var re = new Float64Array(N), im = new Float64Array(N);
    var saida = new Float32Array(K * M);

    // FILTRO RAMPA a partir da RESPOSTA IMPULSIVA DISCRETA de Ram-Lak.
    //
    // Aplicar |f| diretamente no domínio da frequência zera a componente DC,
    // e a imagem inteira sai com um deslocamento — água reconstruía em
    // −40 HU. A forma discreta correta (Kak & Slaney, "Principles of
    // Computerized Tomographic Imaging", cap. 3) é
    //
    //   h[0]      = 1 / (4·Δt²)
    //   h[n par]  = 0
    //   h[n ímpar]= −1 / (n²·π²·Δt²)
    //
    // cuja transformada tem o DC correto. As janelas (Shepp-Logan, Hann)
    // multiplicam essa resposta no domínio da frequência.
    var dt = sino.passoMm;
    var hr = new Float64Array(N), hi = new Float64Array(N);
    var meia = N / 2;
    for (var nn = -meia; nn < meia; nn++) {
      var val;
      if (nn === 0) val = 1 / (4 * dt * dt);
      else if (nn % 2 === 0) val = 0;
      else val = -1 / (nn * nn * Math.PI * Math.PI * dt * dt);
      hr[(nn + N) % N] = val;
    }
    fft(hr, hi, false);
    var H = new Float64Array(N);
    for (var i = 0; i < N; i++) {
      var f = i <= N / 2 ? i : N - i;
      var fn = f / (N / 2);
      // A parte real da DFT da resposta impulsiva JÁ é a rampa com o DC certo.
      H[i] = Math.abs(hr[i]) * janela(fn);
    }

    for (var k = 0; k < K; k++) {
      re.fill(0); im.fill(0);
      for (var m = 0; m < M; m++) re[m] = sino.dados[k * M + m];
      fft(re, im, false);
      for (i = 0; i < N; i++) { re[i] *= H[i]; im[i] *= H[i]; }
      fft(re, im, true);
      for (m = 0; m < M; m++) saida[k * M + m] = re[m];
    }
    return { dados: saida, vistas: K, detectores: M, passoMm: sino.passoMm };
  }

  /**
   * RETROPROJEÇÃO. Devolve a imagem de μ reconstruída.
   *
   * @param {object} sinoFiltrado
   * @param {object} o
   * @param {number} o.n         lado da matriz de reconstrução
   * @param {number} o.pixelMm   tamanho do pixel reconstruído (FOV / matriz)
   */
  function retroprojetar(sinoFiltrado, o) {
    var n = o.n, K = sinoFiltrado.vistas, M = sinoFiltrado.detectores;
    var img = new Float32Array(n * n);
    var centro = (n - 1) / 2;
    var meio = (M - 1) / 2;
    // Razão entre o pixel reconstruído e o passo do detector: é isto que faz
    // FOV e matriz mudarem a amostragem, não só o rótulo.
    var escala = o.pixelMm / sinoFiltrado.passoMm;

    for (var k = 0; k < K; k++) {
      var th = Math.PI * k / K;
      var ct = Math.cos(th), st = Math.sin(th);
      var base = k * M;
      for (var y = 0; y < n; y++) {
        var dy = (y - centro) * escala;
        for (var x = 0; x < n; x++) {
          var dx = (x - centro) * escala;
          var t = dx * ct + dy * st + meio;
          if (t < 0 || t >= M - 1) continue;
          var t0 = t | 0, ft = t - t0;
          img[y * n + x] += sinoFiltrado.dados[base + t0] * (1 - ft)
                          + sinoFiltrado.dados[base + t0 + 1] * ft;
        }
      }
    }
    // Normalização da FBP de feixe paralelo:
    //   μ(x,y) = (π/K) · Σ_k q_k(t) · Δt
    // O Δt vem de a convolução discreta aproximar a integral contínua; com o
    // filtro construído da resposta impulsiva de Ram-Lak (que já traz 1/Δt²),
    // o produto fecha nas unidades de μ por mm.
    var fator = Math.PI / K * sinoFiltrado.passoMm;
    for (var i = 0; i < img.length; i++) img[i] *= fator;
    return img;
  }

  /** μ reconstruído → HU.  HU = 1000 × (μ − μ_água) / μ_água   [DEFINIÇÃO] */
  function muParaHU(imgMu, muAgua) {
    var out = new Int16Array(imgMu.length);
    for (var i = 0; i < imgMu.length; i++) {
      var hu = 1000 * (imgMu[i] - muAgua) / muAgua;
      out[i] = hu < -1024 ? -1024 : hu > 3071 ? 3071 : Math.round(hu);
    }
    return out;
  }

  /** HU → μ, para alimentar a projeção direta. */
  function huParaMu(huArray, kv) {
    var out = new Float32Array(huArray.length);
    for (var i = 0; i < huArray.length; i++) out[i] = Core.fisica.muDeHU(huArray[i], kv);
    return out;
  }

  Core.projetor = {
    projetar: projetar,
    filtrar: filtrar,
    retroprojetar: retroprojetar,
    muParaHU: muParaHU,
    huParaMu: huParaMu,
    JANELAS: JANELAS,
    KERNEL_PARA_JANELA: KERNEL_PARA_JANELA,
    _fft: fft
  };

})(typeof self !== "undefined" ? self : this);
