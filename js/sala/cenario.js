/**
 * js/sala/cenario.js
 * A sala de exame: piso, paredes, teto, porta, janela do comando e mobilia.
 *
 * Sai de js/sala-exame.js na ETAPA 6. Eram 240 linhas de CENOGRAFIA dentro da
 * funcao de 1.818 linhas que tambem roda a fisica da mesa, os lasers, os
 * controles e o laco de render. Nada aqui muda depois de construido, e nada
 * fora daqui referencia o que este bloco cria — conferido antes de mover: das
 * duas dezenas de nomes que ele define, nenhum e usado adiante.
 *
 * Constroi e pendura tudo na cena. Nao devolve nada porque nao ha o que
 * comandar depois: uma parede nao tem estado.
 *
 * Depende so de THREE. Script classico; carrega antes de js/sala-exame.js.
 */
(function () {
  "use strict";

  /**
   * Monta a sala inteira na cena.
   * @param {THREE.Scene} scene
   */
  function montarSala(scene) {
  // -----------------------------------------------------------
  // Sala clínica (piso vinílico, paredes off-white com rodapé,
  // janela da sala de comando, porta e luminárias embutidas)
  // -----------------------------------------------------------
  var ROOM_W = 6.2, ROOM_D = 6.2, ROOM_H = 3.2;

  // Piso vinílico granulado (speckled) como nas salas reais: base
  // cinza-azulada com granulado fino multicolorido, sem juntas.
  function vinylFloorTexture() {
    var size = 512;
    var cnv = document.createElement("canvas");
    cnv.width = cnv.height = size;
    var ctx = cnv.getContext("2d");
    ctx.fillStyle = "#aeb6bd";
    ctx.fillRect(0, 0, size, size);
    // Granulado fino denso (speckle)
    var speckles = ["rgba(255,255,255,0.5)", "rgba(140,150,160,0.5)", "rgba(90,100,112,0.4)", "rgba(190,198,205,0.5)"];
    for (var i = 0; i < 9000; i++) {
      ctx.fillStyle = speckles[i % speckles.length];
      var s = Math.random() < 0.85 ? 1 : 2;
      ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
    }
    var tex = new THREE.CanvasTexture(cnv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    return tex;
  }

  var floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_W, ROOM_D),
    new THREE.MeshStandardMaterial({ map: vinylFloorTexture(), roughness: 0.5, metalness: 0.04 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Paredes off-white
  var wallMat = new THREE.MeshStandardMaterial({ color: 0xeef0f0, roughness: 0.92 });

  var backWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), wallMat);
  backWall.position.set(0, ROOM_H / 2, -ROOM_D / 2);
  scene.add(backWall);

  var leftWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, ROOM_H), wallMat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-ROOM_W / 2, ROOM_H / 2, 0);
  scene.add(leftWall);

  var rightWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, ROOM_H), wallMat);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(ROOM_W / 2, ROOM_H / 2, 0);
  scene.add(rightWall);

  // Rodapé cinza nas três paredes (faixa fina na base)
  var skirtMat = new THREE.MeshStandardMaterial({ color: 0x9aa4ac, roughness: 0.6 });
  function skirt(w, x, z, rotY) {
    var s = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.12), skirtMat);
    s.position.set(x, 0.06, z);
    s.rotation.y = rotY;
    return s;
  }
  scene.add(skirt(ROOM_W, 0, -ROOM_D / 2 + 0.005, 0));
  scene.add(skirt(ROOM_D, -ROOM_W / 2 + 0.005, 0, Math.PI / 2));
  scene.add(skirt(ROOM_D, ROOM_W / 2 - 0.005, 0, -Math.PI / 2));

  // Janela da sala de comando (parede esquerda): vidro escuro com
  // moldura, como nas salas de TC reais (o operador observa por ela).
  var winFrame = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 1.0),
    new THREE.MeshStandardMaterial({ color: 0x4a545c, roughness: 0.5 })
  );
  winFrame.rotation.y = Math.PI / 2;
  winFrame.position.set(-ROOM_W / 2 + 0.01, 1.5, 1.2);
  scene.add(winFrame);
  var winGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.56, 0.86),
    new THREE.MeshStandardMaterial({ color: 0x1a2630, roughness: 0.15, metalness: 0.4 })
  );
  winGlass.rotation.y = Math.PI / 2;
  winGlass.position.set(-ROOM_W / 2 + 0.02, 1.5, 1.2);
  scene.add(winGlass);

  // Porta (parede esquerda, mais ao fundo): madeira clara com moldura.
  var doorFrame = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 2.15),
    new THREE.MeshStandardMaterial({ color: 0x5a636b, roughness: 0.6 })
  );
  doorFrame.rotation.y = Math.PI / 2;
  doorFrame.position.set(-ROOM_W / 2 + 0.01, 2.15 / 2, -1.6);
  scene.add(doorFrame);
  var door = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 2.05),
    new THREE.MeshStandardMaterial({ color: 0xa87d4f, roughness: 0.65 })
  );
  door.rotation.y = Math.PI / 2;
  door.position.set(-ROOM_W / 2 + 0.02, 2.05 / 2, -1.6);
  scene.add(door);

  // Teto branco com luminárias retangulares embutidas (emissivas).
  var ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), new THREE.MeshStandardMaterial({ color: 0xf5f7f9, roughness: 1 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM_H;
  scene.add(ceiling);

  var lightPanelMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xf4f8fc, emissiveIntensity: 0.9, roughness: 0.3,
  });
  function ceilingLight(x, z) {
    var panel = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), lightPanelMat);
    panel.rotation.x = Math.PI / 2;
    panel.position.set(x, ROOM_H - 0.01, z);
    return panel;
  }
  scene.add(ceilingLight(-1.5, -1.5));
  scene.add(ceilingLight(1.5, -1.5));
  scene.add(ceilingLight(-1.5, 1.5));
  scene.add(ceilingLight(1.5, 1.5));

  // -----------------------------------------------------------
  // Detalhes da sala (fiéis à foto de referência)
  // -----------------------------------------------------------
  // Faixa de proteção (bump rail) cinza nas paredes, a ~90 cm.
  var railMat = new THREE.MeshStandardMaterial({ color: 0xaab3ba, roughness: 0.55 });
  function bumpRail(w, x, z, rotY) {
    var r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.10, 0.02), railMat);
    r.position.set(x, 0.92, z);
    r.rotation.y = rotY;
    return r;
  }
  scene.add(bumpRail(ROOM_W, 0, -ROOM_D / 2 + 0.012, 0));
  scene.add(bumpRail(ROOM_D, ROOM_W / 2 - 0.012, 0, Math.PI / 2));

  // Cartaz "Patient Safety" na parede esquerda (entre janela e porta).
  var posterCnv = document.createElement("canvas");
  posterCnv.width = 128; posterCnv.height = 170;
  var pctx = posterCnv.getContext("2d");
  pctx.fillStyle = "#ffffff"; pctx.fillRect(0, 0, 128, 170);
  pctx.fillStyle = "#2a5fa8"; pctx.fillRect(0, 0, 128, 26);
  pctx.fillStyle = "#ffffff"; pctx.font = "bold 11px sans-serif";
  pctx.fillText("PATIENT SAFETY", 14, 17);
  pctx.fillStyle = "#8a949e";
  for (var li = 0; li < 9; li++) pctx.fillRect(10, 38 + li * 13, 106 - (li % 3) * 18, 4);
  var posterTex = new THREE.CanvasTexture(posterCnv);
  var poster = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.56),
    new THREE.MeshStandardMaterial({ map: posterTex, roughness: 0.85 })
  );
  poster.rotation.y = Math.PI / 2;
  poster.position.set(-ROOM_W / 2 + 0.015, 1.72, -0.15);
  scene.add(poster);

  // Painel de parede com botões de emergência (vermelho/verde).
  var wallPanel = new THREE.Group();
  var panelPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.30, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xc9d0d6, roughness: 0.4, metalness: 0.5 })
  );
  wallPanel.add(panelPlate);
  var redBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.02, 16),
    new THREE.MeshStandardMaterial({ color: 0xd6362e, emissive: 0x5a0f0c, emissiveIntensity: 0.4 }));
  redBtn.rotation.x = Math.PI / 2;
  redBtn.position.set(0, 0.07, 0.015);
  wallPanel.add(redBtn);
  var greenBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.02, 16),
    new THREE.MeshStandardMaterial({ color: 0x2fae4e, emissive: 0x0d3a19, emissiveIntensity: 0.4 }));
  greenBtn.rotation.x = Math.PI / 2;
  greenBtn.position.set(0, -0.03, 0.015);
  wallPanel.add(greenBtn);
  wallPanel.rotation.y = Math.PI / 2;
  wallPanel.position.set(-ROOM_W / 2 + 0.02, 1.35, 0.35);
  scene.add(wallPanel);

  // Monitor pequeno ao lado da janela de comando.
  var monitorScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x3a7bd5, emissive: 0x1c3f73, emissiveIntensity: 0.7, roughness: 0.3 })
  );
  monitorScreen.rotation.y = Math.PI / 2;
  monitorScreen.position.set(-ROOM_W / 2 + 0.03, 1.25, 2.15);
  scene.add(monitorScreen);
  var monitorFrame = new THREE.Mesh(
    new THREE.PlaneGeometry(0.48, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x2a2f34, roughness: 0.5 })
  );
  monitorFrame.rotation.y = Math.PI / 2;
  monitorFrame.position.set(-ROOM_W / 2 + 0.025, 1.25, 2.15);
  scene.add(monitorFrame);

  // Carrinho inox com gavetas azuis/brancas (canto direito, como na foto).
  var cart = new THREE.Group();
  var cartBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.75, 0.45),
    new THREE.MeshStandardMaterial({ color: 0xdfe4e8, roughness: 0.3, metalness: 0.6 })
  );
  cartBody.position.y = 0.45;
  cartBody.castShadow = true;
  cart.add(cartBody);
  var drawerBlue = new THREE.MeshStandardMaterial({ color: 0x2e6bc4, roughness: 0.5 });
  var drawerWhite = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.5 });
  for (var dr = 0; dr < 3; dr++) {
    var d1 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.02), drawerBlue);
    d1.position.set(-0.13, 0.68 - dr * 0.20, 0.235);
    cart.add(d1);
    var d2 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.02), drawerWhite);
    d2.position.set(0.13, 0.68 - dr * 0.20, 0.235);
    cart.add(d2);
  }
  // Rodinhas
  for (var wx = -1; wx <= 1; wx += 2) {
    for (var wz = -1; wz <= 1; wz += 2) {
      var wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 12),
        new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.6 }));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx * 0.22, 0.04, wz * 0.16);
      cart.add(wheel);
    }
  }
  cart.position.set(ROOM_W / 2 - 0.55, 0, -2.2);
  cart.rotation.y = -Math.PI / 2;
  scene.add(cart);

  // Cesto de roupa hospitalar azul (hamper) ao lado do carrinho.
  var hamper = new THREE.Group();
  var hamperBag = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.20, 0.62, 12),
    new THREE.MeshStandardMaterial({ color: 0x3f7fd4, roughness: 0.9 })
  );
  hamperBag.position.y = 0.45;
  hamperBag.castShadow = true;
  hamper.add(hamperBag);
  var hamperRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.015, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0xb9c1c8, roughness: 0.4, metalness: 0.6 })
  );
  hamperRim.rotation.x = Math.PI / 2;
  hamperRim.position.y = 0.76;
  hamper.add(hamperRim);
  hamper.position.set(ROOM_W / 2 - 0.4, 0, -1.35);
  scene.add(hamper);
  }

  window.SimTC = window.SimTC || {};
  SimTC.Sala3D = window.SimTC.Sala3D || {};
  SimTC.Sala3D.montarSala = montarSala;

})();
