/**
 * js/sala/paciente.js
 * A figura do paciente: corpo, avental, membros e o grupo que a mesa carrega.
 *
 * Sai de js/sala-exame.js na ETAPA 6. E geometria e textura — nao decide nada
 * sobre o exame. O ESTADO de posicionamento (`patientPlaced`, decubito,
 * entrada no gantry) fica na sala, porque e estado; aqui so se constroi.
 *
 * Devolve o que a sala precisa comandar depois:
 *   patient          o corpo, transferido entre o chao e a mesa
 *   patientPose      o grupo preso a mesa, que recebe decubito e entrada
 *   patientStanding  o grupo no piso, onde ele espera antes de deitar
 *   TORSO_R          raio do torso, usado no calculo do isocentro
 *
 * Depende de THREE. Script classico; carrega antes de js/sala-exame.js.
 */
(function () {
  "use strict";

  /**
   * Constroi a figura e a pendura na cena e na mesa.
   * @param {THREE.Scene} scene
   * @param {THREE.Group} tableGroup  grupo da mesa, que carrega o paciente
   * @returns {{patient: THREE.Group, patientPose: THREE.Group,
   *            patientStanding: THREE.Group, TORSO_R: number}}
   */
  function montarPaciente(scene, tableGroup) {
  // Paciente — figura simplificada (apenas para referência visual de
  // posicionamento; decúbitos serão selecionáveis em etapa futura).
  // Comprimento total ~1.7 m, da cabeça (+) aos pés (-), cabendo
  // inteira dentro do tampo da mesa (1.95 m).
  //
  // Espessura considerada: adulto médio em decúbito dorsal ≈ 24 cm
  // (raio do torso ~0.12 m). O paciente repousa SOBRE o tampo: as
  // costas tocam o tampo e o corpo se estende para cima. Assim o
  // centro do corpo fica ~12 cm acima do tampo — por isso, para
  // centralizar o paciente no isocentro (80 cm), o operador desce a
  // mesa até o tampo ficar em ~66 cm (comportamento realista).
  var patient = new THREE.Group();

  // Caminho A: mantém o corpo procedural (primitivas) e melhora só
  // materiais/suavidade. Bump map sutil de ruído (canvas 128px, custo
  // de GPU desprezível) dá micro-sombreado à pele, tirando o aspecto
  // "plástico liso" das esferas/cilindros.
  function skinBump() {
    var cnv = document.createElement("canvas");
    cnv.width = cnv.height = 128;
    var ctx = cnv.getContext("2d");
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, 128, 128);
    for (var i = 0; i < 2600; i++) {
      var v = Math.round(128 + (Math.random() - 0.5) * 46);
      ctx.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 1, 1);
    }
    var tex = new THREE.CanvasTexture(cnv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
  }
  var skin = new THREE.MeshStandardMaterial({
    color: 0xe8be97,
    roughness: 0.62,
    metalness: 0.0,
    bumpMap: skinBump(),
    bumpScale: 0.006
  });

  // Avental hospitalar estampado (azul-claro com padrão de pontinhos),
  // gerado via canvas — como o avental da foto de referência.
  function gownTexture() {
    var cnv = document.createElement("canvas");
    cnv.width = cnv.height = 128;
    var ctx = cnv.getContext("2d");
    ctx.fillStyle = "#dfe6f2";
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = "#7f93b8";
    for (var y = 0; y < 8; y++) {
      for (var x = 0; x < 8; x++) {
        var ox = (y % 2) * 8;
        ctx.beginPath();
        ctx.arc(x * 16 + 8 + ox, y * 16 + 8, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    var tex = new THREE.CanvasTexture(cnv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    return tex;
  }
  var scrub = new THREE.MeshStandardMaterial({ map: gownTexture(), roughness: 0.9 });
  var hairMat = new THREE.MeshStandardMaterial({ color: 0x2e2620, roughness: 0.85 });
  var sockMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.8 });

  var TORSO_R = 0.12; // raio do torso — espessura ~24 cm

  // Cabeça com pescoço.
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.091, 32, 24), skin);
  head.scale.set(0.93, 1.06, 1.0); // rosto mais estreito e ovalado
  head.position.set(0, TORSO_R, 0.76);
  patient.add(head);
  // Queixo/mandíbula sutil, para dar forma ao rosto sem cair no "uncanny".
  var jaw = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 18), skin);
  jaw.scale.set(0.9, 0.75, 0.95);
  jaw.position.set(0, TORSO_R - 0.03, 0.775);
  patient.add(jaw);
  var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.04, 0.09, 16), skin);
  neck.rotation.x = Math.PI / 2;
  neck.position.set(0, TORSO_R - 0.01, 0.67);
  patient.add(neck);

  // Cabelo escuro, preso num coque baixo — que é como o cabelo entra numa
  // sala de TC: para trás, fora do campo, sem presilha de metal.
  var hairCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.101, 22, 18, 0, Math.PI * 2, 0, Math.PI * 0.58),
    hairMat
  );
  hairCap.position.copy(head.position);
  hairCap.rotation.x = -Math.PI / 2.4;
  patient.add(hairCap);
  // Mechas caindo AO LADO da cabeça — não sobre o rosto.
  //
  // A primeira tentativa punha as mechas em `TORSO_R + 0.012`, acima do
  // centro da cabeça. Deitado, +Y é o lado do ROSTO: elas atravessavam a
  // face na altura dos olhos. Descem para abaixo do plano do rosto e recuam
  // para trás da orelha, que é onde cabelo preso fica.
  var mechaL = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 12), hairMat);
  mechaL.scale.set(0.52, 0.85, 1.35);
  mechaL.position.set(-0.076, TORSO_R - 0.028, 0.788);
  patient.add(mechaL);
  var mechaR = mechaL.clone();
  mechaR.position.x = 0.076;
  patient.add(mechaR);
  var hairBun = new THREE.Mesh(new THREE.SphereGeometry(0.043, 18, 14), hairMat);
  hairBun.scale.set(1, 0.85, 0.9);
  hairBun.position.set(0, TORSO_R - 0.028, 0.76 + 0.088);
  patient.add(hairBun);

  // -----------------------------------------------------------------
  // PROPORÇÃO FEMININA
  //
  // O que distingue uma silhueta feminina de uma masculina não é um detalhe
  // solto: é a RELAÇÃO entre três larguras. No adulto médio,
  //
  //            biacromial (ombro)   bi-ilíaca (quadril)
  //   mulher         ~36 cm                ~36 cm        ombro ≈ quadril
  //   homem          ~40 cm                ~34 cm        ombro > quadril
  //
  // e a cintura marca mais no meio. O tronco por isso deixou de ser um cone
  // só e virou três segmentos — tórax, cintura, quadril — com a cintura
  // estreitando e o quadril voltando à largura do ombro.
  //
  // A ESPESSURA (TORSO_R, no eixo Y) não muda, e é de propósito: ela é o
  // número que ensina a descer a mesa até o isocentro. O que muda é a
  // largura, que o exame não usa para nada.
  // -----------------------------------------------------------------
  var OMBRO_X = 1.20;    // fator de largura do tórax
  var CINTURA_X = 1.02;  // a cintura marca
  var QUADRIL_X = 1.34;  // e o quadril volta a abrir

  // -----------------------------------------------------------------
  // TRONCO EM UMA MALHA SO
  //
  // Eram QUATRO cilindros coaxiais encostados topo a topo — torax, cintura,
  // quadril e saia — cada um com `scale.x` proprio: 1,20 / 1,02 / 1,34 / 1,30.
  // Como a largura pulava de um para o outro (31% do quadril para a cintura),
  // as superficies nao se encontravam: em cada junta ficava um degrau e a
  // TAMPA CHATA do cilindro de tras, virada para fora. Mais duas esferas de
  // busto encostadas por dentro, coincidentes com a parede do torax.
  //
  // Enquanto a sala estourava, isso nao aparecia: tudo saturava no mesmo
  // branco e as emendas sumiam junto. Assim que a luz ganhou direcao e parou
  // de cortar, cada peca passou a sombrear por conta propria e o corpo virou
  // uma pilha de tubos sobrepostos. O defeito e antigo; a luz so o revelou.
  //
  // Agora e uma superficie unica, interpolada entre ESTACOES ao longo do eixo
  // do corpo. Cada estacao e uma elipse — raio em Y (a espessura) e um fator
  // em X (a largura) — entao a mesma malha continua faz ombro largo, cintura
  // marcada e quadril aberto sem nenhuma junta.
  //
  // A ESPESSURA nao muda de proposito: e ela que ensina a descer a mesa ate o
  // isocentro. O que varia entre estacoes e a largura, que o exame nao usa.
  // -----------------------------------------------------------------
  var OMBRO_X = 1.28;    // fator de largura na linha do ombro
  var CINTURA_X = 1.01;  // a cintura marca
  var QUADRIL_X = 1.34;  // e o quadril volta a abrir

  //             z       raioY   fatorX      yEixo
  var ESTACOES = [
    [ 0.640,     0.020,  1.00,       0.112 ],  // fecha junto ao pescoco
    [ 0.612,     0.062,  1.02,       0.112 ],
    [ 0.585,     0.092,  1.16,       0.110 ],
    [ 0.552,     0.106,  OMBRO_X,    0.110 ],  // ombro
    [ 0.500,     0.115,  1.24,       0.110 ],
    [ 0.452,     0.119,  1.20,       0.111 ],  // busto
    [ 0.400,     0.117,  1.14,       0.110 ],
    [ 0.340,     0.112,  1.06,       0.109 ],
    [ 0.280,     0.108,  CINTURA_X,  0.108 ],  // cintura
    [ 0.220,     0.111,  1.08,       0.108 ],
    [ 0.160,     0.117,  1.20,       0.108 ],
    [ 0.090,     0.123,  1.31,       0.107 ],  // quadril
    [ 0.010,     0.126,  QUADRIL_X,  0.107 ],
    [-0.080,     0.128,  1.33,       0.106 ],
    [-0.170,     0.129,  1.30,       0.106 ],
    [-0.250,     0.126,  1.25,       0.106 ],  // barra da camisola
    [-0.292,     0.108,  1.12,       0.106 ],
    [-0.308,     0.055,  1.00,       0.106 ],
    [-0.315,     0.016,  1.00,       0.106 ]   // fecha a barra
  ];

  /**
   * Costura as estacoes numa superficie unica.
   *
   * As duas pontas fecham porque a primeira e a ultima estacao tem raio quase
   * zero: sem isso o tubo ficaria aberto e, com as faces de tras descartadas,
   * apareceria um buraco no pescoco e na barra.
   */
  function malhaPorEstacoes(estacoes, segmentos) {
    var pos = [], uv = [], idx = [];
    var aneis = estacoes.length;
    for (var e = 0; e < aneis; e++) {
      var st = estacoes[e];
      for (var v = 0; v <= segmentos; v++) {
        var a = (v / segmentos) * Math.PI * 2;
        pos.push(Math.cos(a) * st[1] * st[2], st[3] + Math.sin(a) * st[1], st[0]);
        uv.push(v / segmentos, e / (aneis - 1));
      }
    }
    for (var e2 = 0; e2 < aneis - 1; e2++) {
      for (var v2 = 0; v2 < segmentos; v2++) {
        var a0 = e2 * (segmentos + 1) + v2;
        var b0 = a0 + segmentos + 1;
        idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();   // normais medias nas juntas: sem quina falsa
    return g;
  }

  var tronco = new THREE.Mesh(malhaPorEstacoes(ESTACOES, 40), scrub);
  tronco.castShadow = true;
  tronco.receiveShadow = true;
  patient.add(tronco);

  function limb(r, l, x, y, z, mat, r2) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(r, (r2 !== undefined ? r2 : r * 0.85), l, 16), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    return m;
  }
  // Braços — de pele (manga curta), rentes ao tronco, que agora é mais estreito.
  patient.add(limb(0.031, 0.46, -0.168, TORSO_R * 0.72, 0.33, skin, 0.024));
  patient.add(limb(0.031, 0.46, 0.168, TORSO_R * 0.72, 0.33, skin, 0.024));
  // Mãos (pequenas esferas).
  var handL = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 10), skin);
  handL.position.set(-0.168, TORSO_R * 0.72, 0.08);
  patient.add(handL);
  var handR = handL.clone();
  handR.position.x = 0.168;
  patient.add(handR);
  // Pernas — de pele, do joelho (fim do avental) até o tornozelo,
  // com panturrilha (mais grossa em cima) e juntas, como se deita.
  patient.add(limb(0.044, 0.42, -0.066, TORSO_R * 0.75, -0.42, skin, 0.027));
  patient.add(limb(0.044, 0.42, 0.066, TORSO_R * 0.75, -0.42, skin, 0.027));
  // Meias brancas nos pés (com "pezinho" apontando para cima quando deitada).
  patient.add(limb(0.034, 0.10, -0.066, TORSO_R * 0.75, -0.68, sockMat, 0.031));
  patient.add(limb(0.034, 0.10, 0.066, TORSO_R * 0.75, -0.68, sockMat, 0.031));
  var footL = new THREE.Mesh(new THREE.SphereGeometry(0.041, 14, 10), sockMat);
  footL.scale.set(0.8, 1.3, 0.8);
  footL.position.set(-0.066, TORSO_R * 0.85, -0.73);
  patient.add(footL);
  var footR = footL.clone();
  footR.position.x = 0.066;
  patient.add(footR);

  // O paciente repousa sobre o topo do tampo (tampo tem 0.04 de
  // espessura, então topo em +0.02 em relação ao centro da mesa).
  // As costas ficam nesse plano; o corpo se estende para cima.
  // O corpo (patient) fica dentro de um grupo de pose (patientPose)
  // que aplica as rotações de decúbito e de entrada sem tocar na
  // montagem interna do corpo. O offset de +0.02 (repouso sobre o
  // tampo) fica no patient; o patientPose só rotaciona.
  patient.position.set(0, 0.02, 0);

  var patientPose = new THREE.Group();
  tableGroup.add(patientPose);

  // Grupo "em pé": posiciona o paciente de pé ao lado da mesa (estado
  // inicial "aguardando"). Fica ao lado do aparelho, no piso. Quando um
  // decúbito é selecionado, o corpo é transferido para a mesa.
  var patientStanding = new THREE.Group();
  // Ao lado da mesa (eixo X negativo = lado de embarque), no piso.
  patientStanding.position.set(-0.95, 0, 0.9);
  scene.add(patientStanding);

    return { patient: patient, patientPose: patientPose,
             patientStanding: patientStanding, TORSO_R: TORSO_R };
  }

  window.SimTC = window.SimTC || {};
  SimTC.Sala3D = window.SimTC.Sala3D || {};
  SimTC.Sala3D.montarPaciente = montarPaciente;

})();
