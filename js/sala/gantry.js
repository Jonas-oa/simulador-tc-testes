/**
 * js/sala/gantry.js
 * O gantry: carenagem, bore, painel frontal, comandos e o arco que gira.
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
  // Gantry — carenagem branca com painel frontal sobreposto, colar do
  // bore, grelhas de ventilacao, comandos laterais e rodape escuro.
  // Parametros criticos preservados: BORE_R, ISO_Y, GANTRY_FACE_Z e a
  // posicao Z=-0.6 (nada que afete laser, limites ou isocentro muda).
  // -----------------------------------------------------------
  var gantryGroup = new THREE.Group();
  scene.add(gantryGroup);

  var GW = 2.0, GH = 1.9, GDEPTH = 0.85, BORE_R = 0.40; // bore de 80cm de diâmetro
  var ISO_Y = 0.80; // altura do isocentro
  var GANTRY_FACE_Z = -0.6 + GDEPTH / 2 + 0.005; // Z do plano de entrada (face do gantry / lasers)

  var BEVEL_T = 0.03;   // bisel: cresce em Z, nos DOIS extremos
  var BEVEL_S = 0.03;   // bisel: cresce no PLANO do perfil, para FORA

  /**
   * ONDE FICA, DE VERDADE, A FACE DA CARENAGEM.
   *
   * `ExtrudeGeometry` com bisel nao termina na profundidade pedida: ele
   * acrescenta `bevelThickness` NOS DOIS extremos. O corpo pedido com
   * `depth: 0.85` ocupa 0,91 m, e a face frontal cai em z = -0,145 — nao
   * em -0,175, que e o que a conta ingenua (-0,6 + GDEPTH/2) devolve.
   *
   * Toda a decoracao da face estava posicionada por essa conta ingenua,
   * com folgas de 6 a 15 mm. Ou seja: o display azul, os dois painels de
   * botoes, os LEDs de status, os dois aneis da moldura e o anel ciano
   * estavam TODOS 2,2 cm DENTRO da carenagem, invisiveis. O gantry era
   * um bloco branco liso, e o codigo que desenhava os detalhes rodava
   * inteiro a cada carga, sem nunca aparecer na tela.
   *
   * Medido no app antes de mexer: face real do corpo em z = -0,1450;
   * display em z = -0,1670; enterrado 2,20 cm.
   *
   * E o bisel engorda a peca NOS DOIS EIXOS. `bevelSize` empurra o perfil
   * para FORA no meio da extrusao: a lateral da casca de 2,00 m de largura
   * fica em x = +-1,030, nao +-1,000. Medido por raycast na casca ja montada:
   * superficie em 1,0300 tanto a 0,70 m quanto a 1,13 m de altura.
   *
   * Isso derrubou a segunda leva de detalhes: a tampa de servico e o friso de
   * acento das laterais foram colados em x = 1,004..1,016 — dentro da casca
   * outra vez, invisiveis pelo mesmo motivo, so que no outro eixo.
   *
   * Daqui para baixo: o que fica na face parte de FACE_Z; o que fica na
   * lateral parte de LADO_X. Nenhum dos dois e GW/2 nem GDEPTH/2.
   */
  var FACE_Z = -0.6 + GDEPTH / 2 + BEVEL_T;
  var LADO_X = GW / 2 + BEVEL_S;

  // -----------------------------------------------------------
  // PALETA — escolhida medindo o pixel, nao o numero.
  //
  // Esta cena nao tem tone mapping. Numa superficie vertical virada para
  // a camera, o que sai na tela e ~0,80 x o albedo; numa face horizontal
  // virada para cima, ~1,6 x (e satura acima de 0xa1). Por isso os cinzas
  // aqui sao mais escuros do que parecem: sao o albedo que CHEGA no tom
  // pretendido. Medido na face frontal, no enquadramento padrao:
  //
  //     0xf6f8fa (casca)   -> tela 198,202,206
  //     0xcdd3d8 (painel)  -> tela ~164
  //     0xa1a9b0 (colar)   -> tela ~130
  //     0x454c52 (frisos)  -> tela ~56
  //
  // O antigo `matGantryGrey` era 0xcfd6dc e o `matGantryDark` 0x9aa3ab:
  // a "cinza" e a "escura" saiam na tela a 166 e 124 — perto demais da
  // casca a 198 para separar peca nenhuma. E o rodape, que devia dar peso
  // ao movel, chegava quase branco.
  // -----------------------------------------------------------
  var matCasca      = new THREE.MeshStandardMaterial({ color: 0xf6f8fa, roughness: 0.32, metalness: 0.08 });
  var matPainel     = new THREE.MeshStandardMaterial({ color: 0xcdd3d8, roughness: 0.42, metalness: 0.10 });
  var matColar      = new THREE.MeshStandardMaterial({ color: 0xa1a9b0, roughness: 0.48, metalness: 0.16 });
  var matFriso      = new THREE.MeshStandardMaterial({ color: 0x454c52, roughness: 0.55, metalness: 0.25 });
  var matRodape     = new THREE.MeshStandardMaterial({ color: 0x616970, roughness: 0.60, metalness: 0.20 });
  var matAcento     = new THREE.MeshStandardMaterial({ color: 0x2fb6cf, emissive: 0x0d5261, emissiveIntensity: 0.5, roughness: 0.35 });


  // -----------------------------------------------------------
  // DESENHO EM TEXTURA
  //
  // A primeira versao destes detalhes era GEOMETRIA: cilindros de 16 lados
  // para cada botao, ripas de caixa para cada grelha. A 3 m de distancia um
  // botao ocupa uns 8 pixels de tela — nesse tamanho um cilindro de 16 lados
  // nao le como botao, le como poligono, e nao ha onde pousar rotulo, borda
  // nem brilho. Era grosseiro por construcao.
  //
  // Aqui os comandos sao pintados em canvas a ~2.300 px/m e aplicados numa
  // chapa fina. Na tela isso da cerca de 5x mais amostras do que o pixel
  // precisa, entao a borda do botao, o glifo da seta e o rotulo continuam
  // limpos quando a camera chega perto — e somem em mip, sem serrilhar,
  // quando ela se afasta.
  // -----------------------------------------------------------
  function novaTela(w, h) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }
  function comoTextura(tela) {
    var t = new THREE.CanvasTexture(tela);
    t.anisotropy = 16;   // a face e vista de esguelha na maior parte da orbita
    return t;
  }
  /** Caminho de retangulo arredondado (o roundRect nativo nao esta em todo lugar). */
  function caminhoRedondo(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }
  /** Chapa metalica escovada, base de todos os paineis. */
  function fundoEscovado(c, w, h, claro, escuro) {
    var g = c.createLinearGradient(0, 0, w * 0.25, h);
    g.addColorStop(0, claro);
    g.addColorStop(1, escuro);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    for (var i = 0; i < h * 1.6; i++) {
      c.fillStyle = (i % 2) ? "rgba(255,255,255,0.028)" : "rgba(0,0,0,0.035)";
      c.fillRect(0, Math.random() * h, w, 1);
    }
  }
  /** Parafuso Phillips — o detalhe que diz "chapa aparafusada". */
  function parafuso(c, x, y, r) {
    var g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, "#9aa3aa");
    g.addColorStop(1, "#3f464c");
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(12,14,16,0.75)";
    c.lineWidth = Math.max(1, r * 0.22);
    c.beginPath();
    c.moveTo(x - r * 0.55, y); c.lineTo(x + r * 0.55, y);
    c.moveTo(x, y - r * 0.55); c.lineTo(x, y + r * 0.55);
    c.stroke();
  }

  // -----------------------------------------------------------
  // 1) CARENAGEM
  // -----------------------------------------------------------
  var RB = 0.10;  // raio dos cantos inferiores
  var RT = 0.55;  // raio dos cantos superiores (curva grande)

  /** Retangulo de cantos arredondados no perfil da carenagem. */
  function perfilCarenagem(w, h, rb, rt) {
    var s = new THREE.Shape();
    s.moveTo(-w / 2 + rb, -h / 2);
    s.lineTo(w / 2 - rb, -h / 2);
    s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + rb);
    s.lineTo(w / 2, h / 2 - rt);
    s.quadraticCurveTo(w / 2, h / 2, w / 2 - rt, h / 2);
    s.lineTo(-w / 2 + rt, h / 2);
    s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - rt);
    s.lineTo(-w / 2, -h / 2 + rb);
    s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + rb, -h / 2);
    return s;
  }

  var gShape = perfilCarenagem(GW, GH, RB, RT);
  var holePath = new THREE.Path();
  holePath.absarc(0, 0, BORE_R, 0, Math.PI * 2, false);
  gShape.holes.push(holePath);

  var gGeo = new THREE.ExtrudeGeometry(gShape, {
    depth: GDEPTH, bevelEnabled: true, bevelThickness: BEVEL_T, bevelSize: BEVEL_S, bevelSegments: 4, curveSegments: 64,
  });
  gGeo.translate(0, 0, -GDEPTH / 2);
  var gantryBody = new THREE.Mesh(gGeo, matCasca);
  gantryBody.position.set(0, ISO_Y, -0.6);
  gantryBody.castShadow = true;
  gantryBody.receiveShadow = true;
  gantryGroup.add(gantryBody);

  // -----------------------------------------------------------
  // 2) PAINEL FRONTAL SOBREPOSTO
  //
  // Uma placa cinza, menor que a carenagem, aparafusada por cima dela: a
  // moldura branca que sobra em volta e o que faz a face parar de ser uma
  // superficie unica. E uma peca EXTRUDADA, com 2 cm de espessura e bisel
  // proprio, e nao um decalque plano — o degrau precisa pegar luz por si,
  // senao a "sobreposicao" some assim que a camera gira.
  // -----------------------------------------------------------
  var PW = GW - 0.20, PH = GH - 0.22, PD = 0.02;
  var pShape = perfilCarenagem(PW, PH, 0.08, 0.46);
  var pHole = new THREE.Path();
  pHole.absarc(0, 0, BORE_R + 0.015, 0, Math.PI * 2, false);
  pShape.holes.push(pHole);
  var pGeo = new THREE.ExtrudeGeometry(pShape, {
    depth: PD, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 64,
  });
  var facePanel = new THREE.Mesh(pGeo, matPainel);
  facePanel.position.set(0, ISO_Y, FACE_Z - 0.001);
  facePanel.castShadow = true;
  facePanel.receiveShadow = true;
  gantryGroup.add(facePanel);
  // Superficie do painel: e daqui que sai tudo o que vem depois.
  var PANEL_Z = FACE_Z - 0.001 + PD + 0.008;

  /**
   * Friso escuro contornando o painel — a fresta entre a placa e a casca.
   *
   * ESTE PERFIL PRECISA DO FURO DO BORE, e e facil esquecer.
   *
   * A carenagem e o painel frontal empurram cada um o seu `holePath` antes de
   * extrudar. O friso nasceu sem, e virou uma CHAPA MACICA de 1,2 cm tapando a
   * boca do tunel em z = -0,137. O bore parecia continuar aberto porque a
   * chapa e escura e cai exatamente onde a garganta deveria estar — mas era
   * parede: a mesa entrava e SUMIA na boca, e o paciente desaparecia inteiro
   * ao cruzar esse plano. Antes de fechar o furo, um raio lancado pelo eixo do
   * bore batia nela; agora atravessa.
   *
   * O tunel tem de ficar vazado de ponta a ponta: e por ele que o aluno
   * acompanha a mesa entrando com o paciente.
   */
  var frisoShape = perfilCarenagem(PW + 0.05, PH + 0.05, 0.10, 0.48);
  var frisoFuro = new THREE.Path();
  frisoFuro.absarc(0, 0, BORE_R + 0.015, 0, Math.PI * 2, false);
  frisoShape.holes.push(frisoFuro);
  var frisoGeo = new THREE.ExtrudeGeometry(
    frisoShape,
    { depth: 0.012, bevelEnabled: false, curveSegments: 48 }
  );
  var friso = new THREE.Mesh(frisoGeo, matFriso);
  friso.position.set(0, ISO_Y, FACE_Z - 0.004);
  gantryGroup.add(friso);

  // -----------------------------------------------------------
  // 3) BORE: colar, acento e garganta
  // -----------------------------------------------------------
  // Face do bore, pintada em vez de empilhada.
  //
  // Antes eram duas pecas macicas: um colar extrudado e, por cima, uma
  // FAIXA CIANA de 3,5 cm de largura. Uma faixa chapada desse tamanho nao
  // existe em equipamento nenhum — le como brinquedo. Num aparelho real o
  // que ha em volta da boca e usinagem: degraus finos, uma canaleta escura
  // e, nos mais novos, um fio de luz dentro dela.
  //
  // O colar continua sendo geometria, porque e dele que vem a silhueta e a
  // sombra. O DESENHO da face virou uma textura de 1024 px sobre um anel:
  // degraus, canaleta e a escala de tracos a cada 5 graus, que a geometria
  // nao daria sem centenas de faces.
  var COLAR_ESP = 0.026;
  var colarGeo = new THREE.ExtrudeGeometry(
    (function () {
      var s = new THREE.Shape();
      s.absarc(0, 0, BORE_R + 0.17, 0, Math.PI * 2, false);
      var h = new THREE.Path();
      h.absarc(0, 0, BORE_R, 0, Math.PI * 2, true);
      s.holes.push(h);
      return s;
    })(),
    { depth: COLAR_ESP, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 96 }
  );
  var colar = new THREE.Mesh(colarGeo, matColar);
  colar.position.set(0, ISO_Y, PANEL_Z - 0.006);
  colar.castShadow = true;
  gantryGroup.add(colar);

  // Face do colar: o Z sai da SUPERFICIE do colar (extrusao + bisel), nao
  // da face do painel. Assentar pela face do painel e repetir na miniatura
  // o erro que enterrou a decoracao inteira.
  var COLAR_Z = PANEL_Z - 0.006 + COLAR_ESP + 0.006;

  var RING_OUT = BORE_R + 0.17;
  function texturaFaceBore() {
    var N = 1024, meio = N / 2;
    var tela = novaTela(N, N);
    var c = tela.getContext("2d");
    // `RingGeometry` mapeia o raio EXTERNO na borda da textura: 1 m vale
    // (N/2)/RING_OUT pixels. Todo raio abaixo vem em metros.
    var ppm = meio / RING_OUT;
    function px(m) { return m * ppm; }
    function disco(rM, cor) {
      c.fillStyle = cor;
      c.beginPath(); c.arc(meio, meio, px(rM), 0, Math.PI * 2); c.fill();
    }
    function anelGrad(r0, r1, c0, c1) {
      var g = c.createRadialGradient(meio, meio, px(r0), meio, meio, px(r1));
      g.addColorStop(0, c0); g.addColorStop(1, c1);
      c.fillStyle = g;
      c.beginPath(); c.arc(meio, meio, px(r1), 0, Math.PI * 2); c.fill();
    }
    // De fora para dentro.
    anelGrad(0.545, RING_OUT, "#b7bec4", "#98a1a8");   // chanfro externo
    anelGrad(0.492, 0.545, "#cdd3d8", "#bcc3c9");      // aba, onde vao os tracos
    disco(0.492, "#2b3237");                            // canaleta escura
    disco(0.470, "#7f878e");                            // degrau intermediario
    anelGrad(0.416, 0.455, "#b3bac0", "#959da4");       // colar interno
    disco(0.416, "#3a4147");                            // labio da boca

    // Escala de tracos: 5 em 5 graus, mais longos a cada 90.
    c.lineCap = "butt";
    for (var a = 0; a < 360; a += 5) {
      var noventa = (a % 90 === 0);
      var r0 = noventa ? 0.500 : 0.512, r1 = 0.538;
      var t = a * Math.PI / 180;
      c.strokeStyle = noventa ? "rgba(38,44,49,0.9)" : "rgba(70,79,86,0.65)";
      c.lineWidth = noventa ? 5 : 2.5;
      c.beginPath();
      c.moveTo(meio + Math.cos(t) * px(r0), meio + Math.sin(t) * px(r0));
      c.lineTo(meio + Math.cos(t) * px(r1), meio + Math.sin(t) * px(r1));
      c.stroke();
    }
    // Sombra propria da canaleta na borda de cima — cava a fresta.
    c.strokeStyle = "rgba(0,0,0,0.45)";
    c.lineWidth = px(0.006);
    c.beginPath(); c.arc(meio, meio, px(0.489), 0, Math.PI * 2); c.stroke();
    return comoTextura(tela);
  }
  var faceBore = new THREE.Mesh(
    new THREE.RingGeometry(BORE_R, RING_OUT, 128),
    new THREE.MeshStandardMaterial({ map: texturaFaceBore(), roughness: 0.42, metalness: 0.18 })
  );
  faceBore.position.set(0, ISO_Y, COLAR_Z + 0.002);
  gantryGroup.add(faceBore);

  // Fio de luz na canaleta. Oito milimetros, nao trinta e cinco: e uma
  // LINHA acesa dentro do rebaixo, e a canaleta em volta e que a faz ler.
  var acento = new THREE.Mesh(
    new THREE.RingGeometry(BORE_R + 0.074, BORE_R + 0.082, 128),
    matAcento
  );
  acento.position.set(0, ISO_Y, COLAR_Z + 0.0032);   // a face do bore esta em +0,002
  gantryGroup.add(acento);

  // Garganta do tunel: escurece para dentro, que e o que da profundidade.
  var liner = new THREE.Mesh(
    new THREE.CylinderGeometry(BORE_R, BORE_R, GDEPTH * 0.98, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x8b9298, roughness: 0.5, side: THREE.BackSide })
  );
  liner.rotation.x = Math.PI / 2;
  liner.position.set(0, ISO_Y, -0.6);
  gantryGroup.add(liner);

  // Boca chanfrada: um cone curto da borda do colar para dentro do tunel.
  var boca = new THREE.Mesh(
    new THREE.CylinderGeometry(BORE_R, BORE_R - 0.025, 0.05, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x6f767c, roughness: 0.45, side: THREE.BackSide })
  );
  boca.rotation.x = Math.PI / 2;
  boca.position.set(0, ISO_Y, COLAR_Z + 0.001);
  gantryGroup.add(boca);

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

  // -----------------------------------------------------------
  // 4) DISPLAY DO GANTRY (topo da face)
  // -----------------------------------------------------------
  // O painel real mostra tilt e altura da mesa. Aqui e uma textura fixa:
  // o valor VIVO ja mora no console (js/sala-exame.js escreve em
  // #display-table e #display-height). Repetir numero vivo em dois lugares,
  // um deles sem quem o atualize, seria mostrador mentindo.
  // As GRANDEZAS VIVAS moram aqui agora.
  //
  // Antes eram duas coisas separadas: um HUD em HTML flutuando no canto
  // superior esquerdo do viewport, e um retangulo azul pintado no gantry com
  // numeros FIXOS de enfeite. O aluno lia a mesa num canto da tela e olhava o
  // equipamento no outro — e o mostrador do equipamento mentia, porque ninguem
  // o atualizava.
  //
  // Num tomografo real esse painel e o mostrador da maquina. Agora e o desta
  // aqui tambem: `atualizarDisplay` redesenha a textura, e quem a alimenta e o
  // mesmo `updateReadouts` que ja calculava os valores para o HUD.
  var DISPLAY_W = 768, DISPLAY_H = 320;
  var telaDisplay = novaTela(DISPLAY_W, DISPLAY_H);
  var texDisplay = comoTextura(telaDisplay);

  var LINHAS_DISPLAY = [
    { rot: "MESA",   chave: "mesa",   unid: "mm" },
    { rot: "VELOC.", chave: "veloc",  unid: "mm/s" },
    { rot: "ALTURA", chave: "altura", unid: "cm" }
  ];
  var LUZES_DISPLAY = [
    { rot: "SISTEMA",   chave: "power" },
    { rot: "PRONTO",    chave: "ready" },
    { rot: "LASER",     chave: "laser" },
    { rot: "MOVIMENTO", chave: "motion" }
  ];

  /**
   * Redesenha o mostrador.
   * @param {object} d  { mesa, veloc, altura, estado, luzes:{power,ready,laser,motion} }
   */
  function atualizarDisplay(d) {
    d = d || {};
    var luzes = d.luzes || {};
    var c = telaDisplay.getContext("2d");
    var W = DISPLAY_W, H = DISPLAY_H;

    c.fillStyle = "#050b10"; c.fillRect(0, 0, W, H);
    var v = c.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.62);
    v.addColorStop(0, "rgba(20,44,56,0.55)");
    v.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = v; c.fillRect(0, 0, W, H);

    c.textAlign = "left";
    for (var i = 0; i < LINHAS_DISPLAY.length; i++) {
      var L = LINHAS_DISPLAY[i], y = 62 + i * 62;
      c.fillStyle = "#3f6d7d";
      c.font = "500 30px monospace";
      c.fillText(L.rot, 30, y);
      var txt = (d[L.chave] === undefined || d[L.chave] === null) ? "---" : String(d[L.chave]);
      c.fillStyle = "#79e8ff";
      c.shadowColor = "#2ea6c8"; c.shadowBlur = 14;
      c.font = "bold 46px monospace";
      c.textAlign = "right";
      c.fillText(txt, 500, y);
      c.shadowBlur = 0;
      c.fillStyle = "#3f6d7d";
      c.font = "500 24px monospace";
      c.textAlign = "left";
      c.fillText(L.unid, 512, y);
    }

    // Estado do alinhamento, na coluna da direita.
    c.textAlign = "center";
    c.fillStyle = "#1b3d48";
    caminhoRedondo(c, 596, 26, 146, 92, 8); c.fill();
    c.fillStyle = "#7fe6f7";
    c.font = "600 20px sans-serif";
    var est = (d.estado || "").split(" ");
    c.fillText(est[0] || "", 669, 60);
    if (est[1]) c.fillText(est.slice(1).join(" "), 669, 88);

    // Fila de luzes de estado, no rodape — as mesmas quatro do HUD antigo.
    var x0 = 30, largura = (W - 60) / LUZES_DISPLAY.length;
    for (var k = 0; k < LUZES_DISPLAY.length; k++) {
      var Z = LUZES_DISPLAY[k], on = !!luzes[Z.chave];
      var cx = x0 + largura * k + 16, cy = H - 34;
      c.beginPath(); c.arc(cx, cy, 9, 0, Math.PI * 2);
      c.fillStyle = on ? "#3ad46a" : "#1c2e33";
      c.fill();
      if (on) { c.shadowColor = "#3ad46a"; c.shadowBlur = 12; c.fill(); c.shadowBlur = 0; }
      c.textAlign = "left";
      c.fillStyle = on ? "#9fe6b6" : "#39525c";
      c.font = "600 19px sans-serif";
      c.fillText(Z.rot, cx + 16, cy + 7);
    }

    c.fillStyle = "rgba(255,255,255,0.030)";
    for (var y2 = 0; y2 < H; y2 += 4) c.fillRect(0, y2, W, 1);
    var r = c.createLinearGradient(0, 0, W * 0.55, H);
    r.addColorStop(0, "rgba(255,255,255,0.10)");
    r.addColorStop(0.35, "rgba(255,255,255,0.015)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = r; c.fillRect(0, 0, W, H);

    texDisplay.needsUpdate = true;
  }
  atualizarDisplay({ mesa: "000,0", veloc: "0,0", altura: "80,0", estado: "AGUARDANDO",
                     luzes: { power: true, ready: true, laser: false, motion: false } });

  // O mostrador cresceu: passa a caber tres grandezas, o estado e as luzes.
  var displayBezel = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.27, 0.018), matFriso);
  displayBezel.position.set(0, ISO_Y + 0.68, PANEL_Z + 0.007);
  gantryGroup.add(displayBezel);
  var displayScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.558, 0.2325),
    new THREE.MeshStandardMaterial({ map: texDisplay, emissive: 0x0e2c38, emissiveIntensity: 0.85, roughness: 0.18, metalness: 0.1 })
  );
  displayScreen.position.set(0, ISO_Y + 0.68, PANEL_Z + 0.0165);
  gantryGroup.add(displayScreen);

  // -----------------------------------------------------------
  // 5) COMANDOS LATERAIS (um de cada lado da face)
  //
  // Sao os botoes que o tecnico usa DE DENTRO da sala: mesa entra/sai,
  // sobe/desce, laser e confirmacao. Ficam a altura da mao.
  //
  // Antes: seis cilindros de 5,2 cm de diametro e 16 lados, sem rotulo
  // nenhum, numa chapa de 30 x 40 cm. Nenhum console de verdade tem botao de
  // 5 cm, e botao sem rotulo nao ensina o que faz. Agora a chapa tem
  // 22 x 29 cm, as teclas tem 4,5 cm e os redondos 3,4 cm, e o desenho —
  // poco, chanfro, glifo, rotulo, parafuso — e pintado a ~2.300 px/m.
  // -----------------------------------------------------------
  // MAPA DOS BOTOES, em pixels da textura.
  //
  // E o mesmo mapa que a rotina de desenho usa para pintar e que o raycast
  // usa para saber no que o operador clicou. Uma fonte so: se um botao mudar
  // de lugar, ele muda nos dois ao mesmo tempo, e nao ha como a area sensivel
  // sair de cima do desenho.
  var CMD_W = 512, CMD_H = 672;
  var CMD_CX = CMD_W / 2, CMD_CY = 272, CMD_L = 104, CMD_D = 116;
  var ZONAS = [
    { acao: "up",    tipo: "tecla",   cx: CMD_CX,        cy: CMD_CY - CMD_D, glifo: "cima",     rot: "SOBE",  segura: true },
    { acao: "down",  tipo: "tecla",   cx: CMD_CX,        cy: CMD_CY + CMD_D, glifo: "baixo",    rot: "DESCE", segura: true },
    { acao: "out",   tipo: "tecla",   cx: CMD_CX - CMD_D, cy: CMD_CY,        glifo: "esquerda", rot: "SAI",   segura: true },
    { acao: "in",    tipo: "tecla",   cx: CMD_CX + CMD_D, cy: CMD_CY,        glifo: "direita",  rot: "ENTRA", segura: true },
    { acao: "laser", tipo: "redondo", cx: CMD_W * 0.30,  cy: 522, r: 39, rot: "LASER",
      base: "#a8781a", brilho: "#f0c860" },
    { acao: "zerar", tipo: "redondo", cx: CMD_W * 0.70,  cy: 522, r: 39, rot: "ZERAR",
      base: "#1f7a3d", brilho: "#68d98d" }
  ];

  /** Em que botao caiu o ponto (u,v) da textura? Devolve a acao ou null. */
  function zonaEm(u, v) {
    var tx = u * CMD_W, ty = (1 - v) * CMD_H;   // v da UV sobe; y do canvas desce
    for (var i = 0; i < ZONAS.length; i++) {
      var Z = ZONAS[i];
      if (Z.tipo === "tecla") {
        if (Math.abs(tx - Z.cx) <= CMD_L / 2 + 6 && Math.abs(ty - Z.cy) <= CMD_L / 2 + 6) return Z.acao;
      } else {
        if (Math.hypot(tx - Z.cx, ty - Z.cy) <= Z.r + 8) return Z.acao;
      }
    }
    return null;
  }

  /**
   * Pinta um painel de comandos.
   * @param {CanvasRenderingContext2D} c
   * @param {string|null} pressionada  acao realcada como apertada
   * @param {object} ligados           { laser: true } para o anel aceso
   */
  function desenharComandos(c, pressionada, ligados) {
    ligados = ligados || {};
    fundoEscovado(c, CMD_W, CMD_H, "#59626a", "#394147");

    c.strokeStyle = "rgba(255,255,255,0.16)"; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, 2); c.lineTo(CMD_W, 2); c.stroke();
    c.strokeStyle = "rgba(0,0,0,0.35)";
    c.beginPath(); c.moveTo(0, CMD_H - 2); c.lineTo(CMD_W, CMD_H - 2); c.stroke();

    c.textAlign = "left";
    c.fillStyle = "#aeb9c1";
    c.font = "600 30px sans-serif";
    c.fillText("MESA", 40, 62);
    c.fillStyle = "rgba(255,255,255,0.12)";
    c.fillRect(40, 76, CMD_W - 80, 2);

    function tecla(Z, apertada) {
      var m = CMD_L / 2, cx = Z.cx, cy = Z.cy + (apertada ? 2 : 0);
      c.fillStyle = "rgba(0,0,0,0.42)";
      caminhoRedondo(c, cx - m - 5, Z.cy - m - 4, CMD_L + 10, CMD_L + 12, 16); c.fill();
      var g = c.createLinearGradient(0, cy - m, 0, cy + m);
      // Apertada, a tecla afunda: o gradiente inverte e o brilho de topo some.
      g.addColorStop(0, apertada ? "#4a525a" : "#7d868d");
      g.addColorStop(1, apertada ? "#6a737a" : "#565f66");
      c.fillStyle = g;
      caminhoRedondo(c, cx - m, cy - m, CMD_L, CMD_L, 13); c.fill();
      if (!apertada) {
        c.strokeStyle = "rgba(255,255,255,0.30)"; c.lineWidth = 2;
        caminhoRedondo(c, cx - m + 1.5, cy - m + 1.5, CMD_L - 3, CMD_L - 3, 12); c.stroke();
      }
      var t = CMD_L * 0.26;
      c.fillStyle = apertada ? "#9fe8ff" : "#e6edf2";
      c.beginPath();
      if (Z.glifo === "cima")     { c.moveTo(cx, cy - t); c.lineTo(cx + t, cy + t * 0.72); c.lineTo(cx - t, cy + t * 0.72); }
      if (Z.glifo === "baixo")    { c.moveTo(cx, cy + t); c.lineTo(cx + t, cy - t * 0.72); c.lineTo(cx - t, cy - t * 0.72); }
      if (Z.glifo === "esquerda") { c.moveTo(cx - t, cy); c.lineTo(cx + t * 0.72, cy + t); c.lineTo(cx + t * 0.72, cy - t); }
      if (Z.glifo === "direita")  { c.moveTo(cx + t, cy); c.lineTo(cx - t * 0.72, cy + t); c.lineTo(cx - t * 0.72, cy - t); }
      c.closePath(); c.fill();
    }

    function redondo(Z, apertada, aceso) {
      var cx = Z.cx, cy = Z.cy, r = Z.r;
      c.fillStyle = "rgba(0,0,0,0.45)";
      c.beginPath(); c.arc(cx, cy + 3, r + 7, 0, Math.PI * 2); c.fill();
      var g = c.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
      g.addColorStop(0, (apertada || aceso) ? "#ffffff" : Z.brilho);
      g.addColorStop(1, (apertada || aceso) ? Z.brilho : Z.base);
      c.fillStyle = g;
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
      if (aceso) {   // anel aceso: o laser ligado se ve do outro lado da sala
        c.strokeStyle = "rgba(255,255,255,0.85)"; c.lineWidth = 4;
        c.beginPath(); c.arc(cx, cy, r + 6, 0, Math.PI * 2); c.stroke();
      }
      c.strokeStyle = "rgba(255,255,255,0.22)"; c.lineWidth = 2;
      c.beginPath(); c.arc(cx, cy, r - 1, 0, Math.PI * 2); c.stroke();
      c.fillStyle = "rgba(255,255,255,0.35)";
      c.beginPath();
      c.ellipse(cx - r * 0.28, cy - r * 0.38, r * 0.32, r * 0.20, -0.5, 0, Math.PI * 2);
      c.fill();
      c.textAlign = "center";
      c.fillStyle = "#aab5bd";
      c.font = "500 20px sans-serif";
      c.fillText(Z.rot, cx, cy + r + 30);
      c.textAlign = "left";
    }

    ZONAS.forEach(function (Z) {
      var apertada = (pressionada === Z.acao);
      if (Z.tipo === "tecla") tecla(Z, apertada);
      else redondo(Z, apertada, !!ligados[Z.acao]);
    });

    // Rotulos das teclas.
    c.fillStyle = "#9aa5ad";
    c.font = "500 20px sans-serif";
    c.textAlign = "center";
    c.fillText("SOBE", CMD_CX, CMD_CY - CMD_D - 66);
    c.fillText("DESCE", CMD_CX, CMD_CY + CMD_D + 80);
    c.save(); c.translate(CMD_CX - CMD_D - 70, CMD_CY); c.rotate(-Math.PI / 2);
    c.fillText("SAI", 0, 0); c.restore();
    c.save(); c.translate(CMD_CX + CMD_D + 72, CMD_CY); c.rotate(Math.PI / 2);
    c.fillText("ENTRA", 0, 0); c.restore();
    c.textAlign = "left";

    c.fillStyle = "#2fb6cf";
    c.fillRect(40, CMD_H - 44, CMD_W - 80, 5);
    parafuso(c, 26, 26, 11); parafuso(c, CMD_W - 26, 26, 11);
    parafuso(c, 26, CMD_H - 26, 11); parafuso(c, CMD_W - 26, CMD_H - 26, 11);
  }

  // Cada lado tem a SUA textura: os dois painels sao independentes, e o realce
  // de apertado tem de aparecer so naquele em que a mao esta.
  var facesComando = [];
  function painelComando(lado) {
    var g = new THREE.Group();
    var borda = new THREE.Mesh(new THREE.BoxGeometry(0.228, 0.298, 0.016), matFriso);
    g.add(borda);

    var tela = novaTela(CMD_W, CMD_H);
    var ctx = tela.getContext("2d");
    var tex = comoTextura(tela);
    desenharComandos(ctx, null, {});

    var face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.29),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.30 })
    );
    face.position.z = 0.0085;
    // O raycast so precisa achar ESTA malha; guarda como repintar.
    face.userData.repintar = function (pressionada, ligados) {
      desenharComandos(ctx, pressionada, ligados);
      tex.needsUpdate = true;
    };
    g.add(face);
    facesComando.push(face);

    g.position.set(lado * 0.70, ISO_Y + 0.02, PANEL_Z + 0.009);
    return g;
  }
  gantryGroup.add(painelComando(-1));
  gantryGroup.add(painelComando(1));

  // Botao de emergencia: cogumelo vermelho sobre anel amarelo. E o controle
  // mais reconhecivel de qualquer sala de exame.
  //
  // Era um cilindro de 6,8 cm de diametro e 20 lados — grande demais (o de
  // norma tem 40 mm) e com o perfil errado: cogumelo tem topo abaulado e
  // cintura, e e a cintura que o olho reconhece. `LatheGeometry` gira o
  // perfil de verdade, com 40 lados.
  var perfilCogumelo = [
    new THREE.Vector2(0.0000, 0.0255),
    new THREE.Vector2(0.0075, 0.0252),
    new THREE.Vector2(0.0135, 0.0243),
    new THREE.Vector2(0.0180, 0.0224),
    new THREE.Vector2(0.0203, 0.0193),
    new THREE.Vector2(0.0210, 0.0150),
    new THREE.Vector2(0.0208, 0.0090),
    new THREE.Vector2(0.0170, 0.0055),
    new THREE.Vector2(0.0150, 0.0000)
  ];
  var matCogumelo = new THREE.MeshStandardMaterial({ color: 0xb52d25, roughness: 0.38, metalness: 0.05 });
  var matAnelEmerg = new THREE.MeshStandardMaterial({ color: 0xc2a01c, roughness: 0.52 });
  function botaoEmergencia(lado) {
    var g = new THREE.Group();
    var anel = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.030, 0.008, 40), matAnelEmerg);
    anel.rotation.x = Math.PI / 2;
    g.add(anel);
    // +PI/2, nao -PI/2: `LatheGeometry` cresce em +Y, e -PI/2 leva +Y para
    // -Z — o cogumelo brotava para DENTRO da carenagem e so o anel amarelo
    // aparecia. Mesma armadilha da calota do LED, logo abaixo.
    var cogumelo = new THREE.Mesh(new THREE.LatheGeometry(perfilCogumelo, 40), matCogumelo);
    cogumelo.rotation.x = Math.PI / 2;
    cogumelo.position.z = 0.004;
    cogumelo.castShadow = true;
    g.add(cogumelo);
    g.position.set(lado * 0.70, ISO_Y + 0.40, PANEL_Z + 0.008);
    return g;
  }
  var emergencias = [];
  [-1, 1].forEach(function (lado) {
    var g = botaoEmergencia(lado);
    g.children.forEach(function (m) { if (m.isMesh) emergencias.push(m); });
    gantryGroup.add(g);
  });

  // LED de status: lente abaulada sobre aro escuro. Uma calota pega o brilho
  // na quina; o disco chato de antes so mudava de cor.
  function ledStatus(lado) {
    var g = new THREE.Group();
    var aro = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.006, 24), matFriso);
    aro.rotation.x = Math.PI / 2;
    g.add(aro);
    var lente = new THREE.Mesh(
      new THREE.SphereGeometry(0.0082, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x5ce88a, emissive: 0x1f8f42, emissiveIntensity: 1.1, roughness: 0.22 })
    );
    lente.rotation.x = Math.PI / 2;
    lente.position.z = 0.003;
    g.add(lente);
    g.position.set(lado * 0.70, ISO_Y + 0.53, PANEL_Z + 0.008);
    return g;
  }
  gantryGroup.add(ledStatus(-1));
  gantryGroup.add(ledStatus(1));

  // -----------------------------------------------------------
  // 6) GRELHAS DE VENTILACAO
  //
  // Um gantry dissipa calor de tubo e eletronica, e a grelha e o detalhe que
  // mais rapido diz "isto e uma maquina". Eram 7 ripas de caixa por lado —
  // 14 malhas para desenhar 7 riscos grossos. Uma textura entrega 14 frestas
  // finas por lado, com o labio iluminado embaixo de cada uma, em 1 malha.
  // -----------------------------------------------------------
  function texturaGrelha() {
    var W = 384, H = 288;
    var tela = novaTela(W, H);
    var c = tela.getContext("2d");
    fundoEscovado(c, W, H, "#c6ccd1", "#a7aeb4");
    var n = 14, passo = (H - 24) / n;
    for (var i = 0; i < n; i++) {
      var y = 12 + i * passo;
      var g = c.createLinearGradient(0, y, 0, y + passo * 0.62);
      g.addColorStop(0, "#171b1e");
      g.addColorStop(1, "#333a3f");
      c.fillStyle = g;
      caminhoRedondo(c, 16, y, W - 32, passo * 0.62, 3); c.fill();
      // Labio: a chapa dobrada pega luz na aresta de baixo.
      c.fillStyle = "rgba(255,255,255,0.55)";
      c.fillRect(16, y + passo * 0.62, W - 32, 1.6);
    }
    parafuso(c, 10, 10, 7); parafuso(c, W - 10, 10, 7);
    parafuso(c, 10, H - 10, 7); parafuso(c, W - 10, H - 10, 7);
    return comoTextura(tela);
  }
  var texGrelha = texturaGrelha();
  function grelha(lado) {
    var m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.24, 0.18),
      new THREE.MeshStandardMaterial({ map: texGrelha, roughness: 0.6, metalness: 0.2 })
    );
    m.position.set(lado * 0.70, ISO_Y - 0.62, PANEL_Z + 0.002);
    return m;
  }
  gantryGroup.add(grelha(-1));
  gantryGroup.add(grelha(1));

  // -----------------------------------------------------------
  // 7) PLACA DE IDENTIFICACAO (abaixo do bore)
  // -----------------------------------------------------------
  function texturaPlaca() {
    var W = 1024, H = 160;
    var tela = novaTela(W, H);
    var c = tela.getContext("2d");
    fundoEscovado(c, W, H, "#d6dbdf", "#b9c0c6");
    c.fillStyle = "#2b343b";
    c.font = "600 62px sans-serif";
    c.fillText("SIMULADOR TC", 40, 100);
    c.fillStyle = "#2fb6cf";
    c.fillRect(560, 40, 7, 62);
    c.fillStyle = "#5d686f";
    c.font = "400 34px sans-serif";
    c.fillText("EDUCACIONAL", 592, 92);
    c.strokeStyle = "rgba(0,0,0,0.30)"; c.lineWidth = 3;
    c.strokeRect(1.5, 1.5, W - 3, H - 3);
    parafuso(c, 22, 22, 9); parafuso(c, W - 22, 22, 9);
    parafuso(c, 22, H - 22, 9); parafuso(c, W - 22, H - 22, 9);
    return comoTextura(tela);
  }
  var placa = new THREE.Mesh(
    new THREE.PlaneGeometry(0.52, 0.081),
    new THREE.MeshStandardMaterial({ map: texturaPlaca(), roughness: 0.45, metalness: 0.25 })
  );
  placa.position.set(0, ISO_Y - 0.50, PANEL_Z + 0.003);
  gantryGroup.add(placa);

  // -----------------------------------------------------------
  // 8) LATERAIS: tampa de servico
  //
  // As laterais eram parede lisa de 0,9 m. A tampa aparafusada quebra a
  // massa e da ao gantry um tamanho legivel de perfil — que e como ele
  // aparece na maior parte das orbitas da camera.
  // -----------------------------------------------------------
  // A LATERAL DA CASCA SATURA. Medido nesta cena: a face +X do corpo, virada
  // para a luz principal, sai da tela em 255,255,255 — branco puro, sem
  // gradiente nenhum. Nao adianta pousar ali uma peca clara: a tampa foi
  // desenhada primeiro em matPainel (0xcdd3d8) e chegava a 212 contra 255,
  // diferenca que se perde no primeiro passo que a camera da para tras.
  // Por isso aqui a peca e a `matColar` e a moldura e a `matFriso`: a
  // lateral so ganha desenho com tom que NAO estoure.
  function tampaServico(lado) {
    var g = new THREE.Group();
    // A moldura escura fica ATRAS da tampa e um pouco maior: o que se ve
    // dela e a margem em volta, que e a fresta da tampa aparafusada.
    var moldura = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.94, 0.48), matFriso);
    moldura.position.x = lado * 0.005;
    g.add(moldura);
    var tampa = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.90, 0.44), matColar);
    tampa.position.x = lado * 0.008;
    g.add(tampa);
    // Trinco junto da borda da frente, onde a mao alcanca.
    var puxador = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.05, 0.14), matFriso);
    puxador.position.set(lado * 0.016, 0, 0.14);
    g.add(puxador);
    // Abaixo do friso de acento de proposito: as duas pecas moram na mesma
    // lateral, e a tampa e mais saliente — sobrepostas, ela cortaria o friso
    // ao meio.
    g.position.set(lado * LADO_X, ISO_Y - 0.25, -0.62);
    return g;
  }
  gantryGroup.add(tampaServico(-1));
  gantryGroup.add(tampaServico(1));

  /**
   * Friso de acento correndo na lateral.
   *
   * Estava em ISO_Y + 0,60 e FLUTUAVA 2,65 cm fora da carenagem. O perfil
   * nao e um retangulo: acima de `GH/2 - RT` comeca a curva do ombro, e ali
   * a meia-largura ja caiu de 1,000 para 0,9775 — medido. Uma peca colada em
   * x = GW/2 so encosta ABAIXO desse ponto, e e por isso que a altura vem
   * daqui, e nao de um numero escolhido a olho.
   */
  var Y_OMBRO = ISO_Y + GH / 2 - RT;   // 1,20 m — onde o perfil deixa de ser reto
  function frisoLateral(lado) {
    var f = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.030, GDEPTH - 0.10), matAcento);
    f.position.set(lado * (LADO_X + 0.004), Y_OMBRO - 0.07, -0.6);
    return f;
  }
  gantryGroup.add(frisoLateral(-1));
  gantryGroup.add(frisoLateral(1));

  // -----------------------------------------------------------
  // 9) RODAPE
  //
  // Duas pecas, nao uma: o bloco escuro que assenta no piso e um recuo
  // mais escuro por baixo. O recuo e o que faz o gantry PARECER apoiado
  // em vez de flutuar — sem ele a carenagem encosta no chao numa linha
  // reta, que e leitura de caixa, nao de equipamento.
  // -----------------------------------------------------------
  var rodape = new THREE.Mesh(new THREE.BoxGeometry(GW + 0.06, 0.13, GDEPTH + 0.08), matRodape);
  rodape.position.set(0, 0.115, -0.6);
  rodape.castShadow = true;
  rodape.receiveShadow = true;
  gantryGroup.add(rodape);

  var recuo = new THREE.Mesh(
    new THREE.BoxGeometry(GW - 0.10, 0.05, GDEPTH - 0.06),
    new THREE.MeshStandardMaterial({ color: 0x33383d, roughness: 0.7 })
  );
  recuo.position.set(0, 0.025, -0.6);
  gantryGroup.add(recuo);

  // Fita de acento na testa do rodape, alinhada com o anel do bore.
  var fitaRodape = new THREE.Mesh(
    new THREE.BoxGeometry(GW - 0.30, 0.016, 0.012),
    matAcento
  );
  fitaRodape.position.set(0, 0.155, -0.6 + (GDEPTH + 0.08) / 2 + 0.002);
  gantryGroup.add(fitaRodape);

    return { gantryGroup: gantryGroup, spinArc: spinArc,
             GANTRY_FACE_Z: GANTRY_FACE_Z, ISO_Y: ISO_Y, BORE_R: BORE_R,
             // Comando pelo proprio aparelho: a sala faz o raycast contra
             // `facesComando`, pergunta a `zonaEm` em que botao caiu e repinta
             // pelo `userData.repintar` da face atingida.
             facesComando: facesComando, zonaEm: zonaEm,
             emergencias: emergencias,
             atualizarDisplay: atualizarDisplay };
  }

  window.SimTC = window.SimTC || {};
  SimTC.Sala3D = window.SimTC.Sala3D || {};
  SimTC.Sala3D.montarGantry = montarGantry;

})();
