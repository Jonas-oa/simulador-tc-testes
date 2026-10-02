/**
 * js/sala/paciente-importado.js
 * Trocar o paciente sem tocar em código.
 *
 * A figura que a sala monta em js/sala/paciente.js é feita de primitivas —
 * esferas e cilindros. Serve, mas quem quiser um paciente melhor (ou um
 * paciente pediátrico, ou obeso, ou com um posicionamento específico) precisa
 * modelar em Blender, MakeHuman, Mixamo — e não deveria ter de mexer em nada
 * aqui para isso.
 *
 * O CONTRATO É UMA PASTA
 *
 *     assets/paciente/paciente.glb     ← só isso já funciona
 *     assets/paciente/paciente.json    ← opcional, para corrigir o que
 *                                        a leitura automática errar
 *
 * Sem a pasta, o app usa a figura procedural de sempre. Com ela, o modelo
 * entra no lugar — e se o arquivo estiver quebrado, o app AVISA e continua
 * com a figura procedural, em vez de ficar sem paciente nenhum.
 *
 * O QUE É AJUSTADO SOZINHO
 *
 * Um modelo vindo de outra ferramenta chega em escala, orientação e origem
 * arbitrárias: o Blender exporta em metros com Z para cima, o Mixamo em
 * centímetros, e a origem tanto pode estar nos pés quanto no quadril. Em vez
 * de exigir que o autor acerte tudo isso, o app mede a caixa envolvente e
 * normaliza:
 *
 *   eixo longo    vira o eixo cabeça-pés (Z no app)
 *   eixo curto    vira a espessura do corpo (Y — a altura sobre o tampo)
 *   escala        o comprimento total vira 1,70 m
 *   origem        centro em X e Z; a parte mais baixa encosta em Y = 0,
 *                 que é o plano do tampo da mesa
 *
 * A ÚNICA COISA QUE A GEOMETRIA NÃO DIZ é para que lado fica a cabeça. O app
 * chuta pelo ponto mais LARGO do corpo — os ombros ficam mais perto da cabeça
 * do que dos pés — e ANUNCIA o que decidiu. Se errar, o `paciente.json`
 * corrige com uma linha.
 *
 * Depende de THREE e de js/sala/glb.js. Script clássico.
 */
(function () {
  "use strict";

  var PASTA = "assets/paciente/";
  var MODELO = PASTA + "paciente.glb";
  var MANIFESTO = PASTA + "paciente.json";

  var COMPRIMENTO_PADRAO = 1.70; // m, da cabeça aos pés

  /** Caixa envolvente de um objeto já montado. */
  function caixa(obj) {
    var b = new THREE.Box3();
    b.setFromObject(obj);
    return b;
  }

  /**
   * Descobre para que lado está a cabeça, ao longo do eixo Z.
   *
   * Um corpo humano é assimétrico ao longo do próprio eixo, e de duas formas
   * que se pode medir:
   *
   *   1. A LARGURA. Os ombros são a parte mais larga, e ficam a cerca de 80%
   *      da altura contando dos pés.
   *   2. A MASSA. O centro de massa de uma pessoa fica acima do meio da
   *      altura — perto de 56%, no umbigo.
   *
   * A primeira tentativa usava só a fatia mais larga, e um modelo em T-pose
   * a derrotava: com os braços abertos, DEZENAS de fatias empatam na largura
   * máxima (todas as que o braço atravessa), e a primeira delas cai perto dos
   * pés. Medido com um boneco de teste: decidiu "não sei" onde a resposta era
   * óbvia.
   *
   * Agora a largura é lida pelo CENTRO da faixa larga — a média das fatias que
   * chegam a 90% do máximo, que com braços abertos é o meio do braço, ainda
   * acima da cintura. E, se isso empatar, o centróide dos vértices decide.
   *
   * Devolve +1 (cabeça em +Z), -1 (em -Z) ou 0 quando nem um nem outro
   * sinal se decide — aí quem chama assume +Z e AVISA.
   */
  function ladoDaCabeca(obj) {
    var FATIAS = 24;
    var b = caixa(obj);
    var z0 = b.min.z, L = b.max.z - z0;
    if (!(L > 0)) return 0;
    var larguras = new Float32Array(FATIAS);
    var v = new THREE.Vector3();
    var somaZ = 0, n = 0;

    obj.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      var pos = o.geometry.attributes.position;
      o.updateWorldMatrix(true, false);
      // Amostra: um corpo tem dezenas de milhares de vértices e não é preciso
      // ler todos para achar o ombro.
      var passo = Math.max(1, Math.floor(pos.count / 4000));
      for (var i = 0; i < pos.count; i += passo) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        var f = Math.min(FATIAS - 1, Math.floor(((v.z - z0) / L) * FATIAS));
        var d = Math.abs(v.x);
        if (d > larguras[f]) larguras[f] = d;
        somaZ += v.z; n++;
      }
    });
    if (!n) return 0;

    var maxLargura = 0, k;
    for (k = 0; k < FATIAS; k++) if (larguras[k] > maxLargura) maxLargura = larguras[k];

    if (maxLargura > 0) {
      // Centro da faixa larga, e não a primeira fatia que empata no máximo.
      var soma = 0, peso = 0;
      for (k = 0; k < FATIAS; k++) {
        if (larguras[k] >= maxLargura * 0.9) { soma += k + 0.5; peso++; }
      }
      var rel = (soma / peso) / FATIAS;   // 0 = ponta -Z, 1 = ponta +Z
      if (rel > 0.56) return 1;
      if (rel < 0.44) return -1;
    }

    // Empatou na largura: o centro de massa desempata.
    var relMassa = ((somaZ / n) - z0) / L;
    if (relMassa > 0.53) return 1;
    if (relMassa < 0.47) return -1;
    return 0;
  }

  /**
   * Põe o modelo no sistema de coordenadas que a sala espera.
   * @returns {{meiaEspessuraM: number, comprimentoM: number, larguraM: number,
   *            escala: number, cabecaAssumida: boolean}}
   */
  function normalizar(obj, cfg) {
    var b = caixa(obj);
    var t = new THREE.Vector3();
    b.getSize(t);
    var dims = [
      { eixo: "x", v: t.x }, { eixo: "y", v: t.y }, { eixo: "z", v: t.z }
    ].sort(function (a, c) { return c.v - a.v; });

    var longo = dims[0].eixo;   // cabeça-pés
    var medio = dims[1].eixo;   // largura (ombros)
    var curto = dims[2].eixo;   // espessura (costas-peito)

    // Leva `longo` para Z, `medio` para X e `curto` para Y, com uma rotação
    // de eixos — nunca um espelhamento, que inverteria esquerda e direita do
    // paciente (e num exame isso não é detalhe).
    var envolve = new THREE.Group();
    envolve.add(obj);
    var m = new THREE.Matrix4();
    var col = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() };
    col[medio].set(1, 0, 0);  // eixo médio -> X
    col[curto].set(0, 1, 0);  // eixo curto -> Y
    col[longo].set(0, 0, 1);  // eixo longo -> Z
    m.makeBasis(col.x, col.y, col.z);
    // Se a base saiu com determinante negativo, a rotação virou espelho.
    // Inverte o eixo da largura para voltar a ser rotação pura.
    if (m.determinant() < 0) {
      col[medio].set(-1, 0, 0);
      m.makeBasis(col.x, col.y, col.z);
    }
    obj.applyMatrix4(m);

    // Rotação extra pedida no manifesto (graus, em torno de Z: o giro que
    // deita de bruços ou de lado um modelo exportado em outra convenção).
    if (cfg.girarGrausZ) {
      obj.applyMatrix4(new THREE.Matrix4().makeRotationZ(cfg.girarGrausZ * Math.PI / 180));
    }

    // Escala: comprimento total vira o pedido (1,70 m por padrão).
    var b2 = caixa(obj);
    var t2 = new THREE.Vector3(); b2.getSize(t2);
    var alvo = cfg.comprimentoM || COMPRIMENTO_PADRAO;
    var escala = t2.z > 0 ? (alvo / t2.z) : 1;
    obj.scale.multiplyScalar(escala);
    obj.updateMatrixWorld(true);

    // Cabeça para +Z.
    var lado = cfg.cabecaEm === "-z" ? -1 : (cfg.cabecaEm === "+z" ? 1 : ladoDaCabeca(obj));
    var assumida = (lado === 0);
    if (lado < 0) {
      obj.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
    }

    // Origem: centro em X e Z, base encostada em Y = 0 (o plano do tampo).
    var b3 = caixa(obj);
    var c = new THREE.Vector3(); b3.getCenter(c);
    obj.position.x -= c.x;
    obj.position.z -= c.z;
    obj.position.y -= b3.min.y;
    if (cfg.deslocarM) {
      obj.position.x += cfg.deslocarM[0] || 0;
      obj.position.y += cfg.deslocarM[1] || 0;
      obj.position.z += cfg.deslocarM[2] || 0;
    }
    obj.updateMatrixWorld(true);

    var bf = caixa(obj);
    var tf = new THREE.Vector3(); bf.getSize(tf);
    envolve.remove(obj);

    return {
      comprimentoM: tf.z,
      larguraM: tf.x,
      meiaEspessuraM: cfg.meiaEspessuraM || (tf.y / 2),
      escala: escala,
      cabecaAssumida: assumida
    };
  }

  function buscarJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      return r.ok ? r.json() : null;
    }).catch(function () { return null; });
  }

  /**
   * O GLB de paciente exportado pelo projeto separa cada braço em nós .arm.L
   * e .arm.R. Reagrupamos suas partes para poder deslocar o braço dependente
   * como uma unidade no decúbito lateral, sem deformar o resto do corpo.
   */
  function agruparBracos(obj) {
    var grupos = { L: new THREE.Group(), R: new THREE.Group() };
    grupos.L.name = "braco-importado.L";
    grupos.R.name = "braco-importado.R";
    var encontrou = { L: false, R: false };
    var filhos = obj.children.slice();

    filhos.forEach(function (filho) {
      var lado = /\.arm\.([LR])$/.exec(filho.name || "");
      if (!lado) return;
      var grupo = grupos[lado[1]];
      grupo.add(filho);
      encontrou[lado[1]] = true;
    });

    ["L", "R"].forEach(function (lado) {
      if (!encontrou[lado]) return;
      obj.add(grupos[lado]);
      grupos[lado].userData.posicaoRepouso = grupos[lado].position.clone();
    });
    return encontrou.L && encontrou.R ? grupos : null;
  }

  function restaurarBracos(bracos) {
    if (!bracos) return;
    [bracos.L, bracos.R].forEach(function (braco) {
      if (!braco || !braco.userData.posicaoRepouso) return;
      braco.position.copy(braco.userData.posicaoRepouso);
    });
  }

  /**
   * Em lateral, o braço dependente ficava preso entre o tronco e a mesa. Ele
   * passa para o lado superior, alinhado ao outro braço e com folga mínima,
   * para ambos seguirem visíveis e fora do colchão. Em dorsal/ventral a pose
   * exportada é restaurada sem qualquer deslocamento.
   */
  function ajustarBracosNoLateral(corpo, pose, eLateral) {
    var bracos = corpo.userData.bracosImportados;
    restaurarBracos(bracos);
    if (!bracos || !eLateral) return;

    pose.updateMatrixWorld(true);
    var caixaL = caixa(bracos.L);
    var caixaR = caixa(bracos.R);
    var centroL = caixaL.getCenter(new THREE.Vector3());
    var centroR = caixaR.getCenter(new THREE.Vector3());
    var inferior = centroL.y <= centroR.y ? bracos.L : bracos.R;
    var superior = inferior === bracos.L ? bracos.R : bracos.L;
    var caixaInferior = inferior === bracos.L ? caixaL : caixaR;
    var caixaSuperior = superior === bracos.L ? caixaL : caixaR;
    var centroInferior = caixaInferior.getCenter(new THREE.Vector3());
    var centroSuperior = caixaSuperior.getCenter(new THREE.Vector3());

    // Translada no mundo para o lado superior. O pequeno avanço longitudinal
    // evita que as duas malhas coincidam exatamente uma sobre a outra.
    var destinoMundo = inferior.getWorldPosition(new THREE.Vector3());
    destinoMundo.y += (centroSuperior.y - centroInferior.y) + 0.035;
    destinoMundo.z += 0.08;
    inferior.parent.worldToLocal(destinoMundo);
    inferior.position.copy(destinoMundo);
    pose.updateMatrixWorld(true);
  }

  /**
   * Tenta trocar a figura procedural pelo modelo da pasta.
   *
   * Nunca rejeita: um problema vira um relatório, e a figura procedural fica.
   *
   * @param {THREE.Group} corpo   o grupo `patient` montado por paciente.js
   * @returns {Promise<{trocou: boolean, motivo?: string, avisos: string[],
   *                    medidas?: object, credito?: string}>}
   */
  function tentarImportar(corpo) {
    var avisos = [];
    return fetch(MODELO, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) {
        // 404 é o caso NORMAL: quem não pôs modelo na pasta não tem erro nenhum.
        return { trocou: false, motivo: "sem modelo em " + MODELO, avisos: [] };
      }
      return Promise.all([r.arrayBuffer(), buscarJSON(MANIFESTO)]).then(function (par) {
        var buffer = par[0], cfg = par[1] || {};
        var lido = SimTC.Sala3D.lerGLB(buffer);
        avisos = avisos.concat(lido.avisos);

        var medidas = normalizar(lido.objeto, cfg);
        if (medidas.cabecaAssumida) {
          avisos.push('não deu para deduzir o lado da cabeça pela forma do corpo; ' +
            'foi assumido +Z. Se ficou de cabeça para baixo, ponha "cabecaEm": "-z" no paciente.json.');
        }

        // A troca só acontece agora, com o modelo já medido e posto de pé:
        // se qualquer coisa acima falhasse, a figura procedural continuaria
        // na tela em vez de sumir e deixar a mesa vazia.
        while (corpo.children.length) corpo.remove(corpo.children[0]);
        corpo.add(lido.objeto);
        corpo.userData.bracosImportados = agruparBracos(lido.objeto);

        return {
          trocou: true, avisos: avisos, medidas: medidas,
          credito: cfg.credito || cfg.fonte || ""
        };
      });
    }).catch(function (e) {
      return {
        trocou: false,
        motivo: (e && e.message) || String(e),
        avisos: avisos
      };
    });
  }

  window.SimTC = window.SimTC || {};
  SimTC.Sala3D = window.SimTC.Sala3D || {};
  SimTC.Sala3D.tentarImportarPaciente = tentarImportar;
  SimTC.Sala3D.ajustarBracosNoLateral = ajustarBracosNoLateral;
  SimTC.Sala3D.PASTA_PACIENTE = PASTA;

})();
