/**
 * Renderização volumétrica 3D por ray casting em WebGL2.
 *
 * O volume canônico LPS é enviado à GPU como textura 3D R16F (mantendo a
 * precisão dos valores originais, HU inclusive) e percorrido por raios no
 * fragment shader. Dois modos:
 *
 *   MIP      projeção de intensidade máxima
 *   Volume   composição front-to-back com função de transferência e sombreamento
 */

const VERT = `#version 300 es
precision highp float;
in vec2 aPos;
out vec2 vNdc;
void main() {
  vNdc = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 vNdc;
out vec4 fragColor;

uniform sampler3D uVolume;
uniform sampler2D uTransfer;
uniform mat4  uInvVP;
uniform vec3  uCam;         // posição da câmera no espaço do volume
uniform vec3  uMeiaExtensao;// meia-extensão da caixa (unidades normalizadas)
uniform vec2  uJanela;      // centro, largura (nas unidades originais)
uniform vec2  uFaixa;       // min, max do volume (para desnormalizar a textura)
uniform float uPasso;
uniform float uOpacidade;
uniform int   uModo;        // 0 = MIP, 1 = volume
uniform float uCorte;       // plano de corte ao longo de z (0..1), 1 = sem corte
uniform int   uSombrear;

vec3 paraTextura(vec3 p) {
  return (p + uMeiaExtensao) / (2.0 * uMeiaExtensao);
}

float amostrar(vec3 tc) {
  return texture(uVolume, tc).r;
}

// valor bruto -> intensidade janelada 0..1
float janelar(float bruto) {
  float v = uFaixa.x + bruto * (uFaixa.y - uFaixa.x);
  return clamp((v - (uJanela.x - 0.5)) / max(uJanela.y - 1.0, 1.0) + 0.5, 0.0, 1.0);
}

bool intersectarCaixa(vec3 origem, vec3 dir, out float tNear, out float tFar) {
  vec3 inv = 1.0 / dir;
  vec3 t0 = (-uMeiaExtensao - origem) * inv;
  vec3 t1 = ( uMeiaExtensao - origem) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  tNear = max(max(tmin.x, tmin.y), tmin.z);
  tFar  = min(min(tmax.x, tmax.y), tmax.z);
  return tFar > max(tNear, 0.0);
}

vec3 gradiente(vec3 tc, float h) {
  return vec3(
    amostrar(tc + vec3(h, 0.0, 0.0)) - amostrar(tc - vec3(h, 0.0, 0.0)),
    amostrar(tc + vec3(0.0, h, 0.0)) - amostrar(tc - vec3(0.0, h, 0.0)),
    amostrar(tc + vec3(0.0, 0.0, h)) - amostrar(tc - vec3(0.0, 0.0, h)));
}

void main() {
  // raio a partir do NDC
  vec4 pNear = uInvVP * vec4(vNdc, -1.0, 1.0);
  vec4 pFar  = uInvVP * vec4(vNdc,  1.0, 1.0);
  vec3 a = pNear.xyz / pNear.w;
  vec3 b = pFar.xyz / pFar.w;
  vec3 dir = normalize(b - a);

  float tNear, tFar;
  if (!intersectarCaixa(uCam, dir, tNear, tFar)) { fragColor = vec4(0.0); return; }
  tNear = max(tNear, 0.0);

  float passo = uPasso;
  // deslocamento pseudoaleatório do primeiro ponto: troca as faixas de
  // amostragem ("wood grain") por um ruído fino, muito menos visível
  float ruido = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float t = tNear + ruido * passo;
  vec4 acumulado = vec4(0.0);
  float maximo = 0.0;
  float h = uPasso * 0.75;

  for (int i = 0; i < 1024; i++) {
    if (t > tFar) break;
    vec3 p = uCam + dir * t;
    vec3 tc = paraTextura(p);
    if (tc.z <= uCorte) {
      float bruto = amostrar(tc);
      float s = janelar(bruto);

      if (uModo == 0) {
        maximo = max(maximo, s);
      } else {
        vec4 cor = texture(uTransfer, vec2(s, 0.5));
        float alfa = cor.a * uOpacidade;
        if (alfa > 0.002) {
          vec3 rgb = cor.rgb;
          if (uSombrear == 1) {
            vec3 g = gradiente(tc, h);
            float mag = length(g);
            if (mag > 1e-5) {
              vec3 n = -g / mag;
              vec3 luz = normalize(vec3(0.4, -0.7, 0.6));
              float dif = max(dot(n, luz), 0.0);
              vec3 meio = normalize(luz - dir);
              float esp = pow(max(dot(n, meio), 0.0), 24.0);
              rgb = rgb * (0.35 + 0.75 * dif) + vec3(0.5) * esp * 0.35;
            }
          }
          // composição front-to-back
          acumulado.rgb += (1.0 - acumulado.a) * alfa * rgb;
          acumulado.a   += (1.0 - acumulado.a) * alfa;
          if (acumulado.a > 0.985) break;
        }
      }
    }
    t += passo;
  }

  if (uModo == 0) {
    vec4 cor = texture(uTransfer, vec2(maximo, 0.5));
    fragColor = vec4(cor.rgb * maximo, maximo > 0.004 ? 1.0 : 0.0);
  } else {
    fragColor = acumulado;
  }
}`;

// ---------------------------------------------------------------------------
export const TRANSFERENCIAS = {
  osso: {
    rotulo: 'Osso e pele',
    pontos: [
      [0.00, 0, 0, 0, 0.0],
      [0.30, 190, 120, 90, 0.0],
      [0.42, 220, 160, 130, 0.06],
      [0.62, 240, 225, 205, 0.35],
      [1.00, 255, 255, 250, 0.85],
    ],
  },
  musculo: {
    rotulo: 'Tecidos moles',
    pontos: [
      [0.00, 0, 0, 0, 0.0],
      [0.25, 150, 40, 40, 0.0],
      [0.45, 210, 110, 95, 0.12],
      [0.70, 245, 205, 180, 0.30],
      [1.00, 255, 255, 255, 0.75],
    ],
  },
  vasos: {
    rotulo: 'Vasos / contraste',
    pontos: [
      [0.00, 0, 0, 0, 0.0],
      [0.45, 120, 20, 20, 0.0],
      [0.60, 220, 60, 50, 0.18],
      [0.80, 255, 170, 120, 0.45],
      [1.00, 255, 255, 255, 0.9],
    ],
  },
  neutra: {
    rotulo: 'Cinza',
    pontos: [
      [0.00, 0, 0, 0, 0.0],
      [0.35, 90, 90, 90, 0.02],
      [1.00, 255, 255, 255, 0.8],
    ],
  },
};

function tabelaTransferencia(nome) {
  const pontos = TRANSFERENCIAS[nome].pontos;
  const t = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let a = pontos[0];
    let b = pontos[pontos.length - 1];
    for (let k = 0; k < pontos.length - 1; k++) {
      if (x >= pontos[k][0] && x <= pontos[k + 1][0]) { a = pontos[k]; b = pontos[k + 1]; break; }
    }
    const f = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
    for (let c = 0; c < 3; c++) t[i * 4 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * f;
    // o alfa dos pontos é 0..1; a textura é de 8 bits
    t[i * 4 + 3] = 255 * (a[4] + (b[4] - a[4]) * f);
  }
  return t;
}

// ---------------------------------------------------------------------------
function multiplicar(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1]
        + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
    }
  }
  return o;
}

function inverter(m) {
  const inv = new Float32Array(16);
  const a = m;
  inv[0] = a[5]*a[10]*a[15]-a[5]*a[11]*a[14]-a[9]*a[6]*a[15]+a[9]*a[7]*a[14]+a[13]*a[6]*a[11]-a[13]*a[7]*a[10];
  inv[4] = -a[4]*a[10]*a[15]+a[4]*a[11]*a[14]+a[8]*a[6]*a[15]-a[8]*a[7]*a[14]-a[12]*a[6]*a[11]+a[12]*a[7]*a[10];
  inv[8] = a[4]*a[9]*a[15]-a[4]*a[11]*a[13]-a[8]*a[5]*a[15]+a[8]*a[7]*a[13]+a[12]*a[5]*a[11]-a[12]*a[7]*a[9];
  inv[12] = -a[4]*a[9]*a[14]+a[4]*a[10]*a[13]+a[8]*a[5]*a[14]-a[8]*a[6]*a[13]-a[12]*a[5]*a[10]+a[12]*a[6]*a[9];
  inv[1] = -a[1]*a[10]*a[15]+a[1]*a[11]*a[14]+a[9]*a[2]*a[15]-a[9]*a[3]*a[14]-a[13]*a[2]*a[11]+a[13]*a[3]*a[10];
  inv[5] = a[0]*a[10]*a[15]-a[0]*a[11]*a[14]-a[8]*a[2]*a[15]+a[8]*a[3]*a[14]+a[12]*a[2]*a[11]-a[12]*a[3]*a[10];
  inv[9] = -a[0]*a[9]*a[15]+a[0]*a[11]*a[13]+a[8]*a[1]*a[15]-a[8]*a[3]*a[13]-a[12]*a[1]*a[11]+a[12]*a[3]*a[9];
  inv[13] = a[0]*a[9]*a[14]-a[0]*a[10]*a[13]-a[8]*a[1]*a[14]+a[8]*a[2]*a[13]+a[12]*a[1]*a[10]-a[12]*a[2]*a[9];
  inv[2] = a[1]*a[6]*a[15]-a[1]*a[7]*a[14]-a[5]*a[2]*a[15]+a[5]*a[3]*a[14]+a[13]*a[2]*a[7]-a[13]*a[3]*a[6];
  inv[6] = -a[0]*a[6]*a[15]+a[0]*a[7]*a[14]+a[4]*a[2]*a[15]-a[4]*a[3]*a[14]-a[12]*a[2]*a[7]+a[12]*a[3]*a[6];
  inv[10] = a[0]*a[5]*a[15]-a[0]*a[7]*a[13]-a[4]*a[1]*a[15]+a[4]*a[3]*a[13]+a[12]*a[1]*a[7]-a[12]*a[3]*a[5];
  inv[14] = -a[0]*a[5]*a[14]+a[0]*a[6]*a[13]+a[4]*a[1]*a[14]-a[4]*a[2]*a[13]-a[12]*a[1]*a[6]+a[12]*a[2]*a[5];
  inv[3] = -a[1]*a[6]*a[11]+a[1]*a[7]*a[10]+a[5]*a[2]*a[11]-a[5]*a[3]*a[10]-a[9]*a[2]*a[7]+a[9]*a[3]*a[6];
  inv[7] = a[0]*a[6]*a[11]-a[0]*a[7]*a[10]-a[4]*a[2]*a[11]+a[4]*a[3]*a[10]+a[8]*a[2]*a[7]-a[8]*a[3]*a[6];
  inv[11] = -a[0]*a[5]*a[11]+a[0]*a[7]*a[9]+a[4]*a[1]*a[11]-a[4]*a[3]*a[9]-a[8]*a[1]*a[7]+a[8]*a[3]*a[5];
  inv[15] = a[0]*a[5]*a[10]-a[0]*a[6]*a[9]-a[4]*a[1]*a[10]+a[4]*a[2]*a[9]+a[8]*a[1]*a[6]-a[8]*a[2]*a[5];
  let det = a[0]*inv[0] + a[1]*inv[4] + a[2]*inv[8] + a[3]*inv[12];
  if (!det) return inv;
  det = 1.0 / det;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}

function perspectiva(fovY, aspecto, perto, longe) {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspecto; m[5] = f;
  m[10] = (longe + perto) / (perto - longe); m[11] = -1;
  m[14] = (2 * longe * perto) / (perto - longe);
  return m;
}

function olharPara(olho, alvo, cima) {
  const f = normalizar([alvo[0] - olho[0], alvo[1] - olho[1], alvo[2] - olho[2]]);
  const s = normalizar(cruzar(f, cima));
  const u = cruzar(s, f);
  const m = new Float32Array(16);
  m[0] = s[0]; m[4] = s[1]; m[8] = s[2];
  m[1] = u[0]; m[5] = u[1]; m[9] = u[2];
  m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2];
  m[12] = -(s[0]*olho[0] + s[1]*olho[1] + s[2]*olho[2]);
  m[13] = -(u[0]*olho[0] + u[1]*olho[1] + u[2]*olho[2]);
  m[14] = f[0]*olho[0] + f[1]*olho[1] + f[2]*olho[2];
  m[15] = 1;
  return m;
}

const cruzar = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const normalizar = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0]/n, v[1]/n, v[2]/n];
};

// ---------------------------------------------------------------------------
export class Renderizador3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false,
      preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    this.disponivel = !!this.gl;
    this.erro = this.disponivel ? null : 'WebGL2 não está disponível neste navegador.';
    if (!this.disponivel) return;

    const gl = this.gl;
    this.programa = this._programa(VERT, FRAG);
    this.uni = {};
    for (const n of ['uVolume', 'uTransfer', 'uInvVP', 'uCam', 'uMeiaExtensao',
      'uJanela', 'uFaixa', 'uPasso', 'uOpacidade', 'uModo', 'uCorte', 'uSombrear']) {
      this.uni[n] = gl.getUniformLocation(this.programa, n);
    }

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.programa, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.texVolume = null;
    this.texTransfer = gl.createTexture();
    this.definirTransferencia('osso');

    // câmera
    this.azimute = 0;         // 0 = vista anterior
    this.elevacao = 0;
    this.distancia = 1.8;
    this.modo = 'volume';
    this.opacidade = 1;
    this.corte = 1;
    this.sombrear = true;
    this.qualidade = 1;
    this._instalarEventos();
  }

  _programa(vs, fs) {
    const gl = this.gl;
    const compilar = (tipo, fonte) => {
      const s = gl.createShader(tipo);
      gl.shaderSource(s, fonte);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compilar(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compilar(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Link: ' + gl.getProgramInfoLog(p));
    }
    return p;
  }

  definirTransferencia(nome) {
    if (!this.disponivel) return;
    const gl = this.gl;
    this.transferencia = nome;
    gl.bindTexture(gl.TEXTURE_2D, this.texTransfer);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA,
      gl.UNSIGNED_BYTE, tabelaTransferencia(nome));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /**
   * Envia o volume para a GPU, reduzindo a resolução se necessário.
   * @param {number} maxDim  maior dimensão da textura 3D
   */
  definirVolume(volume, maxDim = 256) {
    if (!this.disponivel) return;
    const gl = this.gl;
    this.volume = volume;

    const [nx, ny, nz] = volume.dims;
    const fator = Math.max(1, Math.ceil(Math.max(nx, ny, nz) / maxDim));
    const tx = Math.max(2, Math.floor(nx / fator));
    const ty = Math.max(2, Math.floor(ny / fator));
    const tz = Math.max(2, Math.floor(nz / fator));
    this.dimsTextura = [tx, ty, tz];

    const faixa = [volume.minimo, volume.maximo];
    const amplitude = Math.max(1, faixa[1] - faixa[0]);
    const dados = new Float32Array(tx * ty * tz);
    const src = volume.dados;

    // redução por máximo local: preserva estruturas finas (vasos, trabéculas)
    let o = 0;
    for (let z = 0; z < tz; z++) {
      const z0 = Math.floor(z * nz / tz);
      const z1 = Math.max(z0 + 1, Math.floor((z + 1) * nz / tz));
      for (let y = 0; y < ty; y++) {
        const y0 = Math.floor(y * ny / ty);
        const y1 = Math.max(y0 + 1, Math.floor((y + 1) * ny / ty));
        for (let x = 0; x < tx; x++) {
          const x0 = Math.floor(x * nx / tx);
          const x1 = Math.max(x0 + 1, Math.floor((x + 1) * nx / tx));
          let m = -32768;
          for (let k = z0; k < z1; k++) {
            const bz = k * nx * ny;
            for (let j = y0; j < y1; j++) {
              const bj = bz + j * nx;
              for (let i = x0; i < x1; i++) {
                const v = src[bj + i];
                if (v > m) m = v;
              }
            }
          }
          dados[o++] = (m - faixa[0]) / amplitude;
        }
      }
    }

    if (this.texVolume) gl.deleteTexture(this.texVolume);
    this.texVolume = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, this.texVolume);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, tx, ty, tz, 0, gl.RED, gl.FLOAT, dados);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const eixo of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) {
      gl.texParameteri(gl.TEXTURE_3D, eixo, gl.CLAMP_TO_EDGE);
    }

    this.faixa = faixa;
    const ext = volume.extensao;
    const maior = Math.max(...ext);
    this.meiaExtensao = ext.map((e) => (e / maior) * 0.5);
    // enquadra a esfera que contém a caixa, qualquer que seja o ângulo
    const raio = Math.hypot(...this.meiaExtensao);
    this.distancia = raio / Math.tan(22.5 * Math.PI / 180) * 0.92;
  }

  vista(nome) {
    const v = {
      anterior: [0, 0], posterior: [180, 0], esquerda: [90, 0],
      direita: [-90, 0], superior: [0, 89], inferior: [0, -89],
    }[nome];
    if (v) { this.azimute = v[0]; this.elevacao = v[1]; }
  }

  desenhar() {
    if (!this.disponivel || !this.texVolume) return;
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const larg = Math.max(1, Math.round(this.canvas.clientWidth * dpr * this.qualidade));
    const alt = Math.max(1, Math.round(this.canvas.clientHeight * dpr * this.qualidade));
    if (this.canvas.width !== larg || this.canvas.height !== alt) {
      this.canvas.width = larg;
      this.canvas.height = alt;
    }
    gl.viewport(0, 0, larg, alt);
    gl.clearColor(0.02, 0.03, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const az = this.azimute * Math.PI / 180;
    const el = this.elevacao * Math.PI / 180;
    // az = 0 -> câmera em -y (anterior); z é superior
    const olho = [
      Math.sin(az) * Math.cos(el) * this.distancia,
      -Math.cos(az) * Math.cos(el) * this.distancia,
      Math.sin(el) * this.distancia,
    ];
    const proj = perspectiva(45 * Math.PI / 180, larg / alt, 0.01, 20);
    const vista = olharPara(olho, [0, 0, 0], [0, 0, 1]);
    const invVP = inverter(multiplicar(proj, vista));

    const passo = 1.0 / (Math.max(...this.dimsTextura) * 2.0);

    gl.useProgram(this.programa);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, this.texVolume);
    gl.uniform1i(this.uni.uVolume, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texTransfer);
    gl.uniform1i(this.uni.uTransfer, 1);

    gl.uniformMatrix4fv(this.uni.uInvVP, false, invVP);
    gl.uniform3fv(this.uni.uCam, olho);
    gl.uniform3fv(this.uni.uMeiaExtensao, this.meiaExtensao);
    gl.uniform2f(this.uni.uJanela, this.janela.centro, this.janela.largura);
    gl.uniform2f(this.uni.uFaixa, this.faixa[0], this.faixa[1]);
    gl.uniform1f(this.uni.uPasso, passo);
    gl.uniform1f(this.uni.uOpacidade, this.opacidade);
    gl.uniform1i(this.uni.uModo, this.modo === 'mip' ? 0 : 1);
    gl.uniform1f(this.uni.uCorte, this.corte);
    gl.uniform1i(this.uni.uSombrear, this.sombrear ? 1 : 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  aproximar(fator) {
    this.distancia = Math.max(0.6, Math.min(8, this.distancia * fator));
  }

  /** Um dedo/botão orbita; dois dedos fazem pinça para aproximar. */
  _instalarEventos() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    const pontos = new Map();
    let ultimo = [0, 0];
    let distAnterior = 0;

    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pontos.set(e.pointerId, [e.offsetX, e.offsetY]);
      ultimo = [e.offsetX, e.offsetY];
      if (pontos.size === 2) {
        const [a, b] = [...pontos.values()];
        distAnterior = Math.hypot(a[0] - b[0], a[1] - b[1]);
      }
    });

    c.addEventListener('pointermove', (e) => {
      if (!pontos.has(e.pointerId)) return;
      pontos.set(e.pointerId, [e.offsetX, e.offsetY]);

      if (pontos.size >= 2) {
        const [a, b] = [...pontos.values()];
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (distAnterior > 8 && dist > 8) this.aproximar(distAnterior / dist);
        distAnterior = dist;
        this.aoMudar?.();
        return;
      }

      this.azimute += (e.offsetX - ultimo[0]) * 0.45;
      this.elevacao = Math.max(-89, Math.min(89, this.elevacao + (e.offsetY - ultimo[1]) * 0.45));
      ultimo = [e.offsetX, e.offsetY];
      this.aoMudar?.();
    });

    const soltar = (e) => {
      pontos.delete(e.pointerId);
      distAnterior = 0;
      const restante = [...pontos.values()][0];
      if (restante) ultimo = restante;
    };
    c.addEventListener('pointerup', soltar);
    c.addEventListener('pointercancel', soltar);

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.aproximar(e.deltaY > 0 ? 1.1 : 1 / 1.1);
      this.aoMudar?.();
    }, { passive: false });
  }
}
