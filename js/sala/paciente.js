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

  // Ombros arredondados — mais estreitos e um pouco mais baixos.
  var shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), scrub);
  shoulderL.scale.set(1.05, 0.92, 1);
  shoulderL.position.set(-0.12, TORSO_R * 0.88, 0.575);
  patient.add(shoulderL);
  var shoulderR = shoulderL.clone();
  shoulderR.position.x = 0.12;
  patient.add(shoulderR);

  // Tórax, da linha dos ombros até abaixo do busto.
  var chest = new THREE.Mesh(new THREE.CylinderGeometry(TORSO_R - 0.004, TORSO_R, 0.24, 24), scrub);
  chest.scale.x = OMBRO_X;
  chest.rotation.x = Math.PI / 2;
  chest.position.set(0, TORSO_R * 0.92, 0.475);
  patient.add(chest);

  // Busto: duas calotas rasas SOB o avental — o tecido é o mesmo, e é assim
  // que aparece numa paciente de camisola, deitada.
  function seio(x) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(0.058, 18, 14), scrub);
    m.scale.set(1.0, 0.72, 1.05);
    m.position.set(x, TORSO_R * 1.06, 0.47);
    return m;
  }
  patient.add(seio(-0.062));
  patient.add(seio(0.062));

  // Cintura — o segmento que marca a silhueta.
  var waist = new THREE.Mesh(new THREE.CylinderGeometry(TORSO_R - 0.012, TORSO_R - 0.004, 0.16, 24), scrub);
  waist.scale.x = CINTURA_X;
  waist.rotation.x = Math.PI / 2;
  waist.position.set(0, TORSO_R * 0.9, 0.275);
  patient.add(waist);

  // Quadril — volta à largura do ombro, e um pouco além.
  var hip = new THREE.Mesh(new THREE.CylinderGeometry(TORSO_R + 0.004, TORSO_R - 0.012, 0.2, 24), scrub);
  hip.scale.x = QUADRIL_X;
  hip.rotation.x = Math.PI / 2;
  hip.position.set(0, TORSO_R * 0.9, 0.095);
  patient.add(hip);

  // Saia do avental: do quadril até os joelhos, com o caimento do tecido.
  var gownSkirt = new THREE.Mesh(new THREE.CylinderGeometry(TORSO_R + 0.012, TORSO_R + 0.004, 0.28, 24), scrub);
  gownSkirt.scale.x = 1.30;
  gownSkirt.rotation.x = Math.PI / 2;
  gownSkirt.position.set(0, TORSO_R * 0.88, -0.145);
  patient.add(gownSkirt);

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
