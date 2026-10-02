/**
 * js/sala/glb.js
 * Um leitor de GLB, escrito aqui, de propósito.
 *
 * POR QUE NÃO O GLTFLoader OFICIAL
 *
 * O three.js publica um GLTFLoader completo, mas ele mora em `examples/js/`,
 * não vem no `three.min.js` que este projeto vendoriza (r128), e trazê-lo
 * significaria baixar e passar a executar um arquivo de 60 KB de terceiros
 * dentro do simulador. Este projeto tem uma regra sobre isso, e ela é boa.
 *
 * O que o app precisa é MUITO menos do que o glTF sabe fazer: uma malha
 * estática de paciente, com material e textura. Isso cabe em um leitor
 * pequeno, legível, que se pode auditar de uma sentada.
 *
 * O QUE ESTE LEITOR ENTENDE
 *
 *   contêiner   GLB binário (.glb) — um arquivo só, textura embutida
 *   geometria   POSITION, NORMAL, TEXCOORD_0, índices; triângulos (mode 4)
 *               inclusive com buffers intercalados (byteStride)
 *   cena        hierarquia de nós, por `matrix` ou por translation/rotation/scale
 *   material    pbrMetallicRoughness: baseColorFactor, metallic, roughness,
 *               baseColorTexture (PNG/JPEG embutidos), doubleSided, alphaMode
 *
 * O QUE ELE NÃO ENTENDE — e é melhor dizer do que descobrir depois
 *
 *   • esqueleto e animação (skins/animations): a malha vem na POSE DE BIND.
 *     Para um paciente deitado numa mesa isso é o que se quer; para um
 *     personagem animado, não é.
 *   • morph targets, câmeras, luzes do arquivo
 *   • extensões KHR (Draco, compressão de textura, transmissão…)
 *   • .gltf separado (JSON + .bin + imagens soltas). É .glb, um arquivo só.
 *
 * Encontrando qualquer uma dessas, o leitor NÃO falha em silêncio: devolve o
 * que conseguiu e uma lista de avisos, e quem chamou decide o que dizer ao
 * operador.
 *
 * Depende de THREE. Script clássico.
 */
(function () {
  "use strict";

  var MAGIC = 0x46546c67;      // "glTF"
  var CHUNK_JSON = 0x4e4f534a; // "JSON"
  var CHUNK_BIN = 0x004e4942;  // "BIN\0"

  // componentType do glTF -> construtor de TypedArray
  var TIPOS = {
    5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
    5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array
  };
  var COMPONENTES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

  /**
   * Separa o GLB nos dois pedaços que interessam: o JSON e o binário.
   * @param {ArrayBuffer} buffer
   * @returns {{json: object, bin: Uint8Array|null}}
   */
  function abrirContainer(buffer) {
    var dv = new DataView(buffer);
    if (buffer.byteLength < 12 || dv.getUint32(0, true) !== MAGIC) {
      throw new Error("não é um arquivo GLB (assinatura 'glTF' ausente). " +
        "Exporte como .glb — binário, um arquivo só.");
    }
    var versao = dv.getUint32(4, true);
    if (versao !== 2) throw new Error("GLB versão " + versao + "; este leitor entende a 2.");

    var json = null, bin = null;
    var p = 12;
    while (p + 8 <= buffer.byteLength) {
      var tam = dv.getUint32(p, true);
      var tipo = dv.getUint32(p + 4, true);
      var ini = p + 8;
      if (tipo === CHUNK_JSON) {
        json = JSON.parse(new TextDecoder("utf-8").decode(new Uint8Array(buffer, ini, tam)));
      } else if (tipo === CHUNK_BIN) {
        bin = new Uint8Array(buffer, ini, tam);
      }
      p = ini + tam + ((4 - (tam % 4)) % 4); // pedaços são alinhados em 4
    }
    if (!json) throw new Error("GLB sem bloco JSON.");
    return { json: json, bin: bin };
  }

  /** Lê um accessor como TypedArray já desintercalada. */
  function lerAccessor(g, bin, indice) {
    var ac = g.accessors[indice];
    if (!ac) return null;
    var Tipo = TIPOS[ac.componentType];
    var n = COMPONENTES[ac.type];
    if (!Tipo || !n) return null;

    // Accessor sem bufferView é legalmente todo zero (esparso não é suportado).
    if (ac.bufferView == null) return new Float32Array(ac.count * n);

    var bv = g.bufferViews[ac.bufferView];
    var base = (bv.byteOffset || 0) + (ac.byteOffset || 0);
    var passo = bv.byteStride || 0;
    var bytes = Tipo.BYTES_PER_ELEMENT;

    if (!passo || passo === n * bytes) {
      // Compacto: uma cópia direta basta. O `slice` desprende do buffer do
      // arquivo, para o ArrayBuffer inteiro poder ser liberado depois.
      return new Tipo(bin.buffer.slice(
        bin.byteOffset + base, bin.byteOffset + base + ac.count * n * bytes));
    }
    // Intercalado: copia elemento a elemento, pulando o passo.
    var saida = new Tipo(ac.count * n);
    var dv = new DataView(bin.buffer, bin.byteOffset);
    var leitor = {
      5120: "getInt8", 5121: "getUint8", 5122: "getInt16",
      5123: "getUint16", 5125: "getUint32", 5126: "getFloat32"
    }[ac.componentType];
    for (var i = 0; i < ac.count; i++) {
      for (var c = 0; c < n; c++) {
        saida[i * n + c] = dv[leitor](base + i * passo + c * bytes, true);
      }
    }
    return saida;
  }

  /** Normaliza inteiros para 0..1, como manda o glTF para cor e UV. */
  function normalizar(arr, componentType) {
    if (componentType === 5126) return arr;
    var div = { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 }[componentType];
    if (!div) return arr;
    var f = new Float32Array(arr.length);
    for (var i = 0; i < arr.length; i++) f[i] = Math.max(arr[i] / div, -1);
    return f;
  }

  /** Textura embutida -> THREE.Texture, por blob. */
  function montarTextura(g, bin, indiceTextura, avisos) {
    var tx = g.textures && g.textures[indiceTextura];
    if (!tx || tx.source == null) return null;
    var img = g.images && g.images[tx.source];
    if (!img) return null;
    if (img.uri) {
      avisos.push("textura em arquivo externo (" + img.uri + ") — exporte com as texturas EMBUTIDAS.");
      return null;
    }
    if (img.bufferView == null) return null;
    var bv = g.bufferViews[img.bufferView];
    var fatia = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    var url = URL.createObjectURL(new Blob([fatia], { type: img.mimeType || "image/png" }));

    var tex = new THREE.Texture();
    tex.flipY = false; // o glTF já traz a UV com a origem no topo
    var el = new Image();
    el.onload = function () {
      tex.image = el;
      tex.needsUpdate = true;
      URL.revokeObjectURL(url);
    };
    el.onerror = function () { URL.revokeObjectURL(url); };
    el.src = url;

    var amostrador = (tx.sampler != null && g.samplers) ? g.samplers[tx.sampler] : null;
    if (amostrador) {
      var ENVOLVER = { 33071: THREE.ClampToEdgeWrapping, 33648: THREE.MirroredRepeatWrapping, 10497: THREE.RepeatWrapping };
      tex.wrapS = ENVOLVER[amostrador.wrapS] || THREE.RepeatWrapping;
      tex.wrapT = ENVOLVER[amostrador.wrapT] || THREE.RepeatWrapping;
    }
    return tex;
  }

  function montarMaterial(g, bin, indice, avisos) {
    var padrao = { color: 0xcfcfcf, roughness: 0.85, metalness: 0.0 };
    if (indice == null || !g.materials || !g.materials[indice]) {
      return new THREE.MeshStandardMaterial(padrao);
    }
    var m = g.materials[indice];
    var pbr = m.pbrMetallicRoughness || {};
    var opcoes = {
      roughness: pbr.roughnessFactor != null ? pbr.roughnessFactor : 0.85,
      metalness: pbr.metallicFactor != null ? pbr.metallicFactor : 0.0
    };
    var cor = pbr.baseColorFactor;
    opcoes.color = cor ? new THREE.Color(cor[0], cor[1], cor[2]) : new THREE.Color(0xcfcfcf);
    if (cor && cor[3] < 1) { opcoes.transparent = true; opcoes.opacity = cor[3]; }
    if (m.doubleSided) opcoes.side = THREE.DoubleSide;
    if (m.alphaMode === "BLEND") opcoes.transparent = true;
    if (m.alphaMode === "MASK") { opcoes.alphaTest = m.alphaCutoff != null ? m.alphaCutoff : 0.5; }

    var mat = new THREE.MeshStandardMaterial(opcoes);
    if (pbr.baseColorTexture) {
      var t = montarTextura(g, bin, pbr.baseColorTexture.index, avisos);
      if (t) { mat.map = t; mat.color.set(0xffffff); }
    }
    if (m.emissiveFactor && (m.emissiveFactor[0] || m.emissiveFactor[1] || m.emissiveFactor[2])) {
      mat.emissive = new THREE.Color(m.emissiveFactor[0], m.emissiveFactor[1], m.emissiveFactor[2]);
    }
    return mat;
  }

  function montarMalha(g, bin, indiceMalha, avisos) {
    var malha = g.meshes[indiceMalha];
    var grupo = new THREE.Group();
    grupo.name = malha.name || "malha";

    malha.primitives.forEach(function (p) {
      if (p.mode != null && p.mode !== 4) {
        avisos.push("primitiva em modo " + p.mode + " ignorada (só triângulos).");
        return;
      }
      var geo = new THREE.BufferGeometry();
      var at = p.attributes || {};
      if (at.POSITION == null) return;

      var pos = lerAccessor(g, bin, at.POSITION);
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));

      if (at.NORMAL != null) {
        geo.setAttribute("normal", new THREE.BufferAttribute(lerAccessor(g, bin, at.NORMAL), 3));
      }
      if (at.TEXCOORD_0 != null) {
        var uvAc = g.accessors[at.TEXCOORD_0];
        var uv = normalizar(lerAccessor(g, bin, at.TEXCOORD_0), uvAc.componentType);
        geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      }
      if (p.indices != null) {
        var idx = lerAccessor(g, bin, p.indices);
        geo.setIndex(new THREE.BufferAttribute(
          (idx instanceof Uint32Array || idx instanceof Uint16Array) ? idx : new Uint32Array(idx), 1));
      }
      if (at.NORMAL == null) geo.computeVertexNormals();

      grupo.add(new THREE.Mesh(geo, montarMaterial(g, bin, p.material, avisos)));
    });
    return grupo;
  }

  function aplicarTransformacao(obj, no) {
    if (no.matrix) {
      var m = new THREE.Matrix4();
      m.fromArray(no.matrix); // glTF é column-major, como o three.js
      m.decompose(obj.position, obj.quaternion, obj.scale);
      return;
    }
    if (no.translation) obj.position.fromArray(no.translation);
    if (no.rotation) obj.quaternion.fromArray(no.rotation);
    if (no.scale) obj.scale.fromArray(no.scale);
  }

  function montarNo(g, bin, indice, avisos, vistos) {
    if (vistos[indice]) {   // ciclo no grafo: o glTF proibe, mas arquivo quebrado existe
      avisos.push("ciclo na hierarquia de nós; um ramo foi cortado.");
      return null;
    }
    vistos[indice] = true;
    var no = g.nodes[indice];
    var obj = new THREE.Group();
    obj.name = no.name || ("no" + indice);
    aplicarTransformacao(obj, no);

    if (no.mesh != null) obj.add(montarMalha(g, bin, no.mesh, avisos));
    if (no.skin != null) {
      var avisoPele = "o modelo tem esqueleto; a malha vem na POSE DE BIND (sem animação).";
      // Um rig pode associar dezenas de nós de malha ao mesmo esqueleto. O
      // operador precisa saber da limitação, mas não receber a mesma frase
      // repetida uma vez por parte do corpo.
      if (avisos.indexOf(avisoPele) === -1) avisos.push(avisoPele);
    }
    (no.children || []).forEach(function (f) {
      var filho = montarNo(g, bin, f, avisos, vistos);
      if (filho) obj.add(filho);
    });
    delete vistos[indice];
    return obj;
  }

  /**
   * Lê um GLB e devolve a cena como um THREE.Group.
   *
   * @param {ArrayBuffer} buffer   o arquivo inteiro
   * @returns {{objeto: THREE.Group, avisos: string[], nomeCena: string}}
   */
  function lerGLB(buffer) {
    var c = abrirContainer(buffer);
    var g = c.json, bin = c.bin;
    var avisos = [];

    if (!bin) throw new Error("GLB sem bloco binário — os vértices não vieram no arquivo.");
    if (g.extensionsRequired && g.extensionsRequired.length) {
      avisos.push("o arquivo exige extensões que este leitor não tem (" +
        g.extensionsRequired.join(", ") + "); exporte sem compressão (sem Draco).");
    }
    if (g.animations && g.animations.length) {
      avisos.push(g.animations.length + " animação(ões) ignorada(s): o paciente é uma pose, não um personagem animado.");
    }

    var raiz = new THREE.Group();
    raiz.name = "glb";
    var cena = g.scenes && g.scenes[g.scene != null ? g.scene : 0];
    var nos = cena ? (cena.nodes || []) : (g.nodes || []).map(function (_, i) { return i; });
    nos.forEach(function (i) {
      var o = montarNo(g, bin, i, avisos, {});
      if (o) raiz.add(o);
    });

    return { objeto: raiz, avisos: avisos, nomeCena: (cena && cena.name) || "" };
  }

  window.SimTC = window.SimTC || {};
  SimTC.Sala3D = window.SimTC.Sala3D || {};
  SimTC.Sala3D.lerGLB = lerGLB;

})();
