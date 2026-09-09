/**
 * js/sala-exame.js
 * Simulador Educacional de TC — Sala de Exame (cena 3D + controles fisicos).
 *
 * Responsavel por TUDO que e 3D ou fisico na sala de TC:
 *   • Cena Three.js, camera orbital manual, iluminacao com sombras
 *   • Sala clinica (piso vinilico, paredes, janela de comando, porta, carrinho)
 *   • Gantry realista (ExtrudeGeometry, bore, anel ciano, arco de varredura)
 *   • Mesa de exame (tampo, coluna-pistao, berco, colchao)
 *   • Paciente 3D com poses de decubito (8 combinacoes decubito x entrada)
 *   • Laser de posicionamento (3 longitudinais + 1 transversal, timer 40 s)
 *   • Controles de mesa (subir/descer/entrar/sair/zerar/start/reset/stop)
 *   • Loop de animacao + HUD e display digital
 *   • API tableDriveApi para aquisicao dirigida pela mesa real
 *
 * Preenchida por este modulo: SimTC.tableDriveApi
 *
 * Depende de: js/shared.js (SimTC), three.min.js (THREE), js/phantoms.js
 * Script classico — sem ES modules, sem bundler.
 */
(function () {
  "use strict";

  function bootstrap() {
    var canvas = document.getElementById("scene-canvas");
    var container = canvas ? canvas.parentElement : null;
    var loadingOverlay = document.getElementById("viewport-loading");

    if (!canvas || !container || typeof THREE === "undefined") {
      SimTC.showMessage("Erro ao inicializar: elementos da cena ou THREE.js não encontrados.", "error");
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

      /**
       * CURVA DE EXPOSICAO — sem ela a sala estourava.
       *
       * Nao havia tone mapping nenhum: o que o shader calculava ia direto
       * para o framebuffer, e tudo acima de 1,0 virava 255 chapado. As luzes
       * desta sala somam ambiente 0,32 + hemisferica 0,42 + principal 0,78 +
       * preenchimento 0,30. Numa superficie virada PARA CIMA, que pega a
       * hemisferica inteira e quase toda a principal, isso da x1,59 — medido.
       * Ou seja: qualquer material com albedo acima de ~0xa1 saturava.
       *
       * O efeito nao era 'a sala clara demais', era PERDA DE INFORMACAO. O
       * topo do gantry, o tampo da mesa, a lateral da carenagem e o avental
       * da paciente chegavam todos ao mesmo 255,255,255 — nao eram brancos
       * parecidos, eram o MESMO pixel. Por isso o equipamento lia chapado por
       * mais que se ajustasse cor de peca: as pecas ja estavam no teto.
       *
       * ACES filmico comprime o topo em vez de cortar. A curva do r128 e a
       * aproximacao de Narkowicz:
       *
       *     f(x) = x(2,51x + 0,03) / (x(2,43x + 0,59) + 0,14)
       *
       * Ela nunca chega a 1, entao nada satura: f(1,0)=0,80  f(1,6)=0,89
       * f(2,0)=0,92. E levanta um pouco a sombra — f(0,3)=0,44 — que e o que
       * devolve leitura ao lado escuro das pecas.
       *
       * A exposicao 1,4 nao e chute: e a que devolve a face frontal do gantry
       * ao 162 em que ela ja estava. Toda a paleta do gantry e do colchao foi
       * calibrada medindo o pixel DESSA face, entao ancorar a exposicao nela
       * conserta o estouro sem invalidar a calibragem que ja estava certa.
       * Varrida a exposicao de 1,0 a 1,45 sobre a cena inteira, o estouro fica
       * em 0,00% dos pixels em todas — a curva comprime o topo, entao subir a
       * exposicao levanta o meio-tom sem devolver o problema:
       *
       *     exp    face    parede   topo do gantry   tampo    medio da cena
       *     1,0    136     138      209              227      118
       *     1,4    163     167      222              236      143
       *
       * O que NAO foi mexido aqui: `outputEncoding` continua linear. Passar o
       * renderizador para sRGB e a correcao de fundo, e vale fazer um dia —
       * mas reescreve TODA cor da cena de uma vez (piso, paredes, colchao,
       * gantry) e obriga a re-tunar tudo. E outra conversa, nao a do estouro.
       */
      if (THREE.ACESFilmicToneMapping !== undefined) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.6;
      }

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
      function pointerDown(x, y) {
        var alvo = comandoNoPonto(x, y);
        if (alvo) { acionarComando(alvo); return; }   // botao do aparelho: nao gira
        dragging = true; lastX = x; lastY = y;
      }
      function pointerMove(x, y) {
        if (!dragging) return;
        var dx = x - lastX, dy = y - lastY;
        lastX = x; lastY = y;
        azimuth -= dx * 0.006;
        polar = Math.min(MAX_POLAR, Math.max(MIN_POLAR, polar - dy * 0.006));
        updateCamera();
      }
      function pointerUp() { dragging = false; soltarComando(); }

      // -----------------------------------------------------------
      // COMANDO PELO PROPRIO APARELHO
      //
      // Os botoes do gantry eram desenho. Agora o clique na cena e testado
      // contra as duas chapas de comando ANTES de virar giro de camera: se
      // caiu num botao, o comando sai e a camera nao gira; se caiu em
      // qualquer outro lugar, a orbita segue como antes.
      //
      // O teste e feito contra a CENA INTEIRA, e nao so contra as chapas, de
      // proposito: se a mesa ou o paciente estiverem na frente do painel, o
      // primeiro acerto e neles e o botao NAO responde — como no aparelho de
      // verdade, em que a mao nao atravessa o que esta na frente.
      // -----------------------------------------------------------
      var rcCmd = new THREE.Raycaster();
      var pontoCmd = new THREE.Vector2();
      var comandoAtivo = null;
      var SEGURA = { up: 1, down: 1, in: 1, out: 1 };   // botoes de manter apertado

      function comandoNoPonto(clientX, clientY) {
        if (!aparelho || !aparelho.facesComando) return null;
        var r = canvas.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        pontoCmd.x = ((clientX - r.left) / r.width) * 2 - 1;
        pontoCmd.y = -((clientY - r.top) / r.height) * 2 + 1;
        rcCmd.setFromCamera(pontoCmd, camera);
        var hits = rcCmd.intersectObjects(scene.children, true);
        for (var i = 0; i < hits.length; i++) {
          var o = hits[i].object;
          // Os lasers sao linhas sem escrita de profundidade: atravessam a
          // cena e nao podem tapar um botao.
          if (!o.visible || o.type === "Line" || o.type === "LineSegments") continue;
          if (aparelho.emergencias.indexOf(o) >= 0) return { acao: "parar", face: null };
          if (aparelho.facesComando.indexOf(o) >= 0) {
            var acao = hits[i].uv ? aparelho.zonaEm(hits[i].uv.x, hits[i].uv.y) : null;
            return acao ? { acao: acao, face: o } : null;
          }
          return null;   // algo mais perto: o painel esta tapado
        }
        return null;
      }

      function repintarComandos(pressionada) {
        if (!aparelho || !aparelho.facesComando) return;
        aparelho.facesComando.forEach(function (f) {
          if (f.userData.repintar) f.userData.repintar(pressionada, { laser: laserOn });
        });
      }

      function acionarComando(alvo) {
        comandoAtivo = alvo;
        var a = alvo.acao;
        if (SEGURA[a]) { FisicaMesa.setCmd(a, true); repintarComandos(a); return; }
        if (a === "laser") { alternarLaser(); repintarComandos("laser"); return; }
        if (a === "zerar") { marcarZero(); repintarComandos("zerar"); return; }
        if (a === "parar") { pararTudo(); return; }
      }

      function soltarComando() {
        if (!comandoAtivo) return;
        if (SEGURA[comandoAtivo.acao]) FisicaMesa.setCmd(comandoAtivo.acao, false);
        comandoAtivo = null;
        repintarComandos(null);
      }

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
      /**
       * MENOS LUZ SEM DIRECAO, MAIS LUZ COM DIRECAO.
       *
       * Ambiente 0,32 + hemisferica 0,42 davam 0,74 de luz CHAPADA — quase
       * metade do total da sala vindo de lugar nenhum. Luz sem direcao nao
       * produz sombra propria, entao as quinas somem e cada peca vira uma
       * silhueta de uma cor so. Era essa a razao de fundo de a sala parecer
       * plana, e ela sobrevivia a qualquer ajuste de cor.
       *
       * Com a curva ACES ligada o defeito ficou pior de ver, nao melhor: a
       * curva LEVANTA a sombra (f(0,3)=0,44), entao um lado escuro que ja era
       * claro demais virou cinza leitoso. Baixar so a exposicao nao servia —
       * escureceria o meio-tom junto, e o meio-tom estava certo.
       *
       * O corte foi na luz chapada (0,74 -> 0,42) e o que saiu voltou na
       * principal, que TEM direcao (0,78 -> 0,98). O topo continua no mesmo
       * lugar; o que muda e o lado escuro das pecas, que desce de ~171 para
       * ~126 e volta a existir como sombra.
       *
       * A cor do chao da hemisferica tambem desceu (0x8f979e -> 0x6b7278):
       * ela representa a luz que o PISO devolve, e o piso virou porcelanato
       * escuro. Um chao escuro que ainda devolvia luz de chao claro era
       * sobra da epoca do vinilico.
       */
      scene.add(new THREE.AmbientLight(0xf0f4f8, 0.14));
      scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7278, 0.28));

      var key = new THREE.DirectionalLight(0xffffff, 0.98);
      key.position.set(2.5, 5.5, 2);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.near = 0.5;
      key.shadow.camera.far = 20;
      key.shadow.camera.left = -6; key.shadow.camera.right = 6;
      key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
      key.shadow.radius = 4; // sombras mais suaves
      scene.add(key);

      var fill = new THREE.DirectionalLight(0xe8f0f8, 0.20);
      fill.position.set(-4, 3.5, -3);
      scene.add(fill);

      // -----------------------------------------------------------
      // Sala clinica — cenografia. Saiu para js/sala/cenario.js na
      // ETAPA 6: 240 linhas que constroem piso, paredes, teto, porta,
      // janela do comando e mobilia, e que nada mais no arquivo consulta.
      // -----------------------------------------------------------
      SimTC.Sala3D.montarSala(scene);

      // -----------------------------------------------------------
      // Gantry — geometria em js/sala/gantry.js desde a ETAPA 6.
      // O que se constroi saiu; o que se comanda ficou: `spinRotTime` e
      // estado da animacao do arco, escrito por setScan() e lido pelo
      // laco de render.
      // -----------------------------------------------------------
      var aparelho = SimTC.Sala3D.montarGantry(scene);
      var gantryGroup = aparelho.gantryGroup;
      var spinArc = aparelho.spinArc;
      var GANTRY_FACE_Z = aparelho.GANTRY_FACE_Z;
      var ISO_Y = aparelho.ISO_Y;
      var BORE_R = aparelho.BORE_R;   // origem dos lasers
      var spinRotTime = 0; // s por volta; 0 = parado/oculto

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
      var FisicaMesa = SimTC.FisicaMesa;
      var GANTRY_Y_MIN = 0.64;
      var GANTRY_Y_MAX = 0.88;
      var TABLE_Z_MAX = 0.90;
      var TABLE_Z_MIN = -1.10;
      var BORE_SAFE_Z = 0.20;
      var SAFE_Y_MIN = GANTRY_Y_MIN, SAFE_Y_MAX = GANTRY_Y_MAX;
      // Meia espessura do corpo, do plano do tampo ao eixo do paciente. E o
      // numero que ensina a "descer a mesa" para centralizar no isocentro, e
      // por isso ele NAO pode ser uma constante quando a figura vem de fora:
      // um modelo importado tem a espessura que tem. Comeca no valor da figura
      // procedural e e reescrito se um modelo entrar no lugar.
      var PATIENT_HALF_THICKNESS = 0.12;

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

      // Colchao em cinza claro. Estava em 0xdfe5e8, a um passo do branco do
      // tampo (0xf2f5f7): as duas pecas se fundiam numa so, e o aluno nao via
      // onde termina a chapa e comeca o acolchoado — que e justamente a
      // superficie onde o paciente deita e onde o laser cai.
      //
      // 0x7b7f82 e MAIS ESCURO do que "cinza claro" parece pedir, e isso e
      // proposital: ESTA CENA ESTOURA. A luz soma ambiente 0,32 + hemisferica
      // 0,42 + principal 0,78 + preenchimento 0,3, sem tone mapping, e a face
      // de cima do colchao — voltada para a luz — sai multiplicada por ~1,6.
      // Medido no enquadramento padrao, amostrando o pixel do colchao:
      //
      //     albedo 0x6b6f72 -> tela 172,180,186
      //     albedo 0x7b7f82 -> tela 197,205,211   <- este
      //     albedo 0x8b8f92 -> tela 222,230,236
      //     albedo 0xa0a0a0 -> tela 253           (no limite)
      //     albedo 0xb0b0b0 -> tela 255           (branco puro)
      //
      // Acima de ~0xa1 tudo satura em branco. A primeira tentativa aqui foi
      // 0xc3c9cd, que E cinza claro no material — e chegava a tela como o
      // mesmo branco 255 do tampo. Escolher a cor pelo numero, sem olhar o
      // pixel, nesta cena nao funciona.
      var cushion = new THREE.Mesh(
        new THREE.BoxGeometry(0.56, 0.025, 1.85),
        new THREE.MeshStandardMaterial({ color: 0x7b7f82, roughness: 0.75 })
      );
      // Assentado sobre o topo do tampo (tampo: centro em 0, espessura
      // 0.04 → topo em +0.02). Colchão de 2.5 cm apoiado nesse topo.
      cushion.position.set(0, 0.02 + 0.0125, 0);
      cushion.castShadow = true;
      cushion.receiveShadow = true;
      tableGroup.add(cushion);

      // A figura do paciente mora em js/sala/paciente.js: e geometria, e
      // saiu daqui na ETAPA 6. O ESTADO de posicionamento fica logo abaixo,
      // porque e estado — e disso a sala nao abre mao.
      var figura = SimTC.Sala3D.montarPaciente(scene, tableGroup);
      var patient = figura.patient;
      var patientPose = figura.patientPose;
      var patientStanding = figura.patientStanding;
      var TORSO_R = figura.TORSO_R;

      // ----- Paciente vindo de fora (assets/paciente/paciente.glb) -----
      //
      // A troca e ASSINCRONA de proposito: a sala termina de montar com a
      // figura procedural e o app fica utilizavel na hora. Se houver um modelo
      // na pasta, ele entra no lugar quando chegar; se nao houver, ou se o
      // arquivo estiver quebrado, a figura procedural fica e o operador e
      // avisado. Em nenhum caso a mesa fica vazia.
      if (SimTC.Sala3D.tentarImportarPaciente) {
        SimTC.Sala3D.tentarImportarPaciente(patient).then(function (r) {
          if (!r.trocou) {
            // Pasta vazia e o caso normal, e nao merece mensagem nenhuma.
            if (r.motivo && r.motivo.indexOf("sem modelo") !== 0) {
              SimTC.showMessage("O modelo de paciente em " + SimTC.Sala3D.PASTA_PACIENTE +
                " nao pode ser lido (" + r.motivo + "). A figura padrao continua na mesa.", "warning");
            }
            return;
          }
          PATIENT_HALF_THICKNESS = r.medidas.meiaEspessuraM;
          applyPatientPose();
          updateReadouts(0);
          var partes = ["Paciente 3D importado: " +
            SimTC.fmt.cm(r.medidas.comprimentoM * 100) + " de comprimento, " +
            SimTC.fmt.cm(r.medidas.larguraM * 100) + " de largura, " +
            SimTC.fmt.cm(r.medidas.meiaEspessuraM * 200) + " de espessura."];
          if (r.credito) partes.push(r.credito);
          if (r.avisos.length) partes.push(r.avisos.join(" "));
          SimTC.showMessage(partes.join(" "), r.avisos.length ? "warning" : "success");
        });
      }

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
        avisarNucleoDaMesa(true);
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

        // ENTRADA = qual extremidade entra PRIMEIRO no gantry.
        //
        // O corpo é modelado com a cabeça em z local +0,76 e os pés em ~−0,98.
        // O gantry está em z = −0,6 e a mesa entra andando para −Z, ou seja,
        // quem entra primeiro é a extremidade de MENOR z. Logo, "cabeça
        // primeiro" exige girar 180° para levar a cabeça ao lado negativo.
        //
        // O mapeamento estava invertido: com "cabeça primeiro" a cabeça
        // apontava para +1,66 — para FORA do gantry — e os pés é que entravam.
        // Pior: com 2,0 m de curso a cabeça só alcançava z = −0,34, parando
        // 26 cm antes do isocentro. A anatomia de interesse NUNCA chegava ao
        // plano de corte, e o que era varrido num "exame de crânio" era o
        // tórax superior.
        var yaw = (currentEntrada === "cabeca") ? Math.PI : 0;

        // O giro de 180° em Y espelha o eixo lateral: sem compensar, "decúbito
        // lateral direito" passaria a deitar o paciente sobre o lado esquerdo
        // quando a entrada fosse cabeça primeiro. O decúbito é uma propriedade
        // do paciente, não da direção de entrada.
        var roll = (DECUBITO_ROLL[currentDecubito] || 0) * (yaw ? -1 : 1);

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
        avisarNucleoDaMesa(true);
      }

      /**
       * Informa o núcleo do estado da mesa: posição, altura, paciente e
       * desvio do isocentro.
       *
       * A sala mantinha isso só em closure, e o núcleo — que tem o estado de
       * sessão e a lista de pré-requisitos para irradiar — seguia achando que
       * o paciente não estava na mesa. Medido: a interface dizia `true` e
       * Core.sessao.mesa.pacienteNaMesa dizia `false` no mesmo instante.
       * Duas verdades sobre o mesmo exame.
       *
       * É chamada do passo de física, que roda dezenas de vezes por segundo
       * durante um movimento — daí a limitação de taxa. Um movimento que
       * termina sempre gera o último aviso, porque o passo seguinte já não
       * tem `moved` e o intervalo terá passado.
       */
      var ultimoAvisoMesa = 0;
      function avisarNucleoDaMesa(forcar) {
        var C = window.SimTCCore;
        if (!C || !C.sessao) return;
        var agora = (typeof performance !== "undefined" ? performance.now() : Date.now());
        if (!forcar && agora - ultimoAvisoMesa < 200) return;
        ultimoAvisoMesa = agora;
        var iso = null;
        try {
          if (patientPlaced && patientPose) {
            var v = new THREE.Vector3();
            patientPose.getWorldPosition(v);
            iso = (v.y - ISO_Y) * 100;
          }
        } catch (e) { iso = null; }
        try {
          C.sessao.atualizarMesa({
            posM: FisicaMesa.getZ(), alturaM: FisicaMesa.getY(),
            pacienteNaMesa: patientPlaced, isoOffsetCm: iso
          });
        } catch (e) { /* núcleo ausente: a sala segue sozinha */ }
      }

      // Estado inicial: paciente em pé ao lado do aparelho.
      standPatient();

      function applyTablePose() {
        tableGroup.position.set(0, FisicaMesa.getY(), FisicaMesa.getZ());

        // Coluna-pistão: liga o topo da base fixa (BASE_FIXED_TOP, em
        // coordenadas do baseGroup, cuja origem está no piso) ao nível do
        // tampo (tableY, em coordenadas do mundo). Como o baseGroup está
        // no piso (y=0), a altura do topo da coluna deve ser tableY.
        // A coluna vai de BASE_FIXED_TOP até tableY; seu comprimento e
        // centro são recalculados a cada movimento (efeito pistão).
        var columnBottom = BASE_FIXED_TOP;
        var columnTop = FisicaMesa.getY() - 0.02; // encosta logo abaixo do tampo
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
        carriage.position.set(0, FisicaMesa.getY() - 0.10, carriageBackZ - carriageLen / 2);
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
        var yFallback = FisicaMesa.getY() + 0.02; // topo do tampo como piso do laser
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
      // As velocidades e as quatro travas de movimento moram em
      // js/fisica-mesa.js; aqui so se COMANDA, por FisicaMesa.setCmd().
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
          // Durante a aquisição os comandos manuais de mesa ficam INERTES.
          // Sem esta guarda o clique era apenas "suspenso": a flag ficava
          // ligada e, no instante em que o scan terminava, a mesa arrancava
          // sozinha (medido: 451 mm sem ação do operador). Como no
          // equipamento real, é preciso soltar e pressionar de novo.
          if (FisicaMesa.ocupada()) {
            SimTC.showMessage("Comandos de mesa bloqueados durante a aquisição. Use Stop para abortar.", "warning");
            return;
          }
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

        // TECLADO. Estes são <button> de verdade — focáveis pelo Tab e
        // anunciados como botões pelo leitor de tela —, mas só respondiam a
        // eventos de ponteiro. Quem navega por teclado ouvia "botão subir
        // mesa", pressionava Enter e nada acontecia: o comando central do
        // simulador era inoperável. (WCAG 2.1.1)
        //
        // O gesto é "manter pressionado", então o par natural é keydown/keyup
        // — e não `click`, que só chega quando a tecla já foi solta e moveria
        // a mesa por um instante imperceptível.
        function ehAcionamento(e) { return e.key === "Enter" || e.key === " " || e.key === "Spacebar"; }
        el.addEventListener("keydown", function (e) {
          if (!ehAcionamento(e)) return;
          // A repetição automática do teclado dispararia `on` dezenas de vezes
          // por segundo; o movimento já é contínuo enquanto a tecla estiver
          // pressionada.
          if (e.repeat) { e.preventDefault(); return; }
          on(e);   // `on` já chama preventDefault (evita a rolagem no Espaço)
        });
        el.addEventListener("keyup", function (e) { if (ehAcionamento(e)) off(); });
        // Perder o foco com a tecla pressionada não pode deixar a mesa andando.
        el.addEventListener("blur", off);
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

      // ----- Mostrar / ocultar a FIGURA do paciente -----
      //
      // E visual, e so. Quem esta na mesa continua na mesa: `patientPlaced`
      // nao muda, o exame nao muda, o calculo do isocentro nao muda. Serve
      // para o aluno ver a mesa, os lasers e o plano do isocentro sem o corpo
      // na frente — e para quem trouxe um modelo pesado poder tira-lo da cena
      // enquanto posiciona.
      var btnPaciente = document.getElementById("btn-paciente");
      var CHAVE_PACIENTE_VISIVEL = "simuladorTC.pacienteVisivel";
      var pacienteVisivel = true;
      try {
        if (localStorage.getItem(CHAVE_PACIENTE_VISIVEL) === "0") pacienteVisivel = false;
      } catch (e) { /* sem persistência: vale só para esta janela */ }

      function mostrarPaciente(sim) {
        pacienteVisivel = !!sim;
        patient.visible = pacienteVisivel;
        if (btnPaciente) {
          btnPaciente.setAttribute("aria-pressed", pacienteVisivel ? "true" : "false");
          btnPaciente.setAttribute("title", pacienteVisivel
            ? "Ocultar a figura do paciente (não altera o exame)"
            : "Mostrar a figura do paciente");
        }
        try { localStorage.setItem(CHAVE_PACIENTE_VISIVEL, pacienteVisivel ? "1" : "0"); }
        catch (e) { /* sem persistência */ }
      }
      if (btnPaciente) {
        btnPaciente.addEventListener("click", function () {
          mostrarPaciente(!pacienteVisivel);
          SimTC.showMessage(pacienteVisivel
            ? "Figura do paciente visível."
            : "Figura do paciente oculta — é só a imagem: o posicionamento e o exame seguem valendo.",
            "info");
        });
      }
      mostrarPaciente(pacienteVisivel);

      setHeld(btnUp, function (v) { FisicaMesa.setCmd("up", v); });
      setHeld(btnDown, function (v) { FisicaMesa.setCmd("down", v); });
      setHeld(btnIn, function (v) { FisicaMesa.setCmd("in", v); });
      setHeld(btnOut, function (v) { FisicaMesa.setCmd("out", v); });

      // Temporizador de segurança do laser: desliga sozinho após 40 s
      // (como no equipamento real, para evitar exposição desnecessária
      // dos olhos ao feixe).
      var LASER_TIMEOUT_MS = 40000;
      var laserTimer = null;

      function setLaser(on) {
        laserOn = on;
        laserGroup.visible = on;
        if (btnLaser) btnLaser.setAttribute("aria-pressed", String(on));
        SimTC.setIndicator("laser", on);
        if (laserTimer) { clearTimeout(laserTimer); laserTimer = null; }
        if (on) {
          updateLasers();
          laserTimer = setTimeout(function () {
            setLaser(false);
            SimTC.showMessage("Laser desligado automaticamente após 40 segundos (desligamento de segurança).", "info");
          }, LASER_TIMEOUT_MS);
        }
      }

      // As TRES acoes abaixo sao declaradas com nome porque agora tem DOIS
      // acionadores cada uma: o botao em HTML e o botao pintado no gantry,
      // que o raycast aciona. Uma acao, dois caminhos ate ela — e nao duas
      // copias da mesma logica, que e como as duas divergem com o tempo.
      function alternarLaser() {
        setLaser(!laserOn);
        SimTC.showMessage(laserOn ? "Laser de posicionamento ligado (desliga sozinho em 40 s)." : "Laser de posicionamento desligado.", "info");
      }
      if (btnLaser) btnLaser.addEventListener("click", alternarLaser);

      // Define a posição atual da mesa como o ponto zero de referência
      // para a aquisição. O laser transversal marca esse plano.
      function marcarZero() {
        tableZeroRef = FisicaMesa.getZ();
        updateReadouts(0);
        SimTC.showMessage("Posição da mesa zerada neste ponto (marco zero para a aquisição). Este é um ponto de controle — não é obrigatório para adquirir o exame.", "success");
      }
      if (btnZero) btnZero.addEventListener("click", marcarZero);

      if (btnStart) {
        btnStart.addEventListener("click", function () {
          simulationRunning = true;
          SimTC.showMessage("Simulação iniciada. Ajuste a altura da mesa para alinhar o centro do paciente ao isocentro (o status indica: DESCER / SUBIR MESA / ISOCENTRO OK).", "success");
        });
      }

      if (btnReset) {
        btnReset.addEventListener("click", function () {
          FisicaMesa.reiniciarMesa();
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
          SimTC.showMessage("Simulador reiniciado. Paciente aguardando ao lado do equipamento.", "info");
        });
      }

      // O cogumelo vermelho do gantry chama esta mesma funcao — e o unico
      // controle que o aluno tem de saber achar sem procurar.
      function pararTudo() {
        FisicaMesa.setCmd("up", false);
        FisicaMesa.setCmd("down", false);
        FisicaMesa.setCmd("in", false);
        FisicaMesa.setCmd("out", false);
        FisicaMesa.abortAutoDrive("PARADA DE EMERGÊNCIA — aquisição abortada.");
        estadoMostrador = "PARADO";
        var statusEl = document.getElementById("display-status");
        if (statusEl) statusEl.textContent = "PARADO";
        SimTC.showMessage("PARADA DE EMERGÊNCIA acionada. Todos os movimentos foram interrompidos.", "warning");
      }
      if (btnStop) btnStop.addEventListener("click", pararTudo);

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
                SimTC.showMessage("Decúbito: " + DECUBITO_FULL[d] + ".", "info");
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
                SimTC.showMessage("Entrada no gantry: " + ENTRADA_FULL[e] + ".", "info");
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
      var SETA_PARA_COMANDO = {
        ArrowUp: "up", ArrowDown: "down", ArrowRight: "in", ArrowLeft: "out"
      };
      window.addEventListener("keydown", function (e) {
        var cmd = SETA_PARA_COMANDO[e.key];
        if (cmd) FisicaMesa.setCmd(cmd, true);
      });
      window.addEventListener("keyup", function (e) {
        var cmd = SETA_PARA_COMANDO[e.key];
        if (cmd) FisicaMesa.setCmd(cmd, false);
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

      // Escreve no DOM so quando o texto MUDA. Como updateReadouts passou a
      // rodar no passo da fisica (e nao mais no desenho), ela e chamada mesmo
      // com a pagina oculta; sem esta guarda seriam seis escritas por passo
      // com a mesa parada, que e o estado normal.
      var ultimoEscrito = {};
      var estadoMostrador = "AGUARDANDO";
      function escrever(el, chave, texto, comHtml) {
        if (!el || ultimoEscrito[chave] === texto) return;
        ultimoEscrito[chave] = texto;
        if (comHtml) el.innerHTML = texto; else el.textContent = texto;
      }

      /**
       * Os mostradores MORAVAM no requestAnimationFrame, e a fisica nao.
       *
       * O relogio do nucleo tem uma fonte por Worker justamente para nao parar
       * quando ninguem esta pintando — de modo que, com o documento oculto, a
       * mesa andava e os mostradores congelavam no ultimo valor desenhado.
       * Medido durante a auditoria: `tableGroup.position.y = 0,88 m` com o HUD
       * exibindo "80,0 cm". Para o operador humano o efeito e pequeno (o valor
       * ressincroniza no primeiro repaint), mas o DOM deixava de dizer a
       * verdade sobre a maquina — e um teste que o lesse acusava defeito onde
       * nao havia.
       *
       * Agora ela e chamada pelo passo da fisica. O desenho ficou so com o
       * desenho.
       */
      function updateReadouts(currentSpeedMmS) {
        // Posição longitudinal em mm. Se o operador zerou a mesa (botão
        // Zerar), a leitura é relativa a esse ponto (pode ser negativa);
        // caso contrário, 0 mm = totalmente retraída.
        var refZ = (tableZeroRef !== null) ? tableZeroRef : TABLE_Z_MAX;
        var posMm = (refZ - FisicaMesa.getZ()) * 1000;
        var posText = (posMm >= 0 ? "" : "-") + SimTC.fmt.n(Math.abs(posMm), 1).padStart(5, "0");
        escrever(hudPositionEl, "hudPos", posText + " <small>mm</small>", true);
        escrever(displayTableEl, "dispTable", posText + " mm", false);
        escrever(hudSpeedEl, "hudSpeed", SimTC.fmt.n(currentSpeedMmS, 1) + " <small>mm/s</small>", true);

        // Altura da mesa em cm (útil para calibrar/verificar os limites).
        var heightCm = FisicaMesa.getY() * 100;
        var heightText = SimTC.fmt.n(heightCm, 1);
        escrever(hudHeightEl, "hudHeight", heightText + " <small>cm</small>", true);
        escrever(displayHeightEl, "dispHeight", heightText + " cm", false);

        // Alinhamento no isocentro: o centro do corpo do paciente fica
        // ~12 cm (metade da espessura) acima do topo do tampo. O tampo
        // (tableY) precisa estar ~14 cm abaixo do isocentro para que o
        // centro do paciente coincida com os 80 cm. Isso ensina o aluno
        // a "descer a mesa" para centralizar o paciente.
        var patientCenterY = FisicaMesa.getY() + 0.02 + PATIENT_HALF_THICKNESS;
        var isoDelta = Math.abs(patientCenterY - ISO_Y);
        if (simulationRunning) {
          estadoMostrador = (isoDelta <= 0.01) ? "ISOCENTRO OK"
                          : (patientCenterY > ISO_Y) ? "DESCER MESA" : "SUBIR MESA";
          escrever(displayStatusEl, "dispStatus", estadoMostrador, false);
        }

        // As MESMAS grandezas, no mostrador do aparelho.
        atualizarMostrador(posText, SimTC.fmt.n(currentSpeedMmS, 1), heightText);
      }

      /**
       * Espelha o HUD no mostrador do gantry.
       *
       * Redesenhar um canvas de 768x320 custa; `updateReadouts` roda no passo
       * da fisica, dezenas de vezes por segundo, e com a mesa parada os
       * valores nao mudam. Por isso a chave: so repinta quando algo que
       * APARECE no mostrador mudou de verdade — as tres grandezas, o estado
       * ou uma das quatro luzes.
       */
      var ultimoMostrador = "";
      function atualizarMostrador(mesa, veloc, altura) {
        if (!aparelho || !aparelho.atualizarDisplay) return;
        var luz = SimTC.indicadores || {};
        var chave = [mesa, veloc, altura, estadoMostrador,
                     luz.power, luz.ready, luz.laser, luz.motion].join("|");
        if (chave === ultimoMostrador) return;
        ultimoMostrador = chave;
        aparelho.atualizarDisplay({
          mesa: mesa, veloc: veloc, altura: altura,
          estado: estadoMostrador, luzes: luz
        });
      }

      // -----------------------------------------------------------
      // AQUISIÇÃO DIRIGIDA PELA MESA (ponte com a workstation)
      // Física real: no topograma o tubo fica parado e a MESA translada o
      // paciente pelo gantry (imagem linha a linha); no helicoidal a mesa
      // avança continuamente enquanto o gantry gira (v = pitch × colimação
      // ÷ tempo de rotação). Aqui a workstation comanda a mesa e recebe o
      // progresso REAL para revelar a imagem em sincronia.
      // -----------------------------------------------------------
      // A varredura guiada (`autoDrive`) mora em js/fisica-mesa.js. Aqui ficou
      // uma copia que ninguem mais atribuia — e a guarda acima, que bloqueia os
      // comandos manuais durante a aquisicao, lia essa copia: era sempre null,
      // logo a guarda nunca fechava.
      var hintTimer = null; // realce temporário do comando de recuperação

      function setSpin(rotTimeS) {
        spinRotTime = rotTimeS > 0 ? rotTimeS : 0;
        spinArc.visible = spinRotTime > 0;
      }

      // Angulação do gantry (tilt), como no crânio real. O gantryGroup tem
      // filhos em coordenadas absolutas (isocentro em y=ISO_Y, z=-0.6);
      // rotacionar direto giraria em torno da origem do mundo. Para manter o
      // isocentro fixo, rotaciona em X e compensa a posição (T = P - R·P).
      // Só o visual do gantry inclina — lasers, mesa, paciente e os
      // intertravamentos (baseados em z do mundo) permanecem intactos.
      var GANTRY_TILT_PIVOT = new THREE.Vector3(0, ISO_Y, -0.6);
      function setGantryTilt(deg) {
        var th = (deg || 0) * Math.PI / 180;
        var P = GANTRY_TILT_PIVOT;
        var cos = Math.cos(th), sin = Math.sin(th);
        var ry = P.y * cos - P.z * sin;
        var rz = P.y * sin + P.z * cos;
        gantryGroup.rotation.x = th;
        gantryGroup.position.set(0, P.y - ry, P.z - rz);
      }

      SimTC.contratos.declarar("tableDriveApi", {
        isPatientOnTable: function () { return !!patientPlaced; },
        isBusy: function () { return FisicaMesa.ocupada(); },
        in: function () { FisicaMesa.setCmd("in", true); },
        out: function () { FisicaMesa.setCmd("out", true); },
        up: function () { FisicaMesa.setCmd("up", true); },
        down: function () { FisicaMesa.setCmd("down", true); },
        stopIn: function () { FisicaMesa.setCmd("in", false); },
        stopOut: function () { FisicaMesa.setCmd("out", false); },
        stopUp: function () { FisicaMesa.setCmd("up", false); },
        stopDown: function () { FisicaMesa.setCmd("down", false); },
        zerarMesa: function () { FisicaMesa.zerarMesa(); applyTablePose(); },
        start: function (opts) { return FisicaMesa.iniciarVarredura(opts); },
        getPos: function () { return FisicaMesa.getZ(); },
        getIsoOffsetCm: function () {
          if (!patientPlaced) return null;
          var v = new THREE.Vector3();
          patientPose.getWorldPosition(v);
          return (v.y - ISO_Y) * 100;
        },
        stop: function () { FisicaMesa.abortAutoDrive("Aquisição interrompida pela workstation."); },
        /**
         * Acende o botao que a workstation quer que o operador aperte.
         *
         * Isto estava MORTO havia tempo: procurava `btn-in` e `btn-out`, ids
         * que nunca existiram — os botoes chamavam-se `btn-table-in` e
         * `btn-table-out`. A guarda `if (!alvo) return;` engolia o engano em
         * silencio, entao a workstation pedia "aperte ENTRA" e nada acendia.
         *
         * Agora aponta para o botao que existe de verdade: o do gantry.
         */
        hintControl: function (acao) {
          if (acao !== "in" && acao !== "out") return;
          if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
          repintarComandos(acao);
          hintTimer = setTimeout(function () {
            repintarComandos(comandoAtivo ? comandoAtivo.acao : null);
            hintTimer = null;
          }, 6000);
        },
        setGantryTilt: function (deg) { setGantryTilt(deg); },
        setScan: function (rotTimeS) { setSpin(rotTimeS || 0); }
      });

      FisicaMesa.setViewCallbacks({
        onMove: function (y, z) {
          applyTablePose();
          avisarNucleoDaMesa();
        },
        onAlert: function (msg) {
          SimTC.showMessage(msg, "warning");
        },
        onSpinSet: function (rotTimeS) {
          setSpin(rotTimeS || 0);
        },
        onUpdateReadout: function (speedMmS) {
          updateReadouts(speedMmS);
        },
        onLabel: function (texto) {
          var el = document.getElementById("display-status");
          if (el) el.textContent = texto;
        }
      });

      // -----------------------------------------------------------
      // Loop de animação, física e intertravamento de segurança
      // -----------------------------------------------------------
      // -----------------------------------------------------------
      // FISICA (passo fixo) x DESENHO (taxa de pintura)
      //
      // Antes, tudo isto rodava dentro de requestAnimationFrame: quando o
      // navegador parava de pintar (aba oculta, janela minimizada, canvas fora
      // da tela), a AQUISICAO CONGELAVA no meio. Num equipamento real a mesa
      // nao para porque ninguem esta olhando.
      //
      // Agora a fisica e assinante do relogio de passo fixo do nucleo
      // (core/clock.js), alimentado por rAF quando a pagina pinta e por um
      // Worker quando nao pinta. O rAF cuida apenas do desenho.
      // -----------------------------------------------------------
      var ultimaVelocidadeMmS = 0;
      var ultimoAlerta = "";

      function passoFisica(dt) {
        FisicaMesa.passoFisica(dt);
        if (spinRotTime > 0) {
          spinArc.rotation.z -= (Math.PI * 2 / spinRotTime) * dt;
        }
        var speedMmS = FisicaMesa.velocidadeMmS();
        ultimaVelocidadeMmS = speedMmS;
        updateReadouts(speedMmS);
      }

      function desenhar(now) {

        if (laserOn) {
          var pulse = 0.8 + Math.sin(now * 0.006) * 0.2;
          laserLineMat.opacity = pulse;
          updateLasers();
        }

        renderer.render(scene, camera);
        requestAnimationFrame(desenhar);
      }

      // Liga a fisica ao relogio do nucleo. Sem o nucleo carregado (ex.: uma
      // pagina que so inclua sala-exame.js), cai para o comportamento antigo
      // de passo variavel preso ao rAF, para nao quebrar.
      var Core = window.SimTCCore;
      if (Core && Core.relogio) {
        Core.relogio.aoPasso(passoFisica);
        Core.relogio.iniciar();
        SimTC.relogio = Core.relogio;
      } else {
        var ultimoMs = performance.now();
        var passoAntigo = function (now) {
          var dt = Math.min(0.05, (now - ultimoMs) / 1000);
          ultimoMs = now;
          passoFisica(dt);
          requestAnimationFrame(passoAntigo);
        };
        requestAnimationFrame(passoAntigo);
      }

      updateReadouts(0);
      window.__ctSimulator = {
        scene: scene, camera: camera, renderer: renderer,
        gantryGroup: gantryGroup, tableGroup: tableGroup,
      };

      requestAnimationFrame(function () {
        if (!loadingOverlay) return;
        loadingOverlay.setAttribute("data-hidden", "true");
        // O aviso some por `opacity: 0`, e um elemento transparente continua na
        // arvore de acessibilidade: o leitor de tela seguia anunciando
        // "Inicializando cena 3D..." depois de a cena ja estar na tela. Some de
        // verdade quando a transicao termina — antes disso ele ainda esta sendo
        // visto, e retira-lo na hora cortaria o fade.
        window.setTimeout(function () {
          loadingOverlay.hidden = true;
          loadingOverlay.removeAttribute("role");
        }, 400);
      });
      requestAnimationFrame(desenhar);

      // A largura da janela em pixels vinha escrita AQUI, na primeira mensagem
      // que o aluno le. Era sonda de depuracao virada para o usuario.
      SimTC.showMessage(
        "Simulador carregado. Este ambiente é exclusivamente educacional e não deve ser utilizado para qualquer finalidade clínica ou diagnóstica.",
        "info"
      );
    } catch (error) {
      console.error("Falha ao inicializar a cena 3D:", error);
      window.__ctSimulatorErrorReported = true;
      SimTC.showMessage(
        "Não foi possível inicializar a visualização 3D: " + (error && error.message ? error.message : String(error)),
        "error"
      );
    }
  }

  window.SimTC = window.SimTC || {};
  SimTC.Sala = { init: bootstrap };

})();