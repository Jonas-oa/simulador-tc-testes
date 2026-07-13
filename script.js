/**
 * script.js
 * Simulador Educacional de Tomografia Computadorizada — lógica principal.
 *
 * Script CLÁSSICO (sem "type=module", sem bundler). Depois de testar em
 * dispositivos reais, esta abordagem provou ser a mais confiável — ES
 * modules e import maps falhavam silenciosamente em alguns
 * navegadores/redes. THREE.js é carregado antes deste arquivo via
 * <script src="js/vendor/three.min.js"> (build vendorizado, variável
 * global `THREE`), então cada edição futura pode ser feita direto
 * neste arquivo, sem passo de build.
 *
 * Organização interna (tudo dentro de uma única IIFE para não vazar
 * variáveis globais):
 *   1) Tema claro/escuro
 *   2) Painel de mensagens
 *   3) Cena 3D (sala, gantry, mesa, paciente, laser)
 *   4) Câmera orbital manual (arrastar/zoom, sem dependências externas)
 *   5) Controles do console (mesa, laser, simulação) + física/intertravamento
 *   6) Loop de animação e atualização do HUD/display
 */
(function () {
  "use strict";

  // =================================================================
  // 1) TEMA CLARO/ESCURO
  // =================================================================
  var THEMES = ["dark", "light"];
  var currentTheme = "dark";

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.body.setAttribute("data-theme", theme);
    var metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute("content", theme === "dark" ? "#0a0e14" : "#e9edf2");
    }
  }

  function initTheme() {
    applyTheme(currentTheme);
    var toggleButton = document.getElementById("theme-toggle");
    if (toggleButton) {
      toggleButton.addEventListener("click", function () {
        var idx = THEMES.indexOf(currentTheme);
        currentTheme = THEMES[(idx + 1) % THEMES.length];
        applyTheme(currentTheme);
      });
    }
  }

  // =================================================================
  // 2) PAINEL DE MENSAGENS
  // =================================================================
  var MESSAGE_ICONS = { info: "ℹ", warning: "⚠", error: "⛔", success: "✔" };

  function showMessage(text, type) {
    type = type || "info";
    var el = document.getElementById("message-text");
    if (!el) return;
    var panel = el.closest(".message-panel");
    var icon = panel ? panel.querySelector(".message-panel__icon") : null;
    el.textContent = text;
    el.style.color = ""; // limpa eventual cor de erro de diagnóstico anterior
    if (icon) icon.textContent = MESSAGE_ICONS[type] || MESSAGE_ICONS.info;
    if (panel) panel.setAttribute("data-message-type", type);
  }

  function setIndicator(name, on) {
    var el = document.querySelector('[data-indicator="' + name + '"]');
    if (el) el.setAttribute("data-state", on ? "on" : "off");
  }

  // =================================================================
  // 3-6) CENA 3D E LÓGICA DO SIMULADOR
  // =================================================================
  function bootstrap() {
    var canvas = document.getElementById("scene-canvas");
    var container = canvas ? canvas.parentElement : null;
    var loadingOverlay = document.getElementById("viewport-loading");

    if (!canvas || !container || typeof THREE === "undefined") {
      showMessage("Erro ao inicializar: elementos da cena ou THREE.js não encontrados.", "error");
      window.__ctSimulatorErrorReported = true;
      return;
    }

    try {
      var testGl =
        canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!testGl) {
        throw new Error("WebGL não disponível neste navegador/dispositivo.");
      }

      // -----------------------------------------------------------
      // Cena, câmera, renderizador
      // -----------------------------------------------------------
      var scene = new THREE.Scene();
      scene.background = new THREE.Color(0x3a4149);
      scene.fog = new THREE.Fog(0x3a4149, 10, 24);

      var camera = new THREE.PerspectiveCamera(48, container.clientWidth / container.clientHeight, 0.05, 100);

      var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      if (renderer.outputColorSpace !== undefined) renderer.outputColorSpace = THREE.SRGBColorSpace;

      function handleResize() {
        var w = container.clientWidth;
        var h = container.clientHeight;
        if (w === 0 || h === 0) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      }
      var resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(container);
      handleResize();

      // -----------------------------------------------------------
      // Câmera orbital manual — sem dependências externas (mais
      // compatível do que o addon OrbitControls em alguns navegadores).
      // -----------------------------------------------------------
      var target = new THREE.Vector3(0, 1.0, -0.6);
      var radius = 5.2, azimuth = 0.78, polar = 1.05;
      var MIN_RADIUS = 2.2, MAX_RADIUS = 9, MIN_POLAR = 0.25, MAX_POLAR = 1.5;

      function updateCamera() {
        var sp = Math.sin(polar), cp = Math.cos(polar);
        camera.position.set(
          target.x + radius * sp * Math.sin(azimuth),
          target.y + radius * cp,
          target.z + radius * sp * Math.cos(azimuth)
        );
        camera.lookAt(target);
      }
      updateCamera();

      var dragging = false, lastX = 0, lastY = 0;
      function pointerDown(x, y) { dragging = true; lastX = x; lastY = y; }
      function pointerMove(x, y) {
        if (!dragging) return;
        var dx = x - lastX, dy = y - lastY;
        lastX = x; lastY = y;
        azimuth -= dx * 0.006;
        polar = Math.min(MAX_POLAR, Math.max(MIN_POLAR, polar - dy * 0.006));
        updateCamera();
      }
      function pointerUp() { dragging = false; }

      canvas.addEventListener("mousedown", function (e) { pointerDown(e.clientX, e.clientY); });
      window.addEventListener("mousemove", function (e) { pointerMove(e.clientX, e.clientY); });
      window.addEventListener("mouseup", pointerUp);

      // Toque com 1 dedo = girar; toque com 2 dedos = zoom por pinça.
      // "touch-action: none" no CSS garante que o navegador não capture
      // esses gestos para zoom/pan da página inteira.
      var pinchStartDist = null, pinchStartRadius = radius;

      function touchDistance(touches) {
        var dx = touches[0].clientX - touches[1].clientX;
        var dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
      }

      canvas.addEventListener("touchstart", function (e) {
        e.preventDefault();
        if (e.touches.length === 1) {
          pointerDown(e.touches[0].clientX, e.touches[0].clientY);
        } else if (e.touches.length === 2) {
          dragging = false;
          pinchStartDist = touchDistance(e.touches);
          pinchStartRadius = radius;
        }
      }, { passive: false });

      canvas.addEventListener("touchmove", function (e) {
        e.preventDefault();
        if (e.touches.length === 1) {
          pointerMove(e.touches[0].clientX, e.touches[0].clientY);
        } else if (e.touches.length === 2 && pinchStartDist) {
          var newDist = touchDistance(e.touches);
          var scale = pinchStartDist / newDist; // dedos afastando = diminui radius (aproxima)
          radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, pinchStartRadius * scale));
          updateCamera();
        }
      }, { passive: false });

      canvas.addEventListener("touchend", function (e) {
        pointerUp();
        if (e.touches.length < 2) pinchStartDist = null;
      });
      canvas.addEventListener("touchcancel", function () {
        pointerUp();
        pinchStartDist = null;
      });

      canvas.addEventListener("wheel", function (e) {
        e.preventDefault();
        radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, radius + e.deltaY * 0.0035));
        updateCamera();
      }, { passive: false });

      // -----------------------------------------------------------
      // Iluminação — difusa e "clínica" (sala bem iluminada, sombras suaves)
      // -----------------------------------------------------------
      scene.add(new THREE.AmbientLight(0xf0f4f8, 0.32));
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8f979e, 0.42));

      var key = new THREE.DirectionalLight(0xffffff, 0.78);
      key.position.set(2.5, 5.5, 2);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.near = 0.5;
      key.shadow.camera.far = 20;
      key.shadow.camera.left = -6; key.shadow.camera.right = 6;
      key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
      key.shadow.radius = 4; // sombras mais suaves
      scene.add(key);

      var fill = new THREE.DirectionalLight(0xe8f0f8, 0.3);
      fill.position.set(-4, 3.5, -3);
      scene.add(fill);

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
      var spinRotTime = 0; // s por volta; 0 = parado/oculto

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

      // -----------------------------------------------------------
      // Mesa de exame — limites físicos (valores conferidos com a
      // especificação clínica):
      //   • Altura do isocentro: 80 cm do piso
      //   • Altura máxima da mesa: 100 cm
      //   • Altura mínima da mesa: 50 cm
      //   • Curso longitudinal total: ~200 cm
      //
      // O furo do gantry (bore) é PASSANTE — um túnel aberto dos dois
      // lados. O tampo atravessa o furo livremente; o limite de inserção
      // é definido para que a região anatômica de interesse alcance o
      // isocentro (centro do gantry, Z ≈ -0.60), não por colisão com
      // parede traseira (que não existe).
      //   - Isocentro em Z ≈ -0.60 ; face frontal do bore em Z ≈ -0.175.
      //   - Paciente: abdome ~z+0.15, tórax ~z+0.36, cabeça ~z+0.75.
      //   - tableZ = -0.96 leva o tórax ao isocentro; -1.35 leva a cabeça.
      // -----------------------------------------------------------
      var TABLE_Y_MIN = 0.50;   // altura mínima mecânica FORA do gantry (m)
      var TABLE_Y_MAX = 0.88;   // altura máxima geral (dentro e fora do gantry) — 88 cm
      var GANTRY_Y_MIN = 0.64;  // altura mínima permitida DENTRO do gantry — 64 cm
      var GANTRY_Y_MAX = 0.88;  // altura máxima permitida DENTRO do gantry — 88 cm
      var TABLE_Z_MAX = 0.90;                        // totalmente retraída (paciente fora, à frente do gantry)
      var TABLE_Z_MIN = -1.10;                       // inserção máxima — permite tórax/abdome/cabeça no isocentro
      var BORE_SAFE_Z = 0.20;                        // ponto (m) em que a ponta da mesa cruza a face do gantry
      // Faixa de altura segura para permanecer/entrar no bore. O furo do
      // gantry (raio 40 cm / diâmetro 80 cm, em torno do isocentro de
      // 80 cm) comporta com folga toda a faixa mecânica da mesa, então a
      // faixa segura é a própria faixa completa de altura (50–100 cm).
      // Faixa de altura permitida DENTRO do gantry: 64 a 88 cm.
      var SAFE_Y_MIN = GANTRY_Y_MIN, SAFE_Y_MAX = GANTRY_Y_MAX;

      // Meia-espessura do paciente (do topo do tampo ao centro do corpo).
      // Usada para calcular o alinhamento do isocentro.
      var PATIENT_HALF_THICKNESS = 0.12; // 12 cm (espessura média ~24 cm)

      var tableY = 0.80; // inicia na altura do isocentro
      var tableZ = TABLE_Z_MAX; // inicia totalmente retraída (fora do gantry)

      // -----------------------------------------------------------
      // Suporte da mesa — estilo Somatom (base retangular escalonada):
      //   • Base fixa no piso: blocos escalonados que se afinam para cima.
      //   • Coluna-pistão móvel: sobe e desce com a mesa (movimento
      //     vertical), como um elevador de coluna. O tampo sai em balanço
      //     (cantilever) do topo dessa coluna.
      // A base fica atrás do gantry (lado de embarque do paciente).
      // -----------------------------------------------------------
      var baseGroup = new THREE.Group();
      baseGroup.position.set(0, 0, 0.9);
      scene.add(baseGroup);

      var baseMatDark = new THREE.MeshStandardMaterial({ color: 0xbfc7cd, roughness: 0.5, metalness: 0.15 });
      var baseMatLight = new THREE.MeshStandardMaterial({ color: 0xf0f3f5, roughness: 0.38, metalness: 0.1 });
      var columnMat = new THREE.MeshStandardMaterial({ color: 0xf4f7f9, roughness: 0.35, metalness: 0.12 });

      // --- Base fixa: três degraus retangulares (largo → estreito) ---
      // Altura total da parte fixa mantida abaixo da altura mínima da mesa
      // (50 cm) para que a coluna-pistão sempre tenha comprimento positivo.
      // Degrau inferior (mais largo, apoiado no piso)
      var baseStep1 = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.14, 0.95), baseMatDark);
      baseStep1.position.set(0, 0.07, 0);
      baseStep1.castShadow = true; baseStep1.receiveShadow = true;
      baseGroup.add(baseStep1);

      // Degrau intermediário
      var baseStep2 = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.8), baseMatLight);
      baseStep2.position.set(0, 0.14 + 0.08, 0);
      baseStep2.castShadow = true; baseStep2.receiveShadow = true;
      baseGroup.add(baseStep2);

      // Degrau superior (base da coluna, fixo)
      var baseStep3 = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.10, 0.66), baseMatLight);
      baseStep3.position.set(0, 0.30 + 0.05, 0);
      baseStep3.castShadow = true; baseStep3.receiveShadow = true;
      baseGroup.add(baseStep3);

      var BASE_FIXED_TOP = 0.30 + 0.10; // topo da parte fixa (0.40 m — abaixo da mesa mínima de 0.50)

      // --- Coluna-pistão móvel: sobe/desce com a mesa ---
      // É um bloco vertical que se estende do topo da base fixa até o
      // tampo. Seu comprimento varia com a altura da mesa (efeito pistão).
      var column = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1, 0.6), columnMat);
      column.castShadow = true; column.receiveShadow = true;
      baseGroup.add(column);

      // --- Berço/trilho de suporte sob o tampo ---
      // Estrutura horizontal logo abaixo do tampo, presa ao topo da
      // coluna (parte do suporte, NÃO da mesa). Estende-se para frente
      // (em direção ao gantry) preenchendo o vão que aparece quando o
      // tampo avança para dentro do bore. Sua posição vertical acompanha
      // a altura da mesa; sua posição/comprimento em Z acompanham o
      // avanço do tampo, sem alterar a geometria da mesa/paciente/laser.
      var carriage = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.12, 1.0),
        new THREE.MeshStandardMaterial({ color: 0xe4e9ec, roughness: 0.4, metalness: 0.15 })
      );
      carriage.castShadow = true; carriage.receiveShadow = true;
      baseGroup.add(carriage);

      var tableGroup = new THREE.Group();
      scene.add(tableGroup);

      var topPlate = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.04, 1.95),
        new THREE.MeshStandardMaterial({ color: 0xf2f5f7, roughness: 0.35, metalness: 0.2 })
      );
      topPlate.castShadow = true;
      topPlate.receiveShadow = true;
      tableGroup.add(topPlate);

      var cushion = new THREE.Mesh(
        new THREE.BoxGeometry(0.56, 0.025, 1.85),
        new THREE.MeshStandardMaterial({ color: 0xdfe5e8, roughness: 0.75 })
      );
      // Assentado sobre o topo do tampo (tampo: centro em 0, espessura
      // 0.04 → topo em +0.02). Colchão de 2.5 cm apoiado nesse topo.
      cushion.position.set(0, 0.02 + 0.0125, 0);
      cushion.castShadow = true;
      cushion.receiveShadow = true;
      tableGroup.add(cushion);

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
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 32, 24), skin);
      head.scale.set(0.95, 1.05, 1.0); // rosto levemente ovalado (menos "bola")
      head.position.set(0, TORSO_R, 0.76);
      patient.add(head);
      // Queixo/mandíbula sutil, para dar forma ao rosto sem cair no "uncanny".
      var jaw = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 18), skin);
      jaw.scale.set(0.9, 0.75, 0.95);
      jaw.position.set(0, TORSO_R - 0.03, 0.775);
      patient.add(jaw);
      var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.09, 16), skin);
      neck.rotation.x = Math.PI / 2;
      neck.position.set(0, TORSO_R - 0.01, 0.67);
      patient.add(neck);

      // Cabelo escuro: calota + coque (como a paciente da referência).
      var hairCap = new THREE.Mesh(
        new THREE.SphereGeometry(0.099, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
        hairMat
      );
      hairCap.position.copy(head.position);
      hairCap.rotation.x = -Math.PI / 2.4;
      patient.add(hairCap);
      var hairBun = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 12), hairMat);
      hairBun.position.set(0, TORSO_R - 0.015, 0.76 + 0.09);
      patient.add(hairBun);

      // Ombros arredondados (esferas nas pontas do tronco superior).
      var shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), scrub);
      shoulderL.position.set(-0.135, TORSO_R * 0.9, 0.58);
      patient.add(shoulderL);
      var shoulderR = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), scrub);
      shoulderR.position.set(0.135, TORSO_R * 0.9, 0.58);
      patient.add(shoulderR);

      // Tronco superior (tórax) — levemente elíptico (mais largo que alto).
      var chest = new THREE.Mesh(new THREE.CylinderGeometry(TORSO_R, TORSO_R + 0.015, 0.34, 24), scrub);
      chest.scale.x = 1.35; // ombros mais largos que a espessura
      chest.rotation.x = Math.PI / 2;
      chest.position.set(0, TORSO_R * 0.92, 0.44);
      patient.add(chest);

      // Avental com caimento (flare): tronco inferior alargando até os
      // joelhos, como o avental da foto (cone truncado).
      var gownSkirt = new THREE.Mesh(new THREE.CylinderGeometry(TORSO_R + 0.015, TORSO_R + 0.055, 0.5, 24), scrub);
      gownSkirt.scale.x = 1.3;
      gownSkirt.rotation.x = Math.PI / 2;
      gownSkirt.position.set(0, TORSO_R * 0.88, 0.02);
      patient.add(gownSkirt);

      function limb(r, l, x, y, z, mat, r2) {
        var m = new THREE.Mesh(new THREE.CylinderGeometry(r, (r2 !== undefined ? r2 : r * 0.85), l, 16), mat);
        m.rotation.x = Math.PI / 2;
        m.position.set(x, y, z);
        return m;
      }
      // Braços — de pele (manga curta), levemente afastados do tronco.
      patient.add(limb(0.036, 0.46, -0.185, TORSO_R * 0.72, 0.33, skin, 0.028));
      patient.add(limb(0.036, 0.46, 0.185, TORSO_R * 0.72, 0.33, skin, 0.028));
      // Mãos (pequenas esferas).
      var handL = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), skin);
      handL.position.set(-0.185, TORSO_R * 0.72, 0.08);
      patient.add(handL);
      var handR = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), skin);
      handR.position.set(0.185, TORSO_R * 0.72, 0.08);
      patient.add(handR);
      // Pernas — de pele, do joelho (fim do avental) até o tornozelo,
      // com panturrilha (mais grossa em cima).
      patient.add(limb(0.048, 0.42, -0.075, TORSO_R * 0.75, -0.42, skin, 0.03));
      patient.add(limb(0.048, 0.42, 0.075, TORSO_R * 0.75, -0.42, skin, 0.03));
      // Meias brancas nos pés (com "pezinho" apontando para cima quando deitada).
      patient.add(limb(0.038, 0.10, -0.075, TORSO_R * 0.75, -0.68, sockMat, 0.035));
      patient.add(limb(0.038, 0.10, 0.075, TORSO_R * 0.75, -0.68, sockMat, 0.035));
      var footL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), sockMat);
      footL.scale.set(0.8, 1.3, 0.8);
      footL.position.set(-0.075, TORSO_R * 0.85, -0.73);
      patient.add(footL);
      var footR = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), sockMat);
      footR.scale.set(0.8, 1.3, 0.8);
      footR.position.set(0.075, TORSO_R * 0.85, -0.73);
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

      // Estado de posicionamento: enquanto null, o paciente está em pé.
      var patientPlaced = false;

      // ----- Posicionamento do paciente (decúbito + entrada) -----
      var DECUBITOS = ["dorsal", "ventral", "lateral-d", "lateral-e"];
      var ENTRADAS = ["cabeca", "pes"];
      var currentDecubito = "dorsal";
      var currentEntrada = "cabeca";

      // Rotação de roll (eixo Z) por decúbito. O corpo é montado em
      // decúbito dorsal (de costas), então:
      var DECUBITO_ROLL = {
        "dorsal": 0,
        "ventral": Math.PI,          // de bruços
        "lateral-d": Math.PI / 2,    // lateral direito
        "lateral-e": -Math.PI / 2,   // lateral esquerdo
      };

      var DECUBITO_LABELS = {
        "dorsal": "DORSAL", "ventral": "VENTRAL",
        "lateral-d": "LAT. DIR.", "lateral-e": "LAT. ESQ.",
      };
      var ENTRADA_LABELS = { "cabeca": "CABEÇA", "pes": "PÉS" };
      function decubitoLabel(d) { return DECUBITO_LABELS[d] || d; }
      function entradaLabel(e) { return ENTRADA_LABELS[e] || e; }

      var displayPositionEl = document.getElementById("display-position");

      // Coloca o paciente EM PÉ ao lado da mesa (estado "aguardando").
      // O corpo é montado deitado (cabeça em +Z, pés em -Z). Para ficar de
      // pé, rotacionamos -90° em X (o eixo Z do corpo vira a vertical) e o
      // elevamos até os pés tocarem o piso.
      function standPatient() {
        patientPlaced = false;
        patientStanding.add(patient);
        patient.rotation.set(-Math.PI / 2, 0, 0);
        patient.position.set(0, 0.85, 0); // eleva para os pés tocarem o chão
        if (displayPositionEl) displayPositionEl.textContent = "AGUARDANDO";
      }

      function applyPatientPose() {
        if (!patientPlaced) return; // em pé: nada a rotacionar na mesa
        // Garante que o corpo está na mesa (reparentado ao patientPose).
        if (patient.parent !== patientPose) {
          patientPose.add(patient);
          patient.rotation.set(0, 0, 0);
        }
        // O corpo é montado com o centro do torso a ~TORSO_R acima do plano
        // do tampo. Para que a rotação de decúbito (roll/yaw) gire o corpo
        // em torno do seu PRÓPRIO eixo central — e não em torno do plano do
        // tampo (o que jogaria o corpo para baixo no ventral ou para o lado
        // nas laterais) — colocamos o eixo de rotação (patientPose) na
        // altura do centro do corpo e baixamos o corpo dentro dele pela
        // mesma quantia.
        var bodyCenter = TORSO_R;      // altura do eixo do corpo acima do tampo
        patientPose.position.y = 0.02 + bodyCenter; // eixo na altura do centro
        patient.position.set(0, -bodyCenter, 0);    // corpo desce até apoiar

        var roll = DECUBITO_ROLL[currentDecubito] || 0;
        var yaw = (currentEntrada === "pes") ? Math.PI : 0;
        patientPose.rotation.set(0, yaw, roll);

        if (displayPositionEl) {
          displayPositionEl.textContent = decubitoLabel(currentDecubito) + " / " + entradaLabel(currentEntrada);
        }
      }

      // Coloca o paciente NA MESA (transição a partir do estado em pé ou
      // troca de decúbito quando já deitado).
      function placePatient() {
        patientPlaced = true;
        applyPatientPose();
      }

      // Estado inicial: paciente em pé ao lado do aparelho.
      standPatient();

      function applyTablePose() {
        tableGroup.position.set(0, tableY, tableZ);

        // Coluna-pistão: liga o topo da base fixa (BASE_FIXED_TOP, em
        // coordenadas do baseGroup, cuja origem está no piso) ao nível do
        // tampo (tableY, em coordenadas do mundo). Como o baseGroup está
        // no piso (y=0), a altura do topo da coluna deve ser tableY.
        // A coluna vai de BASE_FIXED_TOP até tableY; seu comprimento e
        // centro são recalculados a cada movimento (efeito pistão).
        var columnBottom = BASE_FIXED_TOP;
        var columnTop = tableY - 0.02; // encosta logo abaixo do tampo
        var columnLen = Math.max(0.05, columnTop - columnBottom);
        column.scale.y = columnLen;
        column.position.y = columnBottom + columnLen / 2;

        // Berço de suporte: fica logo abaixo do tampo (acompanha a altura)
        // e se estende de cima da coluna até a face do gantry, preenchendo
        // o vão conforme o tampo avança. Coordenadas em relação ao
        // baseGroup (origem em Z=0.9 no mundo).
        //   - Face do gantry no mundo ≈ GANTRY_FACE_Z (-0.20). Em coords
        //     do baseGroup: GANTRY_FACE_Z - 0.9.
        //   - A frente do berço deve alcançar a face do gantry; a traseira
        //     fica sobre a coluna (Z≈0 no baseGroup).
        var carriageBackZ = 0.0;                       // sobre a coluna
        var carriageFrontZ = (GANTRY_FACE_Z - 0.9);    // até a face do gantry
        var carriageLen = Math.max(0.3, carriageBackZ - carriageFrontZ);
        carriage.scale.z = carriageLen / 1.0; // geometria base tem 1.0 de profundidade
        carriage.position.set(0, tableY - 0.10, carriageBackZ - carriageLen / 2);
      }
      applyTablePose();

      // -----------------------------------------------------------
      // Laser de posicionamento — FIXO no gantry, projetado sobre as
      // superfícies (paciente / colchão / tampo) via raycasting, para
      // se comportar como luz real: reto sobre superfície plana, seguindo
      // as ondulações sobre o corpo, e SEM atravessar o paciente (cada
      // raio marca apenas o primeiro ponto de impacto = face iluminada).
      //
      // Pontos de origem (na face de entrada do gantry, ao redor do bore):
      //   • 12h (topo): feixe LONGITUDINAL central (linha média sagital,
      //     no topo do corpo) + feixe TRANSVERSAL (cruza o corpo, marca
      //     o início do exame).
      //   • 3h e 9h (laterais): feixes LONGITUDINAIS laterais (planos
      //     sagitais nas laterais do corpo).
      //
      // Cobertura longitudinal de cada feixe: ~20 cm para fora do gantry
      // e ~50 cm para dentro (total ~70 cm em Z).
      // -----------------------------------------------------------
      var LASER_COLOR = 0xff2222;

      // Extensão longitudinal dos feixes (em Z, relativo à face do gantry).
      var LASER_LONG_OUT = 0.20;  // 20 cm para fora (em direção +Z, saída)
      var LASER_LONG_IN = 0.50;   // 50 cm para dentro (em direção -Z)
      // Extensão transversal do feixe (em X), cobrindo a largura do corpo.
      var LASER_TRANS_HALF = 0.30; // 30 cm para cada lado do centro

      var LASER_SEGMENTS = 64;    // resolução das linhas projetadas
      var LASER_LIFT = 0.004;     // pequeno "levantamento" sobre a superfície p/ evitar z-fighting

      // Origem dos raios: bem acima/ao lado, na borda do bore, apontando
      // para o centro (isocentro). Y de referência do isocentro.
      var laserOriginTop = new THREE.Vector3(0, ISO_Y + BORE_R, GANTRY_FACE_Z);
      var laserOriginRight = new THREE.Vector3(BORE_R, ISO_Y, GANTRY_FACE_Z);
      var laserOriginLeft = new THREE.Vector3(-BORE_R, ISO_Y, GANTRY_FACE_Z);

      // Material das linhas do laser (LineBasicMaterial: linha fina e nítida).
      var laserLineMat = new THREE.LineBasicMaterial({
        color: LASER_COLOR,
        transparent: true,
        opacity: 0.95,
        depthTest: true,   // respeita a profundidade: não atravessa o corpo
        depthWrite: false,
      });

      var laserGroup = new THREE.Group();
      scene.add(laserGroup);

      // Cria uma linha (THREE.Line) com N segmentos, adicionada ao grupo.
      function makeLaserLine(nPoints) {
        var positions = new Float32Array(nPoints * 3);
        var geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        var line = new THREE.Line(geom, laserLineMat);
        line.frustumCulled = false;
        line.renderOrder = 999;
        laserGroup.add(line);
        return line;
      }

      var longCentralLine = makeLaserLine(LASER_SEGMENTS + 1);
      var longRightLine = makeLaserLine(LASER_SEGMENTS + 1);
      var longLeftLine = makeLaserLine(LASER_SEGMENTS + 1);
      var transversalLine = makeLaserLine(LASER_SEGMENTS + 1);

      // Raycaster reutilizável e alvos de projeção.
      var laserRaycaster = new THREE.Raycaster();
      var laserTargets = [];   // preenchido após a criação de paciente/mesa
      var _rayDir = new THREE.Vector3();
      var _rayFallback = new THREE.Vector3();

      // Projeta um ponto: lança um raio da origem em direção ao alvo
      // aproximado (x,z no plano do isocentro) e retorna o ponto de
      // impacto na primeira superfície. Se nada for atingido, cai no
      // plano do tampo (yFallback).
      function projectLaserPoint(origin, x, z, yFallback, out) {
        // Alvo aproximado no plano do isocentro (levemente abaixo, para o
        // raio "descer" sobre as superfícies).
        _rayFallback.set(x, yFallback, z);
        _rayDir.copy(_rayFallback).sub(origin).normalize();
        laserRaycaster.set(origin, _rayDir);
        var hits = laserRaycaster.intersectObjects(laserTargets, true);
        if (hits.length > 0) {
          out.copy(hits[0].point);
          out.y += LASER_LIFT;
        } else {
          out.set(x, yFallback + LASER_LIFT, z);
        }
        return out;
      }

      var _p = new THREE.Vector3();
      var _sideDir = new THREE.Vector3();
      var _sideTarget = new THREE.Vector3();

      // Projeta um ponto LATERAL: raio HORIZONTAL na altura do isocentro
      // (plano coronal, y = ISO_Y), partindo da origem em 3h/9h em direção
      // ao plano central (x=0). A linha resultante pinta o FLANCO do
      // paciente na altura do isocentro — exatamente como o laser coronal
      // do equipamento real (serve para centralizar a espessura do corpo
      // no isocentro). Fallback: se o raio não atinge nada, o ponto segue
      // até o plano central (x=0).
      function projectSidePoint(origin, z, out) {
        _sideTarget.set(0, ISO_Y, z);
        _sideDir.copy(_sideTarget).sub(origin).normalize();
        laserRaycaster.set(origin, _sideDir);
        var hits = laserRaycaster.intersectObjects(laserTargets, true);
        if (hits.length > 0) {
          out.copy(hits[0].point);
          // "levantamento" lateral (na direção da origem) p/ evitar z-fighting
          out.x += (origin.x > 0 ? 1 : -1) * LASER_LIFT;
        } else {
          out.copy(_sideTarget);
        }
        return out;
      }

      // Atualiza a geometria de uma linha lateral (varre em Z, projeção
      // horizontal no plano do isocentro).
      function updateSideLine(line, origin) {
        var pos = line.geometry.attributes.position.array;
        var zStart = GANTRY_FACE_Z + LASER_LONG_OUT;
        var zEnd = GANTRY_FACE_Z - LASER_LONG_IN;
        for (var i = 0; i <= LASER_SEGMENTS; i++) {
          var t = i / LASER_SEGMENTS;
          var z = zStart + (zEnd - zStart) * t;
          projectSidePoint(origin, z, _p);
          pos[i * 3] = _p.x;
          pos[i * 3 + 1] = _p.y;
          pos[i * 3 + 2] = _p.z;
        }
        line.geometry.attributes.position.needsUpdate = true;
        line.geometry.computeBoundingSphere();
      }

      // Atualiza a geometria de uma linha longitudinal (varre em Z).
      function updateLongitudinalLine(line, origin, xFixed, yFallback) {
        var pos = line.geometry.attributes.position.array;
        var zStart = GANTRY_FACE_Z + LASER_LONG_OUT;   // 20 cm para fora
        var zEnd = GANTRY_FACE_Z - LASER_LONG_IN;      // 50 cm para dentro
        for (var i = 0; i <= LASER_SEGMENTS; i++) {
          var t = i / LASER_SEGMENTS;
          var z = zStart + (zEnd - zStart) * t;
          projectLaserPoint(origin, xFixed, z, yFallback, _p);
          pos[i * 3] = _p.x;
          pos[i * 3 + 1] = _p.y;
          pos[i * 3 + 2] = _p.z;
        }
        line.geometry.attributes.position.needsUpdate = true;
        line.geometry.computeBoundingSphere();
      }

      // Atualiza a geometria da linha transversal (varre em X, Z fixo).
      function updateTransversalLine(line, origin, zFixed, yFallback) {
        var pos = line.geometry.attributes.position.array;
        for (var i = 0; i <= LASER_SEGMENTS; i++) {
          var t = i / LASER_SEGMENTS;
          var x = -LASER_TRANS_HALF + (2 * LASER_TRANS_HALF) * t;
          projectLaserPoint(origin, x, zFixed, yFallback, _p);
          pos[i * 3] = _p.x;
          pos[i * 3 + 1] = _p.y;
          pos[i * 3 + 2] = _p.z;
        }
        line.geometry.attributes.position.needsUpdate = true;
        line.geometry.computeBoundingSphere();
      }

      function updateLasers() {
        if (!laserGroup.visible) return;
        var yFallback = tableY + 0.02; // topo do tampo como piso do laser
        // Sagital central (12h): plano vertical x=0, pinta o topo do corpo.
        updateLongitudinalLine(longCentralLine, laserOriginTop, 0, yFallback);
        // Coronais laterais (3h/9h): plano HORIZONTAL na altura do
        // isocentro, pintam os flancos do corpo.
        updateSideLine(longRightLine, laserOriginRight);
        updateSideLine(longLeftLine, laserOriginLeft);
        // Axial/transversal (12h): plano vertical no Z da face do gantry.
        updateTransversalLine(transversalLine, laserOriginTop, GANTRY_FACE_Z, yFallback);
      }

      // Superfícies onde o laser é projetado (paciente, colchão, tampo).
      // Definidas aqui pois todas já foram criadas acima.
      laserTargets = [patient, cushion, topPlate];

      laserGroup.visible = false;

      // -----------------------------------------------------------
      // Controles do console — pressionar e segurar (mouse + touch)
      // -----------------------------------------------------------
      var SPEED_Y = 0.15; // m/s
      var SPEED_Z = 0.50; // m/s
      var moveUp = false, moveDown = false, moveIn = false, moveOut = false;
      var laserOn = false;
      var alertStatus = "";
      var simulationRunning = false;
      // Referência de "zero" da posição da mesa (definida pelo botão Zerar
      // com o laser transversal). A leitura de posição passa a ser relativa
      // a esse ponto — é o marco zero para a futura aquisição do exame.
      // Inicia em null: enquanto não zerado, a posição é medida a partir da
      // retração total (comportamento anterior).
      var tableZeroRef = null;

      function setHeld(el, setter) {
        if (!el) return;
        function on(e) {
          e.preventDefault();
          setter(true);
          // Captura o ponteiro: garante que o "soltar" seja detectado
          // mesmo que o dedo deslize para fora do botão durante o toque
          // (evita a mesa "grudar" em um movimento contínuo).
          if (el.setPointerCapture && e.pointerId !== undefined) {
            try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignora */ }
          }
        }
        function off() { setter(false); }
        el.addEventListener("pointerdown", on);
        el.addEventListener("pointerup", off);
        el.addEventListener("pointercancel", off);
        el.addEventListener("pointerleave", off);
        // Rede de segurança adicional: se por algum motivo o ponteiro for
        // solto fora do elemento sem capturar corretamente.
        window.addEventListener("pointerup", off);
        window.addEventListener("blur", off);
      }

      var btnUp = document.getElementById("btn-table-up");
      var btnDown = document.getElementById("btn-table-down");
      var btnIn = document.getElementById("btn-table-in");
      var btnOut = document.getElementById("btn-table-out");
      var btnLaser = document.getElementById("btn-laser");
      var btnZero = document.getElementById("btn-zero");
      var btnStart = document.getElementById("btn-start");
      var btnReset = document.getElementById("btn-reset");
      var btnStop = document.getElementById("btn-stop");

      setHeld(btnUp, function (v) { moveUp = v; });
      setHeld(btnDown, function (v) { moveDown = v; });
      setHeld(btnIn, function (v) { moveIn = v; });
      setHeld(btnOut, function (v) { moveOut = v; });

      // Temporizador de segurança do laser: desliga sozinho após 40 s
      // (como no equipamento real, para evitar exposição desnecessária
      // dos olhos ao feixe).
      var LASER_TIMEOUT_MS = 40000;
      var laserTimer = null;

      function setLaser(on) {
        laserOn = on;
        laserGroup.visible = on;
        if (btnLaser) btnLaser.setAttribute("aria-pressed", String(on));
        setIndicator("laser", on);
        if (laserTimer) { clearTimeout(laserTimer); laserTimer = null; }
        if (on) {
          updateLasers();
          laserTimer = setTimeout(function () {
            setLaser(false);
            showMessage("Laser desligado automaticamente após 40 segundos (desligamento de segurança).", "info");
          }, LASER_TIMEOUT_MS);
        }
      }

      if (btnLaser) {
        btnLaser.addEventListener("click", function () {
          setLaser(!laserOn);
          showMessage(laserOn ? "Laser de posicionamento ligado (desliga sozinho em 40 s)." : "Laser de posicionamento desligado.", "info");
        });
      }

      if (btnZero) {
        btnZero.addEventListener("click", function () {
          // Define a posição atual da mesa como o ponto zero de referência
          // para a aquisição. O laser transversal marca esse plano.
          tableZeroRef = tableZ;
          updateReadouts(0);
          showMessage("Posição da mesa zerada neste ponto (marco zero para a aquisição). Este é um ponto de controle — não é obrigatório para adquirir o exame.", "success");
        });
      }

      if (btnStart) {
        btnStart.addEventListener("click", function () {
          simulationRunning = true;
          showMessage("Simulação iniciada. Ajuste a altura da mesa para alinhar o centro do paciente ao isocentro (o status indica: DESCER / SUBIR MESA / ISOCENTRO OK).", "success");
        });
      }

      if (btnReset) {
        btnReset.addEventListener("click", function () {
          tableY = 0.80;
          tableZ = TABLE_Z_MAX;
          tableZeroRef = null;
          applyTablePose();
          setLaser(false);
          currentDecubito = "dorsal";
          currentEntrada = "cabeca";
          standPatient();
          if (typeof updatePoseToggleFace === "function") updatePoseToggleFace();
          if (typeof renderPoseOptions === "function") renderPoseOptions();
          simulationRunning = false;
          var statusEl = document.getElementById("display-status");
          if (statusEl) statusEl.textContent = "AGUARDANDO";
          showMessage("Simulador reiniciado. Paciente aguardando ao lado do equipamento.", "info");
        });
      }

      if (btnStop) {
        btnStop.addEventListener("click", function () {
          moveUp = moveDown = moveIn = moveOut = false;
          abortAutoDrive("PARADA DE EMERGÊNCIA — aquisição abortada.");
          var statusEl = document.getElementById("display-status");
          if (statusEl) statusEl.textContent = "PARADO";
          showMessage("PARADA DE EMERGÊNCIA acionada. Todos os movimentos foram interrompidos.", "warning");
        });
      }

      // -----------------------------------------------------------
      // Seletor de posicionamento do paciente (decúbito + entrada)
      // Ícones esquemáticos 2D em SVG. Layout vertical: botão que abre
      // um painel expansível com as opções.
      // -----------------------------------------------------------
      // Ícones SVG esquemáticos (bonequinho visto conforme a posição).
      // Cada um retorna uma string SVG simples, em cor de contorno.
      function svgDecubito(kind) {
        var stroke = 'stroke="currentColor" stroke-width="4" fill="none" stroke-linejoin="round" stroke-linecap="round"';
        var fill = 'fill="currentColor"';
        // Vista lateral esquemática deitado (linha da mesa embaixo).
        var bed = '<line x1="8" y1="52" x2="88" y2="52" stroke="currentColor" stroke-width="3"/>';
        if (kind === "dorsal") {
          // De costas: corpo reto sobre a mesa, cabeça à direita.
          return '<svg viewBox="0 0 96 64">' + bed +
            '<circle cx="76" cy="40" r="8" ' + fill + '/>' +
            '<rect x="16" y="36" width="52" height="10" rx="5" ' + fill + '/></svg>';
        }
        if (kind === "ventral") {
          // De bruços: mesma silhueta, marcador indicando frente para baixo.
          return '<svg viewBox="0 0 96 64">' + bed +
            '<circle cx="76" cy="40" r="8" ' + fill + '/>' +
            '<rect x="16" y="36" width="52" height="10" rx="5" ' + fill + '/>' +
            '<line x1="20" y1="48" x2="64" y2="48" stroke="var(--bg-display)" stroke-width="2"/></svg>';
        }
        if (kind === "lateral-d" || kind === "lateral-e") {
          // Vista frontal (de frente para o gantry): corpo de lado = perfil
          // mais estreito e alto.
          return '<svg viewBox="0 0 96 64">' + bed +
            '<circle cx="48" cy="16" r="8" ' + fill + '/>' +
            '<rect x="42" y="22" width="12" height="26" rx="6" ' + fill + '/></svg>';
        }
        return '<svg viewBox="0 0 96 64">' + bed + '</svg>';
      }
      function svgEntrada(kind) {
        var fill = 'fill="currentColor"';
        var bore = '<circle cx="78" cy="32" r="14" stroke="currentColor" stroke-width="3" fill="none"/>';
        var bed = '<line x1="4" y1="46" x2="64" y2="46" stroke="currentColor" stroke-width="3"/>';
        if (kind === "cabeca") {
          // Cabeça primeiro: cabeça (círculo) voltada para o gantry (direita).
          return '<svg viewBox="0 0 96 64">' + bore + bed +
            '<circle cx="52" cy="34" r="7" ' + fill + '/>' +
            '<rect x="10" y="31" width="40" height="8" rx="4" ' + fill + '/></svg>';
        }
        // Pés primeiro: cabeça à esquerda, pés para o gantry.
        return '<svg viewBox="0 0 96 64">' + bore + bed +
          '<circle cx="14" cy="34" r="7" ' + fill + '/>' +
          '<rect x="16" y="31" width="40" height="8" rx="4" ' + fill + '/></svg>';
      }

      var poseToggle = document.getElementById("pose-toggle");
      var posePanel = document.getElementById("pose-panel");
      var poseCurrentIcon = document.getElementById("pose-current-icon");
      var poseCurrentText = document.getElementById("pose-current-text");
      var decubitoGrid = document.getElementById("pose-decubito-grid");
      var entradaGrid = document.getElementById("pose-entrada-grid");

      var DECUBITO_FULL = {
        "dorsal": "Dorsal", "ventral": "Ventral",
        "lateral-d": "Lateral direito", "lateral-e": "Lateral esquerdo",
      };
      var ENTRADA_FULL = { "cabeca": "Cabeça primeiro", "pes": "Pés primeiro" };

      function updatePoseToggleFace() {
        if (poseCurrentIcon) poseCurrentIcon.innerHTML = svgDecubito(currentDecubito);
        if (poseCurrentText) {
          if (!patientPlaced) {
            poseCurrentText.textContent = "Aguardando — selecione a posição";
          } else {
            poseCurrentText.textContent = DECUBITO_FULL[currentDecubito] + " · " + ENTRADA_FULL[currentEntrada];
          }
        }
      }

      function buildPoseOption(kind, label, svg, isSelected, onClick) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pose-option";
        btn.setAttribute("aria-pressed", String(isSelected));
        btn.innerHTML = '<span class="pose-option__icon">' + svg + '</span>' +
          '<span class="pose-option__label">' + label + '</span>';
        btn.addEventListener("click", onClick);
        return btn;
      }

      function renderPoseOptions() {
        if (decubitoGrid) {
          decubitoGrid.innerHTML = "";
          DECUBITOS.forEach(function (d) {
            decubitoGrid.appendChild(buildPoseOption(
              d, DECUBITO_FULL[d], svgDecubito(d), patientPlaced && d === currentDecubito,
              function () {
                currentDecubito = d;
                placePatient();
                updatePoseToggleFace();
                renderPoseOptions();
                showMessage("Decúbito: " + DECUBITO_FULL[d] + ".", "info");
              }
            ));
          });
        }
        if (entradaGrid) {
          entradaGrid.innerHTML = "";
          ENTRADAS.forEach(function (e) {
            entradaGrid.appendChild(buildPoseOption(
              e, ENTRADA_FULL[e], svgEntrada(e), patientPlaced && e === currentEntrada,
              function () {
                currentEntrada = e;
                placePatient();
                updatePoseToggleFace();
                renderPoseOptions();
                showMessage("Entrada no gantry: " + ENTRADA_FULL[e] + ".", "info");
              }
            ));
          });
        }
      }

      if (poseToggle && posePanel) {
        poseToggle.addEventListener("click", function () {
          var isOpen = poseToggle.getAttribute("aria-expanded") === "true";
          poseToggle.setAttribute("aria-expanded", String(!isOpen));
          posePanel.hidden = isOpen;
        });
        // Fecha o popover ao tocar fora dele (comportamento de dropdown).
        document.addEventListener("pointerdown", function (e) {
          if (posePanel.hidden) return;
          if (posePanel.contains(e.target) || poseToggle.contains(e.target)) return;
          posePanel.hidden = true;
          poseToggle.setAttribute("aria-expanded", "false");
        });
      }
      updatePoseToggleFace();
      renderPoseOptions();


      // Atalhos de teclado (úteis em desktop; não interferem no touch)
      window.addEventListener("keydown", function (e) {
        if (e.key === "ArrowUp") moveUp = true;
        if (e.key === "ArrowDown") moveDown = true;
        if (e.key === "ArrowRight") moveIn = true;
        if (e.key === "ArrowLeft") moveOut = true;
      });
      window.addEventListener("keyup", function (e) {
        if (e.key === "ArrowUp") moveUp = false;
        if (e.key === "ArrowDown") moveDown = false;
        if (e.key === "ArrowRight") moveIn = false;
        if (e.key === "ArrowLeft") moveOut = false;
      });

      // -----------------------------------------------------------
      // HUD e display digital
      // -----------------------------------------------------------
      var hudPositionEl = document.getElementById("hud-table-position");
      var hudSpeedEl = document.getElementById("hud-table-speed");
      var hudHeightEl = document.getElementById("hud-table-height");
      var displayTableEl = document.getElementById("display-table");
      var displayHeightEl = document.getElementById("display-height");
      var displayStatusEl = document.getElementById("display-status");

      function updateReadouts(currentSpeedMmS) {
        // Posição longitudinal em mm. Se o operador zerou a mesa (botão
        // Zerar), a leitura é relativa a esse ponto (pode ser negativa);
        // caso contrário, 0 mm = totalmente retraída.
        var refZ = (tableZeroRef !== null) ? tableZeroRef : TABLE_Z_MAX;
        var posMm = (refZ - tableZ) * 1000;
        var posText = (posMm >= 0 ? "" : "-") + Math.abs(posMm).toFixed(1).padStart(5, "0");
        if (hudPositionEl) hudPositionEl.innerHTML = posText + " <small>mm</small>";
        if (displayTableEl) displayTableEl.textContent = posText + " mm";
        if (hudSpeedEl) hudSpeedEl.innerHTML = currentSpeedMmS.toFixed(1) + " <small>mm/s</small>";

        // Altura da mesa em cm (útil para calibrar/verificar os limites).
        var heightCm = tableY * 100;
        var heightText = heightCm.toFixed(1);
        if (hudHeightEl) hudHeightEl.innerHTML = heightText + " <small>cm</small>";
        if (displayHeightEl) displayHeightEl.textContent = heightText + " cm";

        // Alinhamento no isocentro: o centro do corpo do paciente fica
        // ~12 cm (metade da espessura) acima do topo do tampo. O tampo
        // (tableY) precisa estar ~14 cm abaixo do isocentro para que o
        // centro do paciente coincida com os 80 cm. Isso ensina o aluno
        // a "descer a mesa" para centralizar o paciente.
        var patientCenterY = tableY + 0.02 + PATIENT_HALF_THICKNESS;
        var isoDelta = Math.abs(patientCenterY - ISO_Y);
        if (displayStatusEl && simulationRunning) {
          if (isoDelta <= 0.01) {
            displayStatusEl.textContent = "ISOCENTRO OK";
          } else if (patientCenterY > ISO_Y) {
            displayStatusEl.textContent = "DESCER MESA";
          } else {
            displayStatusEl.textContent = "SUBIR MESA";
          }
        }
      }

      // -----------------------------------------------------------
      // AQUISIÇÃO DIRIGIDA PELA MESA (ponte com a workstation)
      // Física real: no topograma o tubo fica parado e a MESA translada o
      // paciente pelo gantry (imagem linha a linha); no helicoidal a mesa
      // avança continuamente enquanto o gantry gira (v = pitch × colimação
      // ÷ tempo de rotação). Aqui a workstation comanda a mesa e recebe o
      // progresso REAL para revelar a imagem em sincronia.
      // -----------------------------------------------------------
      var autoDrive = null; // { targetZ, startZ, speed(m/s), onProgress, onDone, onAbort }

      function setSpin(rotTimeS) {
        spinRotTime = rotTimeS > 0 ? rotTimeS : 0;
        spinArc.visible = spinRotTime > 0;
      }

      function abortAutoDrive(motivo) {
        if (!autoDrive) return;
        var ad = autoDrive;
        autoDrive = null;
        setSpin(0);
        if (ad.onAbort) ad.onAbort(motivo || "Aquisição interrompida.");
      }

      tableDriveApi = {
        isPatientOnTable: function () { return !!patientPlaced; },
        isBusy: function () { return !!autoDrive; },
        // opts: { distanceMm, direction: "in"|"out", speedMmS, rotTimeS (0 = topograma), onProgress, onDone, onAbort }
        start: function (opts) {
          if (autoDrive) return { ok: false, motivo: "Já existe uma aquisição em andamento." };
          var dist = Math.max(0.01, (opts.distanceMm || 0) / 1000);
          var dir = (opts.direction === "in") ? -1 : 1;
          var target = Math.max(TABLE_Z_MIN, Math.min(TABLE_Z_MAX, tableZ + dir * dist));
          var travel = Math.abs(target - tableZ);
          if (travel < dist * 0.98) {
            return {
              ok: false,
              motivo: "Curso da mesa insuficiente para a varredura " +
                (dir < 0 ? "(entrando no gantry)" : "(saindo do gantry)") +
                " — reposicione a mesa antes de iniciar."
            };
          }
          var startZ0 = tableZ;
          autoDrive = {
            targetZ: target,
            startZ: startZ0,
            speed: Math.max(0.005, (opts.speedMmS || 50) / 1000),
            onProgress: opts.onProgress || null,
            onDone: opts.onDone || null,
            onAbort: opts.onAbort || null
          };
          setSpin(opts.rotTimeS || 0);
          if (displayStatusEl) {
            displayStatusEl.textContent = opts.label || (opts.rotTimeS > 0 ? "AQUISIÇÃO HELICOIDAL" : "TOPOGRAMA");
          }
          return { ok: true, startZ: startZ0, targetZ: target };
        },
        getPos: function () { return tableZ; },
        // Deslocamento vertical (cm) do eixo do paciente em relação ao
        // isocentro. Física (AAPM): no topograma LATERAL, fora do
        // isocentro = magnificação e erro no cálculo automático de dose.
        getIsoOffsetCm: function () {
          if (!patientPlaced) return null;
          var v = new THREE.Vector3();
          patientPose.getWorldPosition(v);
          return (v.y - ISO_Y) * 100;
        },
        stop: function () { abortAutoDrive("Aquisição interrompida pela workstation."); }
      };

      // -----------------------------------------------------------
      // Loop de animação, física e intertravamento de segurança
      // -----------------------------------------------------------
      var last = performance.now();

      function animate(now) {
        var dt = Math.min(0.05, (now - last) / 1000);
        last = now;

        var nextY = tableY, nextZ = tableZ;
        alertStatus = "";

        // Contexto: a mesa está (ou vai ficar) dentro do gantry?
        var isInsideBore = tableZ < BORE_SAFE_Z;

        // Limites de altura dependem do contexto:
        //   • Dentro do gantry: 64–88 cm (GANTRY_Y_MIN/MAX)
        //   • Fora do gantry:   50–88 cm (TABLE_Y_MIN / TABLE_Y_MAX)
        var yMin = isInsideBore ? GANTRY_Y_MIN : TABLE_Y_MIN;
        var yMax = isInsideBore ? GANTRY_Y_MAX : TABLE_Y_MAX;

        if (autoDrive) {
          // Aquisição em curso: a MESA é comandada pelo protocolo (topograma
          // ou helicoidal). Comandos manuais ficam suspensos; o Stop físico
          // ou o Stop da workstation abortam.
          var adDir = (autoDrive.targetZ >= tableZ) ? 1 : -1;
          nextZ = tableZ + adDir * autoDrive.speed * dt;
          if ((adDir > 0 && nextZ >= autoDrive.targetZ) || (adDir < 0 && nextZ <= autoDrive.targetZ)) {
            nextZ = autoDrive.targetZ;
          }
          nextZ = Math.max(TABLE_Z_MIN, Math.min(TABLE_Z_MAX, nextZ));
        } else {
          if (moveUp) nextY = Math.min(yMax, tableY + SPEED_Y * dt);
          if (moveDown) nextY = Math.max(yMin, tableY - SPEED_Y * dt);
          if (moveIn) nextZ = Math.max(TABLE_Z_MIN, tableZ - SPEED_Z * dt);
          if (moveOut) nextZ = Math.min(TABLE_Z_MAX, tableZ + SPEED_Z * dt);
        }

        // Intertravamento de entrada: só permite entrar no gantry se a
        // altura estiver dentro da faixa segura (64–88 cm), evitando
        // colisão com a estrutura do bore.
        var willEnterBore = nextZ < BORE_SAFE_Z && tableZ >= BORE_SAFE_Z;
        var isHeightSafe = nextY >= GANTRY_Y_MIN && nextY <= GANTRY_Y_MAX;

        if (willEnterBore && !isHeightSafe) {
          nextZ = tableZ;
          alertStatus = "ALTURA INCOMPATÍVEL para entrada no gantry (ajuste para 64–88 cm)";
        }

        var moved = tableY !== nextY || tableZ !== nextZ;
        if (moved) {
          tableY = nextY;
          tableZ = nextZ;
          applyTablePose();
        }

        var anyMoveFlag = moveUp || moveDown || moveIn || moveOut;
        setIndicator("motion", (anyMoveFlag || !!autoDrive) && moved);

        if (autoDrive) {
          var ad = autoDrive;
          if (alertStatus) {
            // Intertravamento bloqueou (ex.: altura incompatível na entrada)
            autoDrive = null; setSpin(0);
            if (ad.onAbort) ad.onAbort(alertStatus);
          } else {
            var span = Math.abs(ad.targetZ - ad.startZ);
            var prog = span > 0 ? Math.min(1, Math.abs(tableZ - ad.startZ) / span) : 1;
            if (ad.onProgress) ad.onProgress(prog, tableZ);
            if (tableZ === ad.targetZ) {
              autoDrive = null; setSpin(0);
              if (ad.onDone) ad.onDone();
            }
          }
        }

        if (spinRotTime > 0) {
          spinArc.rotation.z -= (Math.PI * 2 / spinRotTime) * dt;
        }

        if (alertStatus) {
          showMessage(alertStatus, "warning");
        }

        var speedMmS = 0;
        if (autoDrive) speedMmS = autoDrive.speed * 1000;
        else if (moveIn || moveOut) speedMmS = SPEED_Z * 1000;
        else if (moveUp || moveDown) speedMmS = SPEED_Y * 1000;
        updateReadouts(speedMmS);

        if (laserOn) {
          var pulse = 0.8 + Math.sin(now * 0.006) * 0.2;
          laserLineMat.opacity = pulse;
          updateLasers();
        }

        renderer.render(scene, camera);
        requestAnimationFrame(animate);
      }

      updateReadouts(0);
      window.__ctSimulator = {
        scene: scene, camera: camera, renderer: renderer,
        gantryGroup: gantryGroup, tableGroup: tableGroup,
      };

      requestAnimationFrame(function () {
        if (loadingOverlay) loadingOverlay.setAttribute("data-hidden", "true");
      });
      requestAnimationFrame(animate);

      showMessage(
        "Simulador carregado (largura da janela: " + window.innerWidth + "px). Este ambiente é exclusivamente educacional e não deve ser utilizado para qualquer finalidade clínica ou diagnóstica.",
        "info"
      );
    } catch (error) {
      console.error("Falha ao inicializar a cena 3D:", error);
      window.__ctSimulatorErrorReported = true;
      showMessage(
        "Não foi possível inicializar a visualização 3D: " + (error && error.message ? error.message : String(error)),
        "error"
      );
    }
  }

  // =================================================================
  // BANCO DO APP (IndexedDB) + REGIÕES — infraestrutura compartilhada
  // Banco único "simuladorTC" (v2) com stores "protocolos" e "pacientes",
  // usado pelos módulos de protocolos e de cadastro de pacientes.
  // =================================================================
  var REGIOES = ["Crânio", "Pescoço", "Tórax", "Abdome", "Pelve", "Coluna", "Membros"];
  var APP_DB_NAME = "simuladorTC", APP_DB_VER = 2;
  function openAppDB() {
    return new Promise(function (resolve, reject) {
      if (!("indexedDB" in window) || !window.indexedDB) { reject(new Error("IndexedDB indisponível")); return; }
      var req = window.indexedDB.open(APP_DB_NAME, APP_DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("protocolos")) db.createObjectStore("protocolos", { keyPath: "id" });
        if (!db.objectStoreNames.contains("pacientes")) db.createObjectStore("pacientes", { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("Falha ao abrir IndexedDB")); };
    });
  }
  function dbStoreAll(store) {
    return openAppDB().then(function (db) {
      return new Promise(function (res, rej) {
        var r = db.transaction(store, "readonly").objectStore(store).getAll();
        r.onsuccess = function () { res(r.result || []); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }
  function dbStorePut(store, o) {
    return openAppDB().then(function (db) {
      return new Promise(function (res, rej) {
        var r = db.transaction(store, "readwrite").objectStore(store).put(o);
        r.onsuccess = function () { res(); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }
  function dbStoreDel(store, id) {
    return openAppDB().then(function (db) {
      return new Promise(function (res, rej) {
        var r = db.transaction(store, "readwrite").objectStore(store).delete(id);
        r.onsuccess = function () { res(); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }

  // =================================================================
  // WORKSTATION — CADASTRO DE PACIENTES (quadrante inferior esquerdo)
  // Formulário (prontuário, nome, sexo, idade, região) + lista persistida.
  // Os pacientes cadastrados alimentam a lista "Exames" da aquisição.
  // Nenhum dado clínico é presumido.
  // =================================================================
  // Ponte entre cadastro e aquisição: UM exame por vez, sem memória —
  // ao encerrar a simulação o registro do paciente é apagado.
  var examSessionApi = null;
  // Protocolo selecionado para o exame (nome exibido na tela de aquisição).
  var examProtocol = { name: "", data: null, refresh: null };
  var tableDriveApi = null; // preenchida pela cena 3D (aquisição dirigida pela mesa)
  var consoleUiApi = null;  // preenchida pelo console guiado (modo/etapa atuais)

  function initPatients() {
    var fPront = document.getElementById("pac-prontuario");
    var fNome = document.getElementById("pac-nome");
    var fSexo = document.getElementById("pac-sexo");
    var fIdade = document.getElementById("pac-idade");
    var fRegiao = document.getElementById("pac-regiao");
    var btnAdd = document.getElementById("pac-add");
    var listEl = document.getElementById("pac-list");
    var examList = document.getElementById("ws-patient-list");
    if (!fNome || !btnAdd || !listEl) return;

    var pacientes = [];
    var memoryFallback = false;

    if (fRegiao && !fRegiao.options.length) {
      REGIOES.forEach(function (r) {
        var o = document.createElement("option");
        o.value = r; o.textContent = r;
        fRegiao.appendChild(o);
      });
    }

    function persist(o) { if (memoryFallback) return Promise.resolve(); return dbStorePut("pacientes", o).catch(function () { memoryFallback = true; }); }
    function persistDel(id) { if (memoryFallback) return Promise.resolve(); return dbStoreDel("pacientes", id).catch(function () { memoryFallback = true; }); }

    function currentPatient() { return pacientes.length ? pacientes[pacientes.length - 1] : null; }

    function renderExamList() {
      if (!examList) return;
      examList.innerHTML = "";
      var p = currentPatient();
      var li = document.createElement("li");
      li.className = "ws-list__item" + (p ? " ws-list__item--active" : "");
      var nm = document.createElement("span"); nm.className = "ws-list__name";
      var meta = document.createElement("span"); meta.className = "ws-list__meta";
      if (!p) {
        nm.textContent = "Nenhum paciente em exame";
        meta.textContent = "Cadastre o paciente para iniciar";
      } else {
        nm.textContent = p.nome + (p.prontuario ? " · " + p.prontuario : "");
        var parts = [p.regiao, p.idade ? p.idade + " anos" : "", p.sexo].filter(Boolean);
        if (examProtocol.name) parts.push("Prot.: " + examProtocol.name);
        meta.textContent = parts.join(" · ") || "Em exame";
      }
      li.appendChild(nm); li.appendChild(meta);
      examList.appendChild(li);
    }
    examProtocol.refresh = renderExamList;

    // API usada pelo viewer: um exame por vez; encerrar apaga o registro.
    examSessionApi = {
      get: currentPatient,
      end: function () {
        var p = currentPatient();
        if (!p) return Promise.resolve();
        return persistDel(p.id).then(function () {
          pacientes = pacientes.filter(function (x) { return x.id !== p.id; });
          renderList(); renderExamList();
        });
      }
    };

    function renderList() {
      listEl.innerHTML = "";
      if (pacientes.length === 0) {
        var empty = document.createElement("li");
        empty.className = "pac-list__empty";
        empty.textContent = "Nenhum paciente cadastrado ainda.";
        listEl.appendChild(empty);
        return;
      }
      pacientes.forEach(function (p) {
        var li = document.createElement("li");
        li.className = "pac-list__item";
        var info = document.createElement("div"); info.className = "pac-list__info";
        var nm = document.createElement("span"); nm.className = "pac-list__name"; nm.textContent = p.nome;
        var meta = document.createElement("span"); meta.className = "pac-list__meta";
        meta.textContent = [p.prontuario ? "Pront. " + p.prontuario : "", p.sexo, p.idade ? p.idade + " anos" : "", p.regiao].filter(Boolean).join(" · ");
        info.appendChild(nm); info.appendChild(meta);
        var del = document.createElement("button");
        del.type = "button"; del.className = "pac-list__del"; del.setAttribute("aria-label", "Excluir paciente"); del.textContent = "✕";
        del.addEventListener("click", function () {
          if (!window.confirm("Excluir o paciente \"" + p.nome + "\"?")) return;
          persistDel(p.id).then(function () {
            pacientes = pacientes.filter(function (x) { return x.id !== p.id; });
            renderList(); renderExamList();
          });
        });
        li.appendChild(info); li.appendChild(del);
        listEl.appendChild(li);
      });
    }

    function addPatient() {
      var nome = (fNome.value || "").trim();
      if (!nome) { fNome.focus(); showMessage("Informe o nome do paciente.", "warning"); return; }
      var novo = {
        id: "pac_" + Date.now(),
        prontuario: fPront ? (fPront.value || "").trim() : "",
        nome: nome,
        sexo: fSexo ? fSexo.value : "",
        idade: fIdade ? (fIdade.value || "").trim() : "",
        regiao: fRegiao ? fRegiao.value : ""
      };
      pacientes.push(novo);
      persist(novo).then(function () {
        renderList(); renderExamList();
        if (fPront) fPront.value = "";
        fNome.value = "";
        if (fIdade) fIdade.value = "";
        fNome.focus();
        showMessage("Paciente \"" + novo.nome + "\" cadastrado" + (memoryFallback ? " (temporário)." : "."), "success");
      });
    }

    btnAdd.addEventListener("click", addPatient);
    fNome.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addPatient(); } });

    dbStoreAll("pacientes")
      .catch(function (err) { memoryFallback = true; showMessage("Cadastro em modo temporário: " + err.message, "info"); return []; })
      .then(function (list) { pacientes = list || []; renderList(); renderExamList(); });
  }

  // =================================================================
  // WORKSTATION — PROTOCOLOS (CRUD + persistência em IndexedDB)
  // Aditivo e isolado do ambiente 3D. Semeia "Crânio" e "Tórax" com
  // campos VAZIOS: os valores técnicos são preenchidos/validados pelo
  // operador (não são presumidos aqui). O mesmo banco poderá guardar as
  // configurações da Etapa 7. Se o IndexedDB não estiver disponível
  // (ex.: modo privado), cai para um cache em memória (sem persistir).
  // =================================================================
  function initWorkstationProtocols() {
    var regionLabel = document.getElementById("proto-region-label");
    var listEl = document.getElementById("proto-list");
    var emptyEl = document.getElementById("proto-empty");
    var btnNew = document.getElementById("proto-new");
    var editor = document.getElementById("proto-editor");
    var actionsView = document.getElementById("ws-actions-view");
    var actionsEdit = document.getElementById("ws-actions-edit");
    var btnEdit = document.getElementById("ws-protocol-edit");
    var btnSave = document.getElementById("ws-protocol-save");
    var btnCancel = document.getElementById("ws-protocol-cancel");
    // Layout PC — editor em quadrante inteiro (classe is-editing no pane)
    var protoPane = document.getElementById("pane-proto");
    var editorTitle = document.getElementById("proto-editor-title");
    var zones = document.querySelectorAll("[data-region]");
    if (!listEl || !editor || !regionLabel) return;

    var FIELDS = ["kv", "mas", "pitch", "direcao", "colim", "thick", "kernel", "fov", "dose"];
    var FIELD_KEYS = { kv: "kv", mas: "mas", pitch: "pitch", direcao: "direcao", colim: "colimacao", thick: "espessura", kernel: "kernel", fov: "fov", dose: "dose" };
    function inputEl(f) { return document.getElementById("ws-param-" + f); }

    var protocols = [];
    var currentRegion = null;
    var currentId = null;
    var mode = "view";
    var memoryFallback = false;

    function blank(id, nome, regiao) {
      return { id: id, nome: nome, regiao: regiao, kv: "", mas: "", pitch: "", direcao: "caudocranial", colimacao: "", espessura: "", kernel: "", fov: "", dose: "", obs: "" };
    }

    // Etapa D — valores DIDÁTICOS de referência (AAPM / DRLs) para TC de crânio.
    // Editáveis pelo usuário; ele é o responsável técnico pelos parâmetros finais.
    function cranioDefaults() {
      return {
        kv: "120",
        mas: "300",
        pitch: "1,2",
        direcao: "caudocranial",
        colimacao: "64 × 0,6 mm",
        espessura: "5,0 mm encéfalo / 1,25 mm osso",
        kernel: "Encéfalo (liso) + Osso (nítido)",
        fov: "220–250 mm",
        dose: "≈55 mGy (ref.)"
      };
    }
    function cranioObs() { return "Valores didáticos de referência (AAPM/DRL). Ajuste conforme o serviço."; }
    function isClinicallyBlank(p) {
      return !(p.kv || p.mas || p.pitch || p.colimacao || p.espessura || p.kernel || p.fov || p.dose);
    }
    function applyCranioDefaultsIfBlank() {
      protocols.forEach(function (p) {
        if (p.id === "cranio" && isClinicallyBlank(p)) {
          var d = cranioDefaults();
          for (var k in d) { if (d.hasOwnProperty(k)) p[k] = d[k]; }
          if (!p.obs) p.obs = cranioObs();
          persist(p);
        }
      });
    }

    // Catálogo canônico de protocolos por região (fixos — NÃO podem ser
    // apagados). Nomes didáticos definidos pelo operador; parâmetros dos
    // demais ficam em branco até ele preencher/validar. ensureCatalog roda
    // a cada carga: recria o que faltar e re-preenche o crânio se vier em
    // branco (auto-recuperação contra estados antigos do banco).
    var CATALOGO = [
      { id: "cranio",   nome: "Crânio",           regiao: "Crânio" },
      { id: "face",     nome: "Face",             regiao: "Crânio" },
      { id: "saf",      nome: "Seios da face",    regiao: "Crânio" },
      { id: "orbitas",  nome: "Órbitas",          regiao: "Crânio" },
      { id: "atm",      nome: "ATM",              regiao: "Crânio" },
      { id: "pescoco",  nome: "Pescoço",          regiao: "Pescoço" },
      { id: "torax",    nome: "Tórax",            regiao: "Tórax" },
      { id: "torax_ar", nome: "Tórax AR (HRCT)",  regiao: "Tórax" },
      { id: "abd_total", nome: "Abdome total",    regiao: "Abdome" },
      { id: "abd_sup",  nome: "Abdome superior",  regiao: "Abdome" },
      { id: "pelve",    nome: "Pelve",            regiao: "Pelve" },
      { id: "col_cerv", nome: "Coluna cervical",  regiao: "Coluna" },
      { id: "col_tor",  nome: "Coluna torácica",  regiao: "Coluna" },
      { id: "col_lomb", nome: "Coluna lombar",    regiao: "Coluna" },
      { id: "memb_sup", nome: "Membro superior",  regiao: "Membros" },
      { id: "memb_inf", nome: "Membro inferior",  regiao: "Membros" }
    ];
    function ensureCatalog() {
      CATALOGO.forEach(function (c) {
        if (!byId(c.id)) {
          var novo = blank(c.id, c.nome, c.regiao);
          protocols.push(novo);
          persist(novo);
        }
      });
      applyCranioDefaultsIfBlank();
    }
    function cranioSeed() {
      var p = blank("cranio", "Crânio", "Crânio");
      var d = cranioDefaults();
      for (var k in d) { if (d.hasOwnProperty(k)) p[k] = d[k]; }
      p.obs = cranioObs();
      return p;
    }
    function seedDefaults() { return [cranioSeed(), blank("torax", "Tórax", "Tórax")]; }
    function persist(o) { if (memoryFallback) return Promise.resolve(); return dbStorePut("protocolos", o).catch(function () { memoryFallback = true; }); }

    function inRegion() { return protocols.filter(function (p) { return p.regiao === currentRegion; }); }
    function byId(id) { for (var i = 0; i < protocols.length; i++) if (protocols[i].id === id) return protocols[i]; return null; }

    function highlightZones() {
      for (var i = 0; i < zones.length; i++) {
        zones[i].classList.toggle("is-active", zones[i].getAttribute("data-region") === currentRegion);
      }
    }
    function fillFields(p) {
      FIELDS.forEach(function (f) { var el = inputEl(f); if (el) el.value = p ? (p[FIELD_KEYS[f]] || "") : ""; });
      var dirEl = inputEl("direcao");
      if (dirEl && !dirEl.value) dirEl.value = "caudocranial"; // protocolos antigos sem o campo
    }
    function setMode(m) {
      mode = m;
      var editing = (m === "edit");
      FIELDS.forEach(function (f) { var el = inputEl(f); if (el) el.disabled = !editing; });
      if (actionsView) actionsView.hidden = editing;
      if (actionsEdit) actionsEdit.hidden = !editing;
    }

    // Editor ocupa o quadrante inteiro (esconde mapa/lista via is-editing);
    // Salvar/Cancelar voltam à visão padrão. Evita a barra de rolagem.
    function openEditor() {
      var p = byId(currentId);
      if (!p) return;
      fillFields(p);
      if (editorTitle) editorTitle.textContent = p.nome + " — " + p.regiao;
      editor.hidden = false;
      if (protoPane) protoPane.classList.add("is-editing");
      setMode("edit");
    }
    function closeEditor() {
      editor.hidden = true;
      if (protoPane) protoPane.classList.remove("is-editing");
      setMode("view");
    }

    function renderList() {
      listEl.innerHTML = "";
      var items = inRegion();
      if (emptyEl) emptyEl.hidden = items.length !== 0;
      items.forEach(function (p) {
        var li = document.createElement("li");
        li.className = "proto-list__item" + (p.id === currentId ? " is-active" : "");
        li.textContent = p.nome;
        li.setAttribute("data-id", p.id);
        li.addEventListener("click", function () { selectProtocol(p.id); });
        listEl.appendChild(li);
      });
    }
    function selectRegion(region) {
      currentRegion = region;
      currentId = null;
      highlightZones();
      regionLabel.textContent = region;
      if (btnNew) btnNew.hidden = false;
      if (btnEdit) btnEdit.hidden = true;
      closeEditor();
      renderList();
    }
    function selectProtocol(id) {
      currentId = id;
      renderList();
      var p = byId(id);
      fillFields(p);
      // O editor só abre pelo botão Editar (quadrante inteiro).
      if (btnEdit) btnEdit.hidden = !p;
      // Este é o protocolo que será usado no exame (aparece na aquisição).
      examProtocol.name = p ? p.nome : "";
      examProtocol.data = p || null;
      if (examProtocol.refresh) examProtocol.refresh();
    }

    if (btnEdit) btnEdit.addEventListener("click", function () { if (currentId) openEditor(); });
    if (btnCancel) btnCancel.addEventListener("click", function () { fillFields(byId(currentId)); closeEditor(); });
    if (btnSave) btnSave.addEventListener("click", function () {
      var p = byId(currentId); if (!p) { closeEditor(); return; }
      FIELDS.forEach(function (f) { var el = inputEl(f); if (el) p[FIELD_KEYS[f]] = el.value.trim(); });
      persist(p).then(function () { closeEditor(); showMessage("Protocolo \"" + p.nome + "\" salvo" + (memoryFallback ? " (temporário)." : "."), "success"); });
    });
    if (btnNew) btnNew.addEventListener("click", function () {
      if (!currentRegion) { showMessage("Selecione uma região no modelo primeiro.", "warning"); return; }
      var nome = window.prompt("Nome do novo protocolo (" + currentRegion + "):", "");
      if (nome === null) return; nome = nome.trim(); if (!nome) return;
      var novo = blank("p_" + Date.now(), nome, currentRegion);
      protocols.push(novo);
      persist(novo).then(function () { selectProtocol(novo.id); openEditor(); });
    });

    for (var z = 0; z < zones.length; z++) {
      (function (el) {
        el.style.cursor = "pointer";
        el.addEventListener("click", function () { selectRegion(el.getAttribute("data-region")); });
      })(zones[z]);
    }

    dbStoreAll("protocolos").then(function (list) {
      if (!list || list.length === 0) {
        var d = seedDefaults();
        return Promise.all(d.map(function (x) { return dbStorePut("protocolos", x); })).then(function () { return d; });
      }
      return list;
    }).catch(function (err) {
      memoryFallback = true;
      showMessage("Protocolos em modo temporário: " + err.message, "info");
      return seedDefaults();
    }).then(function (list) {
      protocols = list;
      ensureCatalog();
      selectRegion("Crânio");
    });
  }

  // =================================================================
  // WORKSTATION — VIEWER DE CORTES (volume real de crânio)
  // Carrega, sob demanda, a pilha de PNGs convertida do volume NRRD (real,
  // anonimizado, licença livre) descrita em assets/volumes/cranio/manifest.json.
  // Navegação por slider ou roda do mouse. Sem parser NRRD no navegador.
  // A janela é apenas de EXIBIÇÃO — não é interpretação diagnóstica.
  // =================================================================
  function initWorkstationViewer() {
    var box = document.getElementById("ws-slice-viewer");
    var img = document.getElementById("ws-slice-img");
    var placeholder = document.getElementById("ws-viewer-placeholder");
    var ctrl = document.getElementById("ws-viewer-ctrl");
    var slider = document.getElementById("ws-slice-slider");
    var counter = document.getElementById("ws-slice-counter");
    var startBtn = document.getElementById("ws-exam-start");
    var stopBtn = document.getElementById("ws-exam-stop");
    var moveBtn = document.getElementById("ws-exam-move");
    var reportBtn = document.getElementById("ws-exam-report");
    var reportEl = document.getElementById("ws-report");
    var caption = document.getElementById("ws-viewer-caption");
    var topo = document.getElementById("ws-topo");
    var topoImg = document.getElementById("ws-topo-img");
    var topoBox = document.getElementById("ws-topo-box");
    var readout = document.getElementById("ws-topo-readout");
    var lines = topoBox ? topoBox.querySelectorAll(".ws-topo__line") : [];
    if (!box || !img || !slider || !startBtn) return;

    var BASE = "assets/volumes/cranio/";
    var REV = "20260713a"; // bump ao trocar assets — quebra cache do GitHub Pages
    function bust(path) { return BASE + path + (path.indexOf("?") < 0 ? "?v=" + REV : "&v=" + REV); }
    var manifest = null;
    var loaded = false;
    // idle → topoAcq (varredura) → plan (linhas) → volAcq (mesa+cortes) → review
    var phase = "idle";
    var topoAnim = null;   // requestAnimationFrame da varredura do topograma
    var volTimer = null;   // intervalo da aquisição corte a corte
    var TOPO_MS = 4000;    // fallback (sem cena 3D): duração da varredura
    var VOL_MS = 6500;     // fallback (sem cena 3D): duração do volume
    // Física didática da aquisição (mesa REAL comanda a imagem):
    var TOPO_LEN_MM = 300;   // comprimento coberto pelo topograma inteiro
    var TOPO_SPEED_MMS = 100;// velocidade da mesa no scout (tubo estacionário)
    var ROT_S = 1.0;         // tempo de rotação do gantry (s/volta) no helicoidal

    // Caixa de planejamento (%). Zonas-alvo recalibradas para o topograma
    // HORIZONTAL correto (decúbito dorsal: face p/ CIMA, VÉRTICE à ESQUERDA,
    // base à direita — rotação anti-horária do original, confirmada pela
    // posição dos dentes/mandíbula). Faixa CC = linhas verticais
    // (esquerda=vértice, direita=base); FOV A-P = horizontais.
    // Didáticas — validação clínica do usuário.
    var DEFAULT_BOX = { top: 42, bottom: 94, left: 7, right: 66 };
    var boxState = { top: 42, bottom: 94, left: 7, right: 66 };
    var TARGET = { top: [30, 54], bottom: [84, 100], left: [2, 18], right: [56, 76] };
    var MIN_GAP = 6; // % mínimo entre linhas opostas
    var lastSlice = 0; // último corte pintado na aquisição (p/ review)
    var lastAcq = null; // parâmetros da última aquisição (p/ relatório)

    // Anuncia a fase do exame (idle/topoAcq/plan/moving/volAcq/review)
    // para módulos desacoplados — ex.: o PiP da sala 3D no modo console.
    function announcePhase(p) {
      try { document.dispatchEvent(new CustomEvent("ct:phase", { detail: { phase: p } })); } catch (e) { /* sem suporte */ }
    }
    // Referência espacial do topograma: onde a mesa ESTAVA quando cada
    // ponto da imagem foi varrido. Permite ao MOVER levar a mesa de volta
    // à posição inicial da faixa planejada (como no equipamento real).
    var topoRef = null;   // { startZ (m), dir }
    var atStart = false;  // mesa está na posição inicial da faixa?
    var isMoving = false; // MOVER em andamento

    // Posição (m) da mesa correspondente ao INÍCIO da faixa planejada.
    // Mapa imagem→mesa: fração x da imagem (0=esquerda/VÉRTICE, 1=direita/
    // base). Caudo-cranial: mesa SAI, varredura base→vértice (imagem revela
    // direita→esquerda; f = 1−k). Crânio-caudal: mesa ENTRA, vértice→base
    // (f = k). O início da faixa é a extremidade correspondente.
    function volumeStartZ() {
      if (!topoRef) return null;
      var L = TOPO_LEN_MM / 1000;
      if (topoRef.dir === "craniocaudal") {
        var k0 = boxState.left / 100;             // até o vértice planejado
        return topoRef.startZ - L * k0;
      }
      var k0c = 1 - (boxState.right / 100);       // até a base planejada
      return topoRef.startZ + L * k0c;
    }

    // Ajusta o topograma para caber no quadrante preservando a proporção
    // (o box das linhas casa exatamente com a imagem).
    function fitTopo() {
      if (!topo || topo.hidden || !box) return;
      var natW = topoImg.naturalWidth || 814;
      var natH = topoImg.naturalHeight || 700;
      var r = box.getBoundingClientRect();
      var availW = Math.max(60, r.width - 24);
      var availH = Math.max(60, r.height - 24);
      var s = Math.min(availW / natW, availH / natH);
      topo.style.width = Math.max(1, Math.floor(natW * s)) + "px";
      topo.style.height = Math.max(1, Math.floor(natH * s)) + "px";
    }

    // Parâmetros do protocolo selecionado (direção, pitch, colimação) com
    // interpretação tolerante ("1,2", "64 × 0,6 mm", "40 mm"...).
    function protocolParams() {
      var p = (examProtocol && examProtocol.data) || {};
      function num(s) {
        if (!s) return NaN;
        var m = String(s).replace(/,/g, ".").match(/\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : NaN;
      }
      function colimMm(s) {
        if (!s) return 38.4;
        var ms = String(s).replace(/,/g, ".").match(/\d+(\.\d+)?/g);
        if (!ms || !ms.length) return 38.4;
        if (ms.length >= 2) return parseFloat(ms[0]) * parseFloat(ms[1]); // "64 × 0,6 mm"
        return parseFloat(ms[0]);                                        // "40 mm"
      }
      var pitch = num(p.pitch);
      if (!(pitch > 0)) pitch = 1.0;
      return {
        direcao: p.direcao === "craniocaudal" ? "craniocaudal" : "caudocranial",
        pitch: pitch,
        colim: colimMm(p.colimacao)
      };
    }

    // ---- som da máquina (WebAudio sintetizado — offline, sem assets) ----
    var audio = { ctx: null, master: null, nodes: [] };
    function soundStart(mode, rotTimeS) {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!audio.ctx) audio.ctx = new AC();
        var ctx = audio.ctx;
        if (ctx.state === "suspended") ctx.resume();
        soundStop();
        var t = ctx.currentTime;
        var master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, t);
        master.gain.exponentialRampToValueAtTime(mode === "vol" ? 0.13 : 0.06, t + 0.5);
        master.connect(ctx.destination);
        // zumbido grave (motor da mesa / rotor do gantry)
        var osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = mode === "vol" ? 52 : 36;
        var oscGain = ctx.createGain(); oscGain.gain.value = 0.5;
        osc.connect(oscGain); oscGain.connect(master); osc.start();
        // ruído filtrado (ventilação/atrito)
        var len = ctx.sampleRate * 2;
        var buf = ctx.createBuffer(1, len, ctx.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        var noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
        var bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.8;
        bp.frequency.value = mode === "vol" ? 420 : 200;
        var nGain = ctx.createGain(); nGain.gain.value = 0.35;
        noise.connect(bp); bp.connect(nGain); nGain.connect(master); noise.start();
        if (mode === "vol" && rotTimeS > 0) {
          // "whoosh" periódico: uma modulação por rotação do gantry
          var lfo = ctx.createOscillator(); lfo.frequency.value = 1 / rotTimeS;
          var lfoGain = ctx.createGain(); lfoGain.gain.value = 0.22;
          lfo.connect(lfoGain); lfoGain.connect(nGain.gain); lfo.start();
          audio.nodes.push(lfo);
        }
        audio.master = master;
        audio.nodes.push(osc, noise);
      } catch (e) { /* áudio indisponível — segue sem som */ }
    }
    function soundStop() {
      try {
        var nodes = audio.nodes, m = audio.master, c = audio.ctx;
        audio.nodes = []; audio.master = null;
        if (m && c) {
          m.gain.cancelScheduledValues(c.currentTime);
          m.gain.setTargetAtTime(0.0001, c.currentTime, 0.08);
        }
        setTimeout(function () {
          nodes.forEach(function (n) { try { n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} });
          if (m) { try { m.disconnect(); } catch (e) {} }
        }, 350);
      } catch (e) { /* nada a fazer */ }
    }

    function pad3(n) { n = String(n); while (n.length < 3) n = "0" + n; return n; }
    function srcFor(i) { return bust("axial_" + pad3(i) + ".png"); }
    function show(i) {
      if (!manifest) return;
      i = i | 0;
      if (i < 0) i = 0;
      if (i > manifest.cortes - 1) i = manifest.cortes - 1;
      img.src = srcFor(i);
      slider.value = i;
      counter.textContent = "Corte " + (i + 1) + " / " + manifest.cortes;
    }

    // ---- caixa: render, validação, readout ----
    function applyBox() {
      if (!topoBox) return;
      topoBox.style.setProperty("--edge-top", boxState.top + "%");
      topoBox.style.setProperty("--edge-bottom", boxState.bottom + "%");
      topoBox.style.setProperty("--edge-left", boxState.left + "%");
      topoBox.style.setProperty("--edge-right", boxState.right + "%");
    }
    function inZone(v, z) { return v >= z[0] && v <= z[1]; }
    function problems() {
      var p = [];
      if (boxState.right - boxState.left < MIN_GAP) p.push("A faixa está invertida ou muito estreita (vértice à esquerda, base à direita).");
      else if (!inZone(boxState.left, TARGET.left)) p.push("Leve o limite esquerdo até o vértice.");
      else if (!inZone(boxState.right, TARGET.right)) p.push("Leve o limite direito até a base do crânio.");
      if (boxState.bottom - boxState.top < MIN_GAP) p.push("O FOV está invertido ou muito estreito.");
      else if (!inZone(boxState.top, TARGET.top) || !inZone(boxState.bottom, TARGET.bottom)) p.push("Ajuste o FOV para cobrir o crânio (anterior/posterior).");
      return p;
    }
    function renderReadout() {
      var probs = problems();
      var ok = probs.length === 0;
      if (topoBox) topoBox.classList.toggle("is-invalid", !ok);
      var gated = !!(tableDriveApi && topoRef); // com 3D: exige mesa em posição
      if (phase === "plan") {
        startBtn.disabled = !ok || isMoving || (gated && !atStart);
        if (moveBtn) {
          moveBtn.hidden = !gated;
          moveBtn.disabled = !ok || isMoving;
          // Realça o MOVER quando é a próxima ação (faixa válida, mesa fora
          // de posição) e tira o realce do Iniciar até a mesa chegar.
          moveBtn.classList.toggle("ws-btn--primary", gated && ok && !atStart && !isMoving);
          startBtn.classList.toggle("ws-btn--primary", !(gated && !atStart));
        }
      }
      if (!readout) return;
      var cc = Math.max(0, boxState.right - boxState.left).toFixed(0);
      var ap = Math.max(0, boxState.bottom - boxState.top).toFixed(0);
      var pp = protocolParams();
      var dirTxt = pp.direcao === "craniocaudal" ? "crânio-caudal (mesa entra)" : "caudo-cranial (mesa sai)";
      var msg = "Faixa CC: " + cc + "% · FOV A-P: " + ap + "% · Direção: " + dirTxt + ". ";
      var okMsg;
      if (!(tableDriveApi && topoRef)) okMsg = "Posição válida — Iniciar libera a aquisição.";
      else if (isMoving) okMsg = "Movendo a mesa para o início da faixa…";
      else if (atStart) okMsg = "Mesa em posição — Iniciar libera a aquisição.";
      else okMsg = "Faixa válida — use MOVER para levar a mesa ao início da varredura.";
      readout.innerHTML = ok
        ? msg + okMsg
        : msg + "<span class=\"is-bad\">" + probs[0] + "</span>";
    }

    // ---- arraste das 4 linhas ----
    function pctFromEvent(e, axis) {
      var r = topoImg.getBoundingClientRect();
      if (axis === "y") return ((e.clientY - r.top) / r.height) * 100;
      return ((e.clientX - r.left) / r.width) * 100;
    }
    function clampPct(v) { return Math.min(100, Math.max(0, v)); }
    Array.prototype.forEach.call(lines, function (line) {
      var edge = line.getAttribute("data-edge");
      var axis = (edge === "top" || edge === "bottom") ? "y" : "x";
      line.addEventListener("pointerdown", function (e) {
        if (phase !== "plan") return;
        e.preventDefault(); e.stopPropagation();
        try { line.setPointerCapture(e.pointerId); } catch (err) {}
        function move(ev) {
          boxState[edge] = clampPct(pctFromEvent(ev, axis)); // não impede cruzamento — validação bloqueia
          applyBox(); renderReadout();
        }
        function up() {
          try { line.releasePointerCapture(e.pointerId); } catch (err) {}
          line.removeEventListener("pointermove", move);
          line.removeEventListener("pointerup", up);
          line.removeEventListener("pointercancel", up);
          // Faixa mudou → a posição inicial mudou → exigir novo MOVER.
          if (atStart) { atStart = false; renderReadout(); }
        }
        line.addEventListener("pointermove", move);
        line.addEventListener("pointerup", up);
        line.addEventListener("pointercancel", up);
      });
    });

    // ---- fases e animações ----
    function stopAnimations() {
      if (topoAnim) { cancelAnimationFrame(topoAnim); topoAnim = null; }
      if (volTimer) { clearInterval(volTimer); volTimer = null; }
      soundStop();
      // Para a mesa se a aquisição estiver em curso. Os handlers onAbort
      // checam a fase — como ela já foi trocada, viram no-op (sem eco).
      if (tableDriveApi && tableDriveApi.isBusy && tableDriveApi.isBusy()) tableDriveApi.stop();
    }
    function toIdle() {
      phase = "idle"; loaded = false; lastSlice = 0; lastAcq = null;
      if (ctrl) ctrl.classList.remove("is-acquiring");
      announcePhase("idle");
      topoRef = null; atStart = false; isMoving = false;
      stopAnimations();
      img.hidden = true; ctrl.hidden = true;
      if (topo) topo.hidden = true;
      if (topoBox) topoBox.hidden = true;
      if (readout) readout.hidden = true;
      placeholder.hidden = false;
      startBtn.disabled = false; startBtn.textContent = "Iniciar";
      if (moveBtn) moveBtn.hidden = true;
      if (reportBtn) reportBtn.hidden = true;
      if (reportEl) reportEl.hidden = true;
      if (stopBtn) stopBtn.disabled = true;
      counter.textContent = "—";
      topoImg.style.clipPath = "";
    }

    // Topograma com física real: tubo ESTACIONÁRIO, a MESA translada o
    // paciente pelo gantry e a imagem se revela linha a linha em sincronia
    // com a posição real da mesa 3D. Orientação: VÉRTICE à esquerda, base
    // à direita. Direção do protocolo:
    //   caudo-cranial → mesa SAI (revela da base, à DIREITA, p/ o vértice)
    //   crânio-caudal → mesa ENTRA (revela do vértice, à ESQUERDA, p/ a base)
    function setTopoClip(k) {
      var pct = ((1 - k) * 100).toFixed(2);
      var pp = protocolParams();
      topoImg.style.clipPath = (pp.direcao === "craniocaudal")
        ? "inset(0 " + pct + "% 0 0)"
        : "inset(0 0 0 " + pct + "%)";
    }
    function toTopoAcq() {
      phase = "topoAcq";
      announcePhase("topoAcq");
      placeholder.hidden = true;
      img.hidden = true; ctrl.hidden = true;
      if (topo) topo.hidden = false;
      if (topoBox) topoBox.hidden = true;   // linhas só após completar
      if (readout) readout.hidden = true;
      startBtn.disabled = true; startBtn.textContent = "Adquirindo topograma…";
      if (stopBtn) stopBtn.disabled = false;
      setTopoClip(0);
      fitTopo();
      soundStart("topo", 0);
      if (tableDriveApi) {
        var pp = protocolParams();
        var res = tableDriveApi.start({
          distanceMm: TOPO_LEN_MM,
          direction: pp.direcao === "craniocaudal" ? "in" : "out",
          speedMmS: TOPO_SPEED_MMS,
          rotTimeS: 0, // scout: tubo estacionário, gantry não gira
          onProgress: function (k) { setTopoClip(k); },
          onDone: function () { soundStop(); toPlan(); },
          onAbort: function (motivo) {
            if (phase !== "topoAcq") return;
            soundStop(); toIdle();
            showMessage("Topograma abortado: " + motivo, "warning");
          }
        });
        if (!res.ok) {
          soundStop(); toIdle();
          showMessage(res.motivo, "warning");
          return;
        }
        topoRef = { startZ: res.startZ, dir: pp.direcao, isoOff: null };
        if (tableDriveApi.getIsoOffsetCm) {
          var off = tableDriveApi.getIsoOffsetCm();
          topoRef.isoOff = off;
          if (off != null && Math.abs(off) > 4) {
            showMessage("Atenção: eixo do paciente ~" + Math.abs(off).toFixed(0) + " cm " +
              (off > 0 ? "acima" : "abaixo") + " do isocentro — no equipamento real o topograma LATERAL sai magnificado e o cálculo automático de dose é afetado. Ajuste a ALTURA da mesa.", "warning");
          }
        }
        return;
      }
      topoRef = null; // fallback: sem sincronia com a mesa
      // Fallback (cena 3D indisponível): varredura por tempo, como antes.
      var t0 = performance.now();
      function frame(now) {
        var k = Math.min(1, (now - t0) / TOPO_MS);
        setTopoClip(k);
        if (k < 1) { topoAnim = requestAnimationFrame(frame); }
        else { topoAnim = null; soundStop(); toPlan(); }
      }
      topoAnim = requestAnimationFrame(frame);
    }

    function toPlan(keepBox) {
      phase = "plan";
      if (ctrl) ctrl.classList.remove("is-acquiring");
      announcePhase("plan");
      topoImg.style.clipPath = "";
      if (topoBox) topoBox.hidden = false;
      if (readout) readout.hidden = false;
      if (!keepBox) {
        boxState = { top: DEFAULT_BOX.top, bottom: DEFAULT_BOX.bottom, left: DEFAULT_BOX.left, right: DEFAULT_BOX.right };
      }
      startBtn.disabled = false; startBtn.textContent = "Iniciar";
      atStart = false; isMoving = false;
      fitTopo();
      applyBox(); renderReadout(); // renderReadout pode voltar a travar o Iniciar
      if (stopBtn) stopBtn.disabled = false;
      if (!keepBox) showMessage("Topograma adquirido — ajuste a faixa (base↔vértice) e o FOV, depois Iniciar.", "success");
    }

    // RELATÓRIO didático (fase de revisão): resume paciente, protocolo,
    // faixa/FOV, velocidade da mesa, isocentro e dose didática
    // (DLP = CTDIvol × comprimento). Sem validade clínica/dosimétrica.
    function buildReport() {
      var bodyEl = document.getElementById("ws-report-body");
      if (!bodyEl) return;
      var pac = (examSessionApi && examSessionApi.get) ? examSessionApi.get() : null;
      var prot = examProtocol ? examProtocol.data : null;
      var pp = (lastAcq && lastAcq.pp) || protocolParams();
      var scanLen = lastAcq ? lastAcq.scanLen : 0;
      var speed = lastAcq ? lastAcq.speed : 0;
      var dose = NaN;
      if (prot && prot.dose) {
        var m = String(prot.dose).replace(/,/g, ".").match(/\d+(\.\d+)?/);
        if (m) dose = parseFloat(m[0]);
      }
      var dlp = (dose > 0 && scanLen > 0) ? dose * (scanLen / 10) : NaN;
      var iso = topoRef ? topoRef.isoOff : null;
      var isoTxt = (iso == null)
        ? "não avaliado"
        : (Math.abs(iso) <= 4
          ? '<span class="is-good">no isocentro (' + iso.toFixed(1) + ' cm)</span>'
          : '<span class="is-bad">fora do isocentro (' + iso.toFixed(1) + ' cm) — magnificação no topograma lateral</span>');
      var rows = [];
      if (pac) rows.push("<strong>Paciente:</strong> " + pac.nome + " · " + (pac.prontuario ? "Pront. " + pac.prontuario : "s/ prontuário") + (pac.regiao ? " · " + pac.regiao : ""));
      rows.push("<strong>Protocolo:</strong> " + (prot ? prot.nome : "—") + " · direção " + (pp.direcao === "craniocaudal" ? "crânio-caudal (mesa entra)" : "caudo-cranial (mesa sai)"));
      rows.push("<strong>Faixa varrida:</strong> " + Math.round(scanLen) + " mm · <strong>FOV A-P:</strong> " + Math.max(0, boxState.bottom - boxState.top).toFixed(0) + "% da imagem");
      rows.push("<strong>Mesa:</strong> " + Math.round(speed) + " mm/s (pitch " + pp.pitch + " × colimação " + pp.colim.toFixed(1) + " mm ÷ rotação " + ROT_S.toFixed(1) + " s)");
      rows.push("<strong>Posicionamento no isocentro:</strong> " + isoTxt);
      if (!isNaN(dlp)) {
        rows.push("<strong>Dose (didática):</strong> DLP ≈ CTDIvol " + dose + " mGy × " + (scanLen / 10).toFixed(1) + " cm = <strong>" + dlp.toFixed(0) + " mGy·cm</strong>");
      }
      rows.push("<em>Valores didáticos para treinamento de operação — sem validade clínica ou dosimétrica.</em>");
      bodyEl.innerHTML = rows.join("<br>");
    }

    // MOVER — leva a mesa 3D até a posição inicial da faixa planejada
    // (como o comando de posicionamento do equipamento real). Só então o
    // Iniciar libera o volume; mexer nas linhas exige mover de novo.
    function onMove() {
      if (phase !== "plan" || !tableDriveApi || isMoving) return;
      if (problems().length) { renderReadout(); return; }
      var zs = volumeStartZ();
      if (zs == null) return;
      var cur = tableDriveApi.getPos();
      var distMm = Math.abs(zs - cur) * 1000;
      if (distMm < 2) {
        atStart = true; renderReadout();
        showMessage("Mesa já está na posição inicial da faixa.", "info");
        return;
      }
      isMoving = true;
      announcePhase("moving");
      renderReadout();
      soundStart("topo", 0);
      var res = tableDriveApi.start({
        distanceMm: distMm,
        direction: zs < cur ? "in" : "out",
        speedMmS: 100,
        rotTimeS: 0,
        label: "POSICIONANDO MESA",
        onDone: function () {
          soundStop(); isMoving = false;
          announcePhase("plan");
          // Se as linhas mudaram durante o movimento, a posição já não vale.
          var alvo = volumeStartZ();
          atStart = alvo != null && Math.abs(tableDriveApi.getPos() - alvo) * 1000 < 3;
          renderReadout();
          showMessage(atStart
            ? "Mesa na posição inicial da faixa — Iniciar libera a aquisição."
            : "A faixa foi alterada durante o movimento — use MOVER novamente.", atStart ? "success" : "warning");
        },
        onAbort: function (motivo) {
          if (phase !== "plan") return;
          soundStop(); isMoving = false; atStart = false;
          announcePhase("plan");
          renderReadout();
          showMessage("Movimentação interrompida: " + motivo, "warning");
        }
      });
      if (!res.ok) {
        soundStop(); isMoving = false;
        announcePhase("plan");
        renderReadout();
        showMessage(res.motivo, "warning");
      }
    }

    // Volume HELICOIDAL com física real: a mesa 3D avança continuamente
    // (v = pitch × colimação ÷ tempo de rotação) enquanto o gantry "gira"
    // (arco luminoso no bore + som); os cortes aparecem em sincronia com a
    // posição real da mesa, na ordem da direção programada no protocolo.
    // Premissa didática: axial_000 = corte mais INFERIOR (base) — a ordem
    // inverte no crânio-caudal. Validação clínica do usuário.
    function toVolAcq() {
      phase = "volAcq"; loaded = false;
      announcePhase("volAcq");
      if (topo) topo.hidden = true;
      if (readout) readout.hidden = true;
      img.hidden = false; ctrl.hidden = false;
      slider.disabled = true;
      startBtn.disabled = true; startBtn.textContent = "Adquirindo volume…";
      if (moveBtn) moveBtn.hidden = true;
      if (reportBtn) reportBtn.hidden = true;
      if (reportEl) reportEl.hidden = true;
      if (stopBtn) stopBtn.disabled = false;
      var total = manifest.cortes;
      var pp = protocolParams();
      // Comprimento da varredura = faixa CC planejada no topograma (mm)
      var scanLen = Math.max(20, ((boxState.right - boxState.left) / 100) * TOPO_LEN_MM);
      var speed = Math.max(10, Math.min(120, (pp.pitch * pp.colim) / ROT_S)); // mm/s
      lastAcq = { scanLen: scanLen, speed: speed, pp: pp };
      function paintProg(k) {
        var idx = Math.round(k * (total - 1));
        var n = (pp.direcao === "craniocaudal") ? (total - 1 - idx) : idx;
        lastSlice = n;
        img.src = srcFor(n);
        slider.value = n;
        counter.textContent = "ADQUIRINDO — corte " + (idx + 1) + " / " + total +
          " · mesa a " + Math.round(speed) + " mm/s";
      }
      if (ctrl) ctrl.classList.add("is-acquiring");
      paintProg(0);
      soundStart("vol", ROT_S);
      if (tableDriveApi) {
        var res = tableDriveApi.start({
          distanceMm: scanLen,
          direction: pp.direcao === "craniocaudal" ? "in" : "out",
          speedMmS: speed,
          rotTimeS: ROT_S, // liga o arco de varredura girando no bore
          onProgress: function (k) { paintProg(k); },
          onDone: function () { soundStop(); toReview(); },
          onAbort: function (motivo) {
            if (phase !== "volAcq") return;
            soundStop(); toPlan(true);
            showMessage("Aquisição do volume abortada: " + motivo, "warning");
          }
        });
        if (!res.ok) {
          soundStop(); toPlan(true);
          showMessage(res.motivo, "warning");
        }
        return;
      }
      // Fallback (cena 3D indisponível): corte a corte por tempo.
      var i = 0;
      var stepMs = Math.max(30, Math.round(VOL_MS / total));
      volTimer = setInterval(function () {
        i++;
        if (i >= total) {
          clearInterval(volTimer); volTimer = null;
          soundStop();
          toReview();
          return;
        }
        paintProg(i / (total - 1));
      }, stepMs);
    }

    function toReview() {
      phase = "review";
      if (ctrl) ctrl.classList.remove("is-acquiring");
      announcePhase("review");
      buildReport();
      // O relatório NÃO cobre a imagem automaticamente — foco no exame;
      // fica disponível no botão destacado.
      if (reportEl) reportEl.hidden = true;
      if (reportBtn) { reportBtn.hidden = false; reportBtn.classList.add("ws-btn--primary"); } loaded = true;
      slider.disabled = false;
      startBtn.disabled = true; startBtn.textContent = "Exame adquirido";
      if (stopBtn) stopBtn.disabled = false;
      show(lastSlice);
      showMessage("Aquisição concluída (" + manifest.cortes + " cortes). Navegue e finalize com Stop.", "success");
    }

    slider.addEventListener("input", function () { if (loaded) show(parseInt(slider.value, 10) || 0); });
    box.addEventListener("wheel", function (e) {
      if (!loaded) return;
      e.preventDefault();
      show((parseInt(slider.value, 10) || 0) + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });

    // Iniciar é contextual: em idle adquire o topograma; em plan (com a
    // caixa válida — senão fica travado) inicia a aquisição do volume.
    function onStart() {
      if (phase === "plan") {
        if (problems().length) { renderReadout(); return; }
        if (tableDriveApi && topoRef && !atStart) {
          showMessage("Use MOVER para levar a mesa à posição inicial da faixa antes de iniciar.", "warning");
          return;
        }
        toVolAcq();
        return;
      }
      if (phase !== "idle") return;
      if (examSessionApi && !examSessionApi.get()) {
        showMessage("Cadastre o paciente antes de iniciar o exame.", "warning");
        return;
      }
      if (tableDriveApi && !tableDriveApi.isPatientOnTable()) {
        showMessage("Posicione o paciente na mesa (botão Decúbito, na sala 3D) antes de iniciar a aquisição.", "warning");
        return;
      }
      if (manifest) {
        topoImg.src = bust(manifest.topograma_h || manifest.topograma || "topograma.png");
        toTopoAcq();
        return;
      }
      startBtn.disabled = true;
      startBtn.textContent = "Preparando…";
      fetch(bust("manifest.json"), { cache: "no-cache" }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (m) {
        manifest = m;
        slider.min = 0;
        slider.max = m.cortes - 1;
        if (caption && m.fonte) {
          caption.textContent = "Topograma ilustrativo (paciente distinto do volume) para planejar a faixa. Volume axial real de TC de crânio (" +
            m.fonte.nome + "). " + m.fonte.licenca + " Apenas visualização — sem interpretação diagnóstica.";
        }
        topoImg.src = bust(m.topograma_h || m.topograma || "topograma.png");
        toTopoAcq();
      }).catch(function (err) {
        startBtn.disabled = false;
        startBtn.textContent = "Iniciar";
        showMessage("Falha ao preparar o exame: " + err.message, "error");
      });
    }

    // Stop encerra a simulação em QUALQUER fase e apaga o registro do
    // paciente (um exame por vez, sem memória entre simulações).
    function onStop() {
      if (phase === "idle") return;
      var wasDone = (phase === "review");
      toIdle();
      var finish = (examSessionApi && examSessionApi.end) ? examSessionApi.end() : Promise.resolve();
      finish.then(function () {
        showMessage(wasDone
          ? "Exame finalizado — registro do paciente removido."
          : "Exame interrompido — registro do paciente removido.", "info");
      });
    }

    startBtn.addEventListener("click", onStart);
    if (stopBtn) stopBtn.addEventListener("click", onStop);
    if (moveBtn) moveBtn.addEventListener("click", onMove);
    var reportClose = document.getElementById("ws-report-close");
    if (reportClose) reportClose.addEventListener("click", function () { if (reportEl) reportEl.hidden = true; });
    if (reportBtn) reportBtn.addEventListener("click", function () {
      if (!reportEl) return;
      if (reportEl.hidden) buildReport();
      reportEl.hidden = !reportEl.hidden;
    });
    topoImg.addEventListener("load", fitTopo);
    window.addEventListener("resize", fitTopo);
  }

  // =================================================================
  // PAINEL DE 4 QUADRANTES — DIVISÓRIAS ARRASTÁVEIS (Opção B: colunas
  // independentes). 3 divisórias: vertical (largura das colunas) e uma
  // horizontal POR COLUNA — mexer na altura da direita não altera a
  // esquerda (e vice-versa). Tudo em FRAÇÕES (%): ao mover uma divisória
  // ou redimensionar a janela, os vizinhos preenchem o espaço em suas
  // proporções. Frações persistidas em localStorage; duplo clique na
  // divisória volta ao 50/50. A cada ajuste redispara "resize" para o
  // canvas 3D. Em telas estreitas/celular o layout empilha (CSS) e os
  // estilos inline são limpos para o CSS assumir.
  // =================================================================
  function initDashboardSplit() {
    var dash = document.getElementById("dashboard");
    var colLeft = document.getElementById("dash-col-left");
    var gv = document.getElementById("dash-gutter-v");
    var ghL = document.getElementById("dash-gutter-h-left");
    var ghR = document.getElementById("dash-gutter-h-right");
    var paneSim = document.getElementById("pane-sim");
    var paneAcq = document.getElementById("pane-acq");
    if (!dash || !colLeft || !gv || !ghL || !ghR || !paneSim || !paneAcq) return;

    var MIN = 120, GUT = 6, MOBILE = 900;
    var KEY = "simuladorTC.dashSplit";
    // Frações 0–1: col = largura da coluna esquerda; left/right = altura do
    // quadrante SUPERIOR de cada coluna. Os vizinhos (flex:1) ocupam o resto.
    var frac = { col: 0.5, left: 0.5, right: 0.5 };

    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved) {
        ["col", "left", "right"].forEach(function (k) {
          var v = parseFloat(saved[k]);
          if (!isNaN(v)) frac[k] = Math.min(0.95, Math.max(0.05, v));
        });
      }
    } catch (e) { /* sem persistência */ }

    function persistFrac() {
      try { localStorage.setItem(KEY, JSON.stringify(frac)); } catch (e) { /* sem persistência */ }
    }

    function clampPx(want, span) {
      return Math.max(MIN, Math.min(Math.max(MIN, span - MIN), want));
    }

    function apply() {
      if (document.body.classList.contains("is-mobile") ||
          document.body.classList.contains("console-mode") ||
          window.innerWidth < MOBILE) {
        colLeft.style.flex = "";
        paneSim.style.flex = "";
        paneAcq.style.flex = "";
        return;
      }
      var w = dash.clientWidth - GUT;       // largura útil (menos a divisória vertical)
      var h = dash.clientHeight - GUT;      // altura útil de cada coluna (menos a divisória)
      colLeft.style.flex = "0 0 " + clampPx(frac.col * w, w) + "px";
      paneSim.style.flex = "0 0 " + clampPx(frac.left * h, h) + "px";
      paneAcq.style.flex = "0 0 " + clampPx(frac.right * h, h) + "px";
    }

    var raf = null;
    function scheduleResize() {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = null; window.dispatchEvent(new Event("resize")); });
    }

    function makeDraggable(gutter, key, axis) {
      gutter.addEventListener("pointerdown", function (e) {
        if (document.body.classList.contains("is-mobile") ||
            document.body.classList.contains("console-mode") ||
            window.innerWidth < MOBILE) return;
        e.preventDefault();
        try { gutter.setPointerCapture(e.pointerId); } catch (err) {}
        dash.classList.add("dashboard--dragging");
        function move(ev) {
          var r = dash.getBoundingClientRect();
          var f = (axis === "x")
            ? (ev.clientX - r.left - GUT / 2) / Math.max(1, r.width - GUT)
            : (ev.clientY - r.top - GUT / 2) / Math.max(1, r.height - GUT);
          frac[key] = Math.min(0.95, Math.max(0.05, f));
          apply();
          scheduleResize();
        }
        function up() {
          try { gutter.releasePointerCapture(e.pointerId); } catch (err) {}
          gutter.removeEventListener("pointermove", move);
          gutter.removeEventListener("pointerup", up);
          gutter.removeEventListener("pointercancel", up);
          dash.classList.remove("dashboard--dragging");
          persistFrac();
          window.dispatchEvent(new Event("resize"));
        }
        gutter.addEventListener("pointermove", move);
        gutter.addEventListener("pointerup", up);
        gutter.addEventListener("pointercancel", up);
      });
      // Duplo clique: volta esta divisória ao 50/50.
      gutter.addEventListener("dblclick", function () {
        frac[key] = 0.5;
        apply();
        persistFrac();
        window.dispatchEvent(new Event("resize"));
      });
    }
    makeDraggable(gv, "col", "x");
    makeDraggable(ghL, "left", "y");
    makeDraggable(ghR, "right", "y");

    window.addEventListener("resize", apply);
    apply();
  }

  // =================================================================
  // MODO CELULAR — duas telas (Posição 3D / Comando), foco em paisagem
  // Botão discreto liga/desliga; seletor flutuante alterna as telas.
  // A cada troca redispara "resize" para o canvas 3D se reajustar.
  // Não altera cena, física, laser nem posicionamento.
  // =================================================================
  function initMobileMode() {
    var btn = document.getElementById("mobile-toggle");
    var sw = document.getElementById("mobile-switch");
    var bPos = document.getElementById("mob-view-pos");
    var bCmd = document.getElementById("mob-view-cmd");
    var bExit = document.getElementById("mob-exit");
    var body = document.body;
    if (!btn || !sw) return;

    function pokeResize() { window.dispatchEvent(new Event("resize")); }

    function setView(v) {
      var is3d = v !== "aq";
      body.classList.remove("mob-proto", "mob-pac");
      body.classList.toggle("mob-3d", is3d);
      body.classList.toggle("mob-aq", !is3d);
      if (bPos) bPos.classList.toggle("is-active", is3d);
      if (bCmd) bCmd.classList.toggle("is-active", !is3d);
      pokeResize();
    }
    function enable(on) {
      body.classList.toggle("is-mobile", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      sw.hidden = !on;
      if (on) { setView("3d"); }
      else { body.classList.remove("mob-3d", "mob-aq", "mob-proto", "mob-pac"); }
      pokeResize();
    }

    btn.addEventListener("click", function () { enable(!body.classList.contains("is-mobile")); });
    if (bPos) bPos.addEventListener("click", function () { setView("3d"); });
    if (bCmd) bCmd.addEventListener("click", function () { setView("aq"); });
    if (bExit) bExit.addEventListener("click", function () { enable(false); });
  }

  // =================================================================
  // ETAPA A — PAINEL DE COMANDOS MÓVEL + ESCALÁVEL (só tela Sala do celular)
  // Arrastar pela alça, redimensionar pelo canto (escala 0.75×–1.5×).
  // Posição/escala persistidas em localStorage. Escreve apenas CSS vars no
  // painel, consumidas só pela regra mobile — no desktop ficam inertes.
  // Não altera cena, física, laser, poses nem IDs existentes.
  // =================================================================
  function initMobilePanel() {
    var panel = document.getElementById("sala-panel");
    var grip = document.getElementById("sala-panel-grip");
    var resize = document.getElementById("sala-panel-resize");
    if (!panel || !grip || !resize) return;

    var SCALE_MIN = 0.75, SCALE_MAX = 1.5;
    var KEY_POS = "simuladorTC.panelPos";
    var KEY_SCALE = "simuladorTC.panelScale";
    var scale = 1;
    var positioned = false;

    function parentEl() { return panel.offsetParent || panel.parentElement; }

    function applyPos(left, top) {
      panel.style.setProperty("--panel-left", left + "px");
      panel.style.setProperty("--panel-top", top + "px");
      panel.style.setProperty("--panel-right", "auto");
      panel.style.setProperty("--panel-bottom", "auto");
      positioned = true;
    }

    // Converte a âncora padrão (right/bottom) para left/top na 1ª interação.
    function ensurePositioned() {
      if (positioned) return;
      var pr = parentEl().getBoundingClientRect();
      var r = panel.getBoundingClientRect();
      applyPos(r.left - pr.left, r.top - pr.top);
    }

    function clampPos(left, top) {
      var pr = parentEl().getBoundingClientRect();
      var r = panel.getBoundingClientRect();
      var maxL = Math.max(0, pr.width - r.width);
      var maxT = Math.max(0, pr.height - r.height);
      return { left: Math.min(maxL, Math.max(0, left)), top: Math.min(maxT, Math.max(0, top)) };
    }

    function reclampCurrent() {
      var left = parseFloat(panel.style.getPropertyValue("--panel-left")) || 0;
      var top = parseFloat(panel.style.getPropertyValue("--panel-top")) || 0;
      var c = clampPos(left, top);
      panel.style.setProperty("--panel-left", c.left + "px");
      panel.style.setProperty("--panel-top", c.top + "px");
    }

    function persistPos() {
      try {
        var left = parseFloat(panel.style.getPropertyValue("--panel-left"));
        var top = parseFloat(panel.style.getPropertyValue("--panel-top"));
        if (!isNaN(left) && !isNaN(top)) {
          localStorage.setItem(KEY_POS, JSON.stringify({ left: left, top: top }));
        }
      } catch (e) { /* sem persistência */ }
    }
    function persistScale() {
      try { localStorage.setItem(KEY_SCALE, String(scale)); } catch (e) { /* sem persistência */ }
    }

    function loadState() {
      try {
        var s = parseFloat(localStorage.getItem(KEY_SCALE));
        if (!isNaN(s)) {
          scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));
          panel.style.setProperty("--panel-scale", scale);
        }
      } catch (e) { /* sem persistência */ }
      try {
        var p = JSON.parse(localStorage.getItem(KEY_POS) || "null");
        if (p && typeof p.left === "number" && typeof p.top === "number") applyPos(p.left, p.top);
      } catch (e) { /* sem persistência */ }
    }

    // ---- Arraste pela alça ----
    grip.addEventListener("pointerdown", function (e) {
      e.preventDefault(); e.stopPropagation();
      ensurePositioned();
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}
      var pr = parentEl().getBoundingClientRect();
      var r = panel.getBoundingClientRect();
      var offX = e.clientX - r.left;
      var offY = e.clientY - r.top;
      function move(ev) {
        var c = clampPos(ev.clientX - pr.left - offX, ev.clientY - pr.top - offY);
        panel.style.setProperty("--panel-left", c.left + "px");
        panel.style.setProperty("--panel-top", c.top + "px");
      }
      function up() {
        try { grip.releasePointerCapture(e.pointerId); } catch (err) {}
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        persistPos();
      }
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });

    // ---- Escala pelo canto ----
    resize.addEventListener("pointerdown", function (e) {
      e.preventDefault(); e.stopPropagation();
      ensurePositioned();
      try { resize.setPointerCapture(e.pointerId); } catch (err) {}
      var startX = e.clientX, startY = e.clientY, startScale = scale;
      var baseW = panel.getBoundingClientRect().width / startScale || 1;
      function move(ev) {
        var d = ((ev.clientX - startX) + (ev.clientY - startY)) / 2;
        scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, startScale + d / baseW));
        panel.style.setProperty("--panel-scale", scale);
        reclampCurrent();
      }
      function up() {
        try { resize.releasePointerCapture(e.pointerId); } catch (err) {}
        resize.removeEventListener("pointermove", move);
        resize.removeEventListener("pointerup", up);
        resize.removeEventListener("pointercancel", up);
        persistScale(); persistPos();
      }
      resize.addEventListener("pointermove", move);
      resize.addEventListener("pointerup", up);
      resize.addEventListener("pointercancel", up);
    });

    loadState();
  }

  // =================================================================
  // CONSOLE GUIADO (desktop) — fluxo por etapas como nos consoles reais.
  // Uma etapa por vez em tela cheia (1 Sala → 2 Paciente → 3 Protocolo →
  // 4 Exame), banner persistente do paciente e indicadores de pendência.
  // O modo painel (4 quadrantes) permanece disponível pelo botão ⊞.
  // Estado (modo + etapa) persistido em localStorage.
  // =================================================================
  function initConsoleMode() {
    var body = document.body;
    var bar = document.getElementById("console-steps");
    var toggle = document.getElementById("console-toggle");
    var banner = document.getElementById("console-banner");
    if (!bar || !toggle) return;

    var KEY = "simuladorTC.console";
    var STEPS = ["sim", "pac", "proto", "acq"];
    var state = { on: true, step: "sim" }; // console é o padrão no desktop
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved) {
        if (saved.on === false) state.on = false;
        if (STEPS.indexOf(saved.step) >= 0) state.step = saved.step;
      }
    } catch (e) { /* sem persistência */ }
    function persist() {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* sem persistência */ }
    }

    function pokeResize() {
      requestAnimationFrame(function () { window.dispatchEvent(new Event("resize")); });
    }

    // Console guiado é exclusivo de telas largas; em telefones o controle
    // é o seletor fixo inferior do modo celular.
    function isDesktop() {
      return !body.classList.contains("is-mobile") && window.innerWidth >= 901;
    }

    function setDot(step, show) {
      var d = document.getElementById("cdot-" + step);
      if (d) d.hidden = !show;
    }

    // Pendências didáticas + banner persistente (nome · prontuário ·
    // protocolo · posição/status da mesa, espelhados do display).
    function updateInfo() {
      var pac = (examSessionApi && examSessionApi.get) ? examSessionApi.get() : null;
      var prot = examProtocol ? examProtocol.data : null;
      var onTable = tableDriveApi && tableDriveApi.isPatientOnTable && tableDriveApi.isPatientOnTable();
      setDot("pac", !pac);
      setDot("proto", !prot);
      setDot("sim", !!(pac && tableDriveApi && !onTable));
      setDot("acq", !!(pac && prot && (!tableDriveApi || onTable)));
      if (!banner) return;
      var parts = [];
      parts.push(pac ? (pac.nome + " · " + (pac.prontuario || "s/ prontuário")) : "Sem paciente em exame");
      if (prot) parts.push("Prot.: " + prot.nome);
      var dt = document.getElementById("display-table");
      var ds = document.getElementById("display-status");
      if (dt && dt.textContent) parts.push("Mesa " + dt.textContent.trim());
      if (ds && ds.textContent) parts.push(ds.textContent.trim());
      banner.textContent = parts.join("  ·  ");
    }

    // Aplica classes/visibilidade SEM disparar resize (usada também no
    // handler de resize — evita loop com o pokeResize).
    function applyClasses() {
      var active = state.on && isDesktop();
      body.classList.toggle("console-mode", active);
      STEPS.forEach(function (st) {
        body.classList.toggle("cstep-" + st, active && st === state.step);
      });
      bar.hidden = !active;
    }

    function apply() {
      applyClasses();
      toggle.setAttribute("aria-pressed", String(state.on));
      var btns = bar.querySelectorAll(".cstep");
      Array.prototype.forEach.call(btns, function (b) {
        b.classList.toggle("is-active", b.getAttribute("data-step") === state.step);
      });
      updateInfo();
      pokeResize();
    }

    bar.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".cstep") : null;
      if (!b) return;
      state.step = b.getAttribute("data-step");
      persist();
      apply();
    });
    toggle.addEventListener("click", function () {
      state.on = !state.on;
      persist();
      apply();
      showMessage(state.on
        ? "Console guiado: uma etapa por vez (1 Sala → 2 Paciente → 3 Protocolo → 4 Exame)."
        : "Modo painel: 4 quadrantes simultâneos com divisórias ajustáveis.", "info");
    });

    // Entrar/sair do modo celular ou cruzar o breakpoint de 900px
    // liga/desliga o console (sem loop: applyClasses não dispara resize).
    window.addEventListener("resize", applyClasses);

    setInterval(function () { if (!bar.hidden) updateInfo(); }, 1200);

    consoleUiApi = {
      isConsole: function () { return state.on && isDesktop(); },
      getStep: function () { return state.step; },
      setStep: function (st) {
        if (STEPS.indexOf(st) < 0) return;
        state.step = st; persist(); apply();
      }
    };

    apply();
  }

  // =================================================================
  // PIP DA SALA 3D — no modo console, durante topograma/posicionamento/
  // volume, o .viewport REAL é reparentado para uma janela flutuante
  // sobre o viewer de aquisição (o aluno vê a mesa se movendo enquanto a
  // imagem cresce). Ao terminar, o viewport volta ao quadrante da Sala.
  // O ResizeObserver do renderer reajusta o canvas automaticamente.
  // =================================================================
  function initAcqPip() {
    var pip = document.getElementById("pip-3d");
    var pipBody = document.getElementById("pip-body");
    var pipBar = document.getElementById("pip-bar");
    var pipHide = document.getElementById("pip-hide");
    var acq3d = document.getElementById("acq3d");
    var acq3dBody = document.getElementById("acq3d-body");
    var viewer = document.getElementById("ws-slice-viewer");
    var vp = document.querySelector("#pane-sim .viewport");
    if (!pip || !pipBody || !viewer || !vp) return;

    var home = vp.parentNode;
    var homeNext = vp.nextSibling;
    var curPhase = "idle";
    var userHidden = false;

    // Devolve o viewport 3D ao quadrante da Sala.
    function toHome() {
      if (vp.parentNode !== home) home.insertBefore(vp, homeNext);
      pip.hidden = true;
      if (acq3d) acq3d.hidden = true;
    }

    function update() {
      var b = document.body;
      var mobile = b.classList.contains("is-mobile");
      var onExamDesktop = !!(consoleUiApi && consoleUiApi.isConsole() && consoleUiApi.getStep() === "acq");
      var onExamMobile = mobile && b.classList.contains("mob-aq");
      // Sala 3D fica SEMPRE visível na etapa Exame (antes, durante e depois
      // da aquisição), para o aluno acompanhar a mesa.
      var want = (onExamDesktop || onExamMobile) && !userHidden;
      if (!want) { toHome(); return; }
      // Destino conforme a plataforma: faixa fixa no topo (celular) ou
      // janela flutuante sobre o viewer (desktop).
      if (mobile && acq3dBody) {
        if (vp.parentNode !== acq3dBody) acq3dBody.appendChild(vp);
        acq3d.hidden = false;
        pip.hidden = true;
      } else {
        if (vp.parentNode !== pipBody) pipBody.appendChild(vp);
        pip.hidden = false;
        if (acq3d) acq3d.hidden = true;
      }
      // O ResizeObserver do renderer reajusta o canvas ao reparentar.
      requestAnimationFrame(function () { window.dispatchEvent(new Event("resize")); });
    }

    document.addEventListener("ct:phase", function (e) {
      var p = e.detail && e.detail.phase;
      if (!p) return;
      // Nova aquisição reexibe o PiP mesmo se o aluno o ocultou antes.
      if ((p === "topoAcq" || p === "volAcq" || p === "moving") && curPhase !== p) userHidden = false;
      curPhase = p;
      update();
    });
    // Troca de aba no modo celular (mob-*) também reavalia o PiP.
    var mo = new MutationObserver(update);
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    // Troca de etapa/modo dispara resize (pokeResize) — reavaliamos aqui.
    window.addEventListener("resize", update);
    if (pipHide) pipHide.addEventListener("click", function () { userHidden = true; update(); });

    // Arrastável pela barra, limitado ao viewer.
    if (pipBar) pipBar.addEventListener("pointerdown", function (e) {
      if (e.target === pipHide) return;
      e.preventDefault();
      try { pipBar.setPointerCapture(e.pointerId); } catch (err) {}
      var vr = viewer.getBoundingClientRect();
      var pr = pip.getBoundingClientRect();
      var offX = e.clientX - pr.left, offY = e.clientY - pr.top;
      function move(ev) {
        var x = Math.min(Math.max(0, ev.clientX - vr.left - offX), Math.max(0, vr.width - pr.width));
        var y = Math.min(Math.max(0, ev.clientY - vr.top - offY), Math.max(0, vr.height - pr.height));
        pip.style.left = x + "px";
        pip.style.top = y + "px";
        pip.style.right = "auto";
      }
      function up() {
        try { pipBar.releasePointerCapture(e.pointerId); } catch (err) {}
        pipBar.removeEventListener("pointermove", move);
        pipBar.removeEventListener("pointerup", up);
        pipBar.removeEventListener("pointercancel", up);
      }
      pipBar.addEventListener("pointermove", move);
      pipBar.addEventListener("pointerup", up);
      pipBar.addEventListener("pointercancel", up);
    });
  }

  // =================================================================
  // INICIALIZAÇÃO
  // =================================================================
  function main() {
    initTheme();
    bootstrap();
    initWorkstationProtocols();
    initWorkstationViewer();
    initPatients();
    initDashboardSplit();
    initMobileMode();
    initMobilePanel();
    initConsoleMode();
    initAcqPip();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
