/**
 * js/sala/gantry.js
 * O gantry: corpo, bore, aneis da face, paineis de comando e o arco que gira.
 *
 * Sai de js/sala-exame.js na ETAPA 6, junto com o cenario e o paciente. As
 * tres extracoes seguem a mesma regra: o que se CONSTROI sai; o que se
 * COMANDA fica.
 *
 * Por isso `spinRotTime` — o tempo de rotacao corrente do arco — ficou na
 * sala: e estado de animacao, escrito por setScan() e lido pelo laco de
 * render. So o arco em si vem daqui.
 *
 * Devolve o que a sala precisa depois:
 *   gantryGroup     o conjunto, que recebe o tilt do protocolo
 *   spinArc         o arco de varredura, girado pelo laco de render
 *   GANTRY_FACE_Z   Z do plano de entrada — onde ficam os lasers
 *   ISO_Y           altura do isocentro, base do calculo de alinhamento
 *   BORE_R          raio do bore — de onde partem os tres lasers
 *
 * Depende de THREE. Script classico; carrega antes de js/sala-exame.js.
 */
(function () {
  "use strict";

  /**
   * Constroi o gantry e o pendura na cena.
   * @param {THREE.Scene} scene
   * @returns {{gantryGroup: THREE.Group, spinArc: THREE.Mesh,
   *            GANTRY_FACE_Z: number, ISO_Y: number, BORE_R: number}}
   */
  function montarGantry(scene) {
  // -----------------------------------------------------------
  // Gantry — modelo realista inspirado no Somatom Definition Edge:
  //   • Corpo branco com cantos superiores arredondados (Shape com arcos)
  //   • Moldura circular em degraus ao redor do bore
  //   • Display azul no topo da face + painéis de botões nas laterais
  //   • Base/rodapé cinza
  // Parâmetros críticos preservados: BORE_R, ISO_Y, GANTRY_FACE_Z e a
  // posição Z=-0.6 (nada que afete laser, limites ou isocentro muda).
  // -----------------------------------------------------------
  var gantryGroup = new THREE.Group();
  scene.add(gantryGroup);

  var GW = 2.0, GH = 1.9, GDEPTH = 0.85, BORE_R = 0.40; // bore de 80cm de diâmetro
  var ISO_Y = 0.80; // altura do isocentro
  var GANTRY_FACE_Z = -0.6 + GDEPTH / 2 + 0.005; // Z do plano de entrada (face do gantry / lasers)

  var matGantryWhite = new THREE.MeshStandardMaterial({ color: 0xf6f8fa, roughness: 0.32, metalness: 0.08 });
  var matGantryGrey = new THREE.MeshStandardMaterial({ color: 0xcfd6dc, roughness: 0.45, metalness: 0.1 });
  var matGantryDark = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.5, metalness: 0.15 });

  // Corpo principal: contorno com cantos superiores bem arredondados
  // (raio grande, estilo "capuz" do Somatom) e cantos inferiores suaves.
  var RB = 0.10;  // raio dos cantos inferiores
  var RT = 0.55;  // raio dos cantos superiores (curva grande)
  var gShape = new THREE.Shape();
  gShape.moveTo(-GW / 2 + RB, -GH / 2);
  gShape.lineTo(GW / 2 - RB, -GH / 2);
  gShape.quadraticCurveTo(GW / 2, -GH / 2, GW / 2, -GH / 2 + RB);
  gShape.lineTo(GW / 2, GH / 2 - RT);
  gShape.quadraticCurveTo(GW / 2, GH / 2, GW / 2 - RT, GH / 2);
  gShape.lineTo(-GW / 2 + RT, GH / 2);
  gShape.quadraticCurveTo(-GW / 2, GH / 2, -GW / 2, GH / 2 - RT);
  gShape.lineTo(-GW / 2, -GH / 2 + RB);
  gShape.quadraticCurveTo(-GW / 2, -GH / 2, -GW / 2 + RB, -GH / 2);
  var holePath = new THREE.Path();
  holePath.absarc(0, 0, BORE_R, 0, Math.PI * 2, false);
  gShape.holes.push(holePath);

  var gGeo = new THREE.ExtrudeGeometry(gShape, {
    depth: GDEPTH, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 4, curveSegments: 64,
  });
  gGeo.translate(0, 0, -GDEPTH / 2);
  var gantryBody = new THREE.Mesh(gGeo, matGantryWhite);
  gantryBody.position.set(0, ISO_Y, -0.6);
  gantryBody.castShadow = true;
  gantryBody.receiveShadow = true;
  gantryGroup.add(gantryBody);

  // Revestimento interno do túnel (bore liner).
  var liner = new THREE.Mesh(
    new THREE.CylinderGeometry(BORE_R, BORE_R, GDEPTH * 0.98, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xe4e8ec, roughness: 0.45, side: THREE.BackSide })
  );
  liner.rotation.x = Math.PI / 2;
  liner.position.copy(gantryBody.position);
  gantryGroup.add(liner);

  // Moldura circular em degraus ao redor do bore (estilo Somatom):
  // dois anéis chatos concêntricos levemente salientes na face.
  function faceRing(innerR, outerR, zOffset, material) {
    var ringGeo = new THREE.RingGeometry(innerR, outerR, 64);
    var mesh = new THREE.Mesh(ringGeo, material);
    mesh.position.set(0, ISO_Y, -0.6 + GDEPTH / 2 + zOffset);
    return mesh;
  }
  gantryGroup.add(faceRing(BORE_R, BORE_R + 0.10, 0.012, matGantryGrey));
  gantryGroup.add(faceRing(BORE_R + 0.10, BORE_R + 0.22, 0.006, matGantryWhite));

  // Anel de acento ciano (mantido — identidade visual do simulador).
  var ring = new THREE.Mesh(
    new THREE.TorusGeometry(BORE_R + 0.045, 0.015, 12, 64),
    new THREE.MeshStandardMaterial({ color: 0x35c5e0, emissive: 0x0c5866, emissiveIntensity: 0.6, roughness: 0.4 })
  );
  ring.position.set(0, ISO_Y, -0.6 + GDEPTH / 2 + 0.015);
  gantryGroup.add(ring);

  // Arco de varredura helicoidal (ADITIVO): representa o conjunto
  // tubo+detectores girando dentro do bore durante a aquisição do
  // volume (no topograma o tubo fica ESTACIONÁRIO — arco parado/oculto).
  var spinArc = new THREE.Mesh(
    new THREE.TorusGeometry(BORE_R - 0.035, 0.02, 10, 40, Math.PI / 2.2),
    new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x35c5e0, emissiveIntensity: 1.4, roughness: 0.3, transparent: true, opacity: 0.9 })
  );
  spinArc.position.set(0, ISO_Y, -0.6 + GDEPTH / 2 - 0.06); // logo atrás da face, dentro do túnel
  spinArc.visible = false;
  gantryGroup.add(spinArc);

  // Display azul no topo da face (como o painel do Somatom).
  var displayScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x2a6fd4, emissive: 0x1a4b9c, emissiveIntensity: 0.8, roughness: 0.3 })
  );
  displayScreen.position.set(0, ISO_Y + BORE_R + 0.36, -0.6 + GDEPTH / 2 + 0.008);
  gantryGroup.add(displayScreen);
  var displayFrame = new THREE.Mesh(
    new THREE.PlaneGeometry(0.38, 0.20),
    matGantryDark
  );
  displayFrame.position.set(0, ISO_Y + BORE_R + 0.36, -0.6 + GDEPTH / 2 + 0.006);
  gantryGroup.add(displayFrame);

  // Painéis de botões circulares nas laterais da face (visuais).
  function controlPanel(xSide) {
    var panelGroup = new THREE.Group();
    var plate = new THREE.Mesh(new THREE.CircleGeometry(0.085, 32), matGantryGrey);
    panelGroup.add(plate);
    // Botõezinhos ao redor de um central
    var btnMat = new THREE.MeshStandardMaterial({ color: 0xf0f3f5, emissive: 0x666e75, emissiveIntensity: 0.25, roughness: 0.4 });
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2;
      var b = new THREE.Mesh(new THREE.CircleGeometry(0.016, 16), btnMat);
      b.position.set(Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0.002);
      panelGroup.add(b);
    }
    var centerBtn = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16),
      new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0x7a5210, emissiveIntensity: 0.5, roughness: 0.4 }));
    centerBtn.position.z = 0.002;
    panelGroup.add(centerBtn);
    panelGroup.position.set(xSide * (BORE_R + 0.42), ISO_Y + 0.10, -0.6 + GDEPTH / 2 + 0.008);
    return panelGroup;
  }
  gantryGroup.add(controlPanel(-1));
  gantryGroup.add(controlPanel(1));

  // Luzes de status (vermelha pequena acima de cada painel, como na foto).
  function statusLed(xSide) {
    var led = new THREE.Mesh(new THREE.CircleGeometry(0.012, 12),
      new THREE.MeshStandardMaterial({ color: 0xff4444, emissive: 0x991111, emissiveIntensity: 0.7 }));
    led.position.set(xSide * (BORE_R + 0.42), ISO_Y + 0.26, -0.6 + GDEPTH / 2 + 0.008);
    return led;
  }
  gantryGroup.add(statusLed(-1));
  gantryGroup.add(statusLed(1));

  // Base/rodapé do gantry (faixa cinza inferior, assentando no piso).
  var gantryBase = new THREE.Mesh(
    new THREE.BoxGeometry(GW + 0.08, 0.16, GDEPTH + 0.10),
    matGantryDark
  );
  // A base fica sob o corpo: o corpo vai de ISO_Y-GH/2 até ISO_Y+GH/2;
  // o rodapé preenche do piso até a borda inferior do corpo.
  gantryBase.position.set(0, 0.08, -0.6);
  gantryBase.castShadow = true;
  gantryBase.receiveShadow = true;
  gantryGroup.add(gantryBase);

    return { gantryGroup: gantryGroup, spinArc: spinArc,
             GANTRY_FACE_Z: GANTRY_FACE_Z, ISO_Y: ISO_Y, BORE_R: BORE_R };
  }

  window.SimTC = window.SimTC || {};
  SimTC.Sala3D = window.SimTC.Sala3D || {};
  SimTC.Sala3D.montarGantry = montarGantry;

})();
