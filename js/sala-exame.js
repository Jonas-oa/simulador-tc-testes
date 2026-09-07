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

      // A figura do paciente mora em js/sala/paciente.js: e geometria, e
      // saiu daqui na ETAPA 6. O ESTADO de posicionamento fica logo abaixo,
      // porque e estado — e disso a sala nao abre mao.
      var figura = SimTC.Sala3D.montarPaciente(scene, tableGroup);
      var patient = figura.patient;
      var patientPose = figura.patientPose;
      var patientStanding = figura.patientStanding;
      var TORSO_R = figura.TORSO_R;

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
            posM: tableZ, alturaM: tableY,
            pacienteNaMesa: patientPlaced, isoOffsetCm: iso
          });
        } catch (e) { /* núcleo ausente: a sala segue sozinha */ }
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
          // Durante a aquisição os comandos manuais de mesa ficam INERTES.
          // Sem esta guarda o clique era apenas "suspenso": a flag ficava
          // ligada e, no instante em que o scan terminava, a mesa arrancava
          // sozinha (medido: 451 mm sem ação do operador). Como no
          // equipamento real, é preciso soltar e pressionar de novo.
          if (autoDrive) {
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

      if (btnLaser) {
        btnLaser.addEventListener("click", function () {
          setLaser(!laserOn);
          SimTC.showMessage(laserOn ? "Laser de posicionamento ligado (desliga sozinho em 40 s)." : "Laser de posicionamento desligado.", "info");
        });
      }

      if (btnZero) {
        btnZero.addEventListener("click", function () {
          // Define a posição atual da mesa como o ponto zero de referência
          // para a aquisição. O laser transversal marca esse plano.
          tableZeroRef = tableZ;
          updateReadouts(0);
          SimTC.showMessage("Posição da mesa zerada neste ponto (marco zero para a aquisição). Este é um ponto de controle — não é obrigatório para adquirir o exame.", "success");
        });
      }

      if (btnStart) {
        btnStart.addEventListener("click", function () {
          simulationRunning = true;
          SimTC.showMessage("Simulação iniciada. Ajuste a altura da mesa para alinhar o centro do paciente ao isocentro (o status indica: DESCER / SUBIR MESA / ISOCENTRO OK).", "success");
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
          SimTC.showMessage("Simulador reiniciado. Paciente aguardando ao lado do equipamento.", "info");
        });
      }

      if (btnStop) {
        btnStop.addEventListener("click", function () {
          moveUp = moveDown = moveIn = moveOut = false;
          abortAutoDrive("PARADA DE EMERGÊNCIA — aquisição abortada.");
          var statusEl = document.getElementById("display-status");
          if (statusEl) statusEl.textContent = "PARADO";
          SimTC.showMessage("PARADA DE EMERGÊNCIA acionada. Todos os movimentos foram interrompidos.", "warning");
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

      // Escreve no DOM so quando o texto MUDA. Como updateReadouts passou a
      // rodar no passo da fisica (e nao mais no desenho), ela e chamada mesmo
      // com a pagina oculta; sem esta guarda seriam seis escritas por passo
      // com a mesa parada, que e o estado normal.
      var ultimoEscrito = {};
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
        var posMm = (refZ - tableZ) * 1000;
        var posText = (posMm >= 0 ? "" : "-") + SimTC.fmt.n(Math.abs(posMm), 1).padStart(5, "0");
        escrever(hudPositionEl, "hudPos", posText + " <small>mm</small>", true);
        escrever(displayTableEl, "dispTable", posText + " mm", false);
        escrever(hudSpeedEl, "hudSpeed", SimTC.fmt.n(currentSpeedMmS, 1) + " <small>mm/s</small>", true);

        // Altura da mesa em cm (útil para calibrar/verificar os limites).
        var heightCm = tableY * 100;
        var heightText = SimTC.fmt.n(heightCm, 1);
        escrever(hudHeightEl, "hudHeight", heightText + " <small>cm</small>", true);
        escrever(displayHeightEl, "dispHeight", heightText + " cm", false);

        // Alinhamento no isocentro: o centro do corpo do paciente fica
        // ~12 cm (metade da espessura) acima do topo do tampo. O tampo
        // (tableY) precisa estar ~14 cm abaixo do isocentro para que o
        // centro do paciente coincida com os 80 cm. Isso ensina o aluno
        // a "descer a mesa" para centralizar o paciente.
        var patientCenterY = tableY + 0.02 + PATIENT_HALF_THICKNESS;
        var isoDelta = Math.abs(patientCenterY - ISO_Y);
        if (displayStatusEl && simulationRunning) {
          var estado = (isoDelta <= 0.01) ? "ISOCENTRO OK"
                     : (patientCenterY > ISO_Y) ? "DESCER MESA" : "SUBIR MESA";
          escrever(displayStatusEl, "dispStatus", estado, false);
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
      var hintTimer = null, hintEl = null; // realce temporário do comando de recuperação

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

      function abortAutoDrive(motivo) {
        if (!autoDrive) return;
        var ad = autoDrive;
        autoDrive = null;
        setSpin(0);
        if (ad.onAbort) ad.onAbort(motivo || "Aquisição interrompida.");
      }

      SimTC.contratos.declarar("tableDriveApi", {
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
            // Curso insuficiente NA DIREÇÃO programada. Antes isto era só uma
            // recusa, e era um beco sem saída: num protocolo caudocranial a
            // mesa SAI enquanto varre, e a partir do repouso (totalmente
            // recuada) não existe curso nenhum para fora — o exame recusava
            // sempre, e o aluno tinha de adivinhar quantos milímetros avançar
            // antes de tentar de novo.
            //
            // Um tomógrafo real não age assim: posicionar a mesa no início da
            // varredura é parte do início da varredura. Então, quando dá para
            // ganhar o curso movendo no sentido contrário, o console POSICIONA
            // e emenda a aquisição — dizendo o que fez, para que continue
            // sendo uma lição sobre curso de mesa e não uma mágica.
            //
            // Só quem VARRE pede isso (`posicionarAntes: true`). Um comando de
            // posicionamento — o MOVER, o avanço entre cortes do sequencial —
            // já É o posicionamento: pré-posicioná-lo criava um movimento a
            // mais e fazia o guardião da faixa acusar que ela mudou sozinha.
            var faltamMm = Math.round((dist - travel) * 1000);
            var acao = (dir < 0) ? "out" : "in";
            var partida = Math.max(TABLE_Z_MIN, Math.min(TABLE_Z_MAX, target - dir * dist));
            var cursoDaPartida = Math.abs(
              Math.max(TABLE_Z_MIN, Math.min(TABLE_Z_MAX, partida + dir * dist)) - partida);

            if (opts.posicionarAntes === true && cursoDaPartida >= dist * 0.98) {
              var deslocMm = Math.round(Math.abs(partida - tableZ) * 1000);
              SimTC.showMessage(
                "Mesa posicionada " + deslocMm + " mm " +
                (partida < tableZ ? "para dentro" : "para fora") +
                " do gantry para acomodar a varredura de " + Math.round(dist * 1000) +
                " mm. A aquisição começa em seguida.", "info");
              moveUp = moveDown = moveIn = moveOut = false;
              var opcoesDaVarredura = opts;
              autoDrive = {
                targetZ: partida,
                startZ: tableZ,
                speed: Math.max(0.02, SPEED_Z),   // reposicionar é rápido: não é varredura
                onProgress: null,
                onAbort: opts.onAbort || null,
                onDone: function () {
                  // Emenda a varredura de verdade, agora com curso disponível.
                  var seg = {};
                  for (var k in opcoesDaVarredura) {
                    if (Object.prototype.hasOwnProperty.call(opcoesDaVarredura, k)) {
                      seg[k] = opcoesDaVarredura[k];
                    }
                  }
                  seg.posicionarAntes = false;
                  var r2 = SimTC.tableDriveApi.start(seg);
                  // Se ainda assim faltar curso, o operador precisa saber —
                  // silêncio aqui deixaria o exame parado sem explicação.
                  if (!r2 || !r2.ok) {
                    SimTC.showMessage("Não foi possível iniciar após posicionar: " +
                      ((r2 && r2.motivo) || "curso indisponível"), "warning");
                    if (opcoesDaVarredura.onAbort) {
                      opcoesDaVarredura.onAbort((r2 && r2.motivo) || "curso indisponível");
                    }
                  }
                }
              };
              setSpin(0);
              // `startZ` e a posicao onde a VARREDURA comeca — depois do
              // posicionamento, nao antes. Quem chama guarda isso como
              // referencia do topograma; devolver a posicao atual faria o
              // inicio da faixa cair fora do curso da mesa.
              return { ok: true, posicionando: true,
                       deslocamentoMm: deslocMm, startZ: partida };
            }

            return {
              ok: false,
              acao: acao,
              faltamMm: faltamMm,
              motivo: "Curso insuficiente: faltam " + faltamMm + " mm " +
                (dir < 0 ? "para dentro do gantry" : "para fora do gantry") + ". " +
                (acao === "out"
                  ? "Use SAIR para recuar a mesa e ganhar curso antes de iniciar."
                  : "Use ENTRAR para avançar a mesa e ganhar curso antes de iniciar.")
            };
          }
          // Segurança: um comando manual que esteja pressionado no momento em
          // que a aquisição começa fica suspenso durante o autoDrive e, sem
          // isto, VOLTA A VALER assim que o scan termina — a mesa arranca
          // sozinha, sem ação do operador. Zerar aqui obriga uma nova pressão.
          moveUp = moveDown = moveIn = moveOut = false;

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
        stop: function () { abortAutoDrive("Aquisição interrompida pela workstation."); },
        // Realça por alguns segundos o comando de mesa que resolve um impasse
        // ("in" = ENTRAR, "out" = SAIR). Usado quando a aquisição é recusada
        // por falta de curso, para que a orientação textual tenha um alvo.
        hintControl: function (acao) {
          var alvo = (acao === "in") ? btnIn : (acao === "out") ? btnOut : null;
          if (!alvo) return;
          if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
          if (hintEl) hintEl.classList.remove("is-hint");
          hintEl = alvo;
          alvo.classList.add("is-hint");
          hintTimer = setTimeout(function () {
            alvo.classList.remove("is-hint");
            hintTimer = null; hintEl = null;
          }, 6000);
        },
        // Inclina o gantry (graus) — visual do tilt de protocolo.
        setGantryTilt: function (deg) { setGantryTilt(deg); },
        // Liga/desliga o arco de varredura girando SEM mover a mesa (usado no
        // step-and-shoot: aquisição com a mesa parada entre os passos).
        setScan: function (rotTimeS) { setSpin(rotTimeS || 0); }
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
        // dt vem do relógio de passo fixo — não se mede mais o tempo aqui.

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
          avisarNucleoDaMesa();
        }

        var anyMoveFlag = moveUp || moveDown || moveIn || moveOut;
        SimTC.setIndicator("motion", (anyMoveFlag || !!autoDrive) && moved);

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

        if (alertStatus && alertStatus !== ultimoAlerta) {
          SimTC.showMessage(alertStatus, "warning");
        }
        ultimoAlerta = alertStatus;

        var speedMmS = 0;
        if (autoDrive) speedMmS = autoDrive.speed * 1000;
        else if (moveIn || moveOut) speedMmS = SPEED_Z * 1000;
        else if (moveUp || moveDown) speedMmS = SPEED_Y * 1000;
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