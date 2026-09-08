/**
 * js/ui-layout.js
 * Simulador Educacional de TC — Layout e Infraestrutura de UI.
 *
 * Gerencia toda a camada de apresentacao transversal, sem logica clinica:
 *   • Console guiado desktop (etapas 1→2→3→4, banner de contexto)
 *   • Divisorias arrastaveis do painel de 4 quadrantes
 *   • Modo celular (classes mob-*, seletor flutuante)
 *   • Painel de comandos movel da Sala (arrastar/escalar)
 *   • PiP da Sala 3D durante a aquisicao
 *   • Reparenting dos botoes de aquisicao no celular
 *
 * Persiste estado em localStorage (layout, etapa, posicao do painel).
 *
 * Depende de: js/shared.js (SimTC)
 * Script classico — sem ES modules, sem bundler.
 */
(function () {
  "use strict";

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
  // MODO DE LAYOUT — um controlador só
  //
  // Havia DOIS, ligados aos mesmos botões: `initMobileMode` aqui e
  // js/mobile-tabs.js. Cada clique em "Sala" ou "Exame" disparava os dois,
  // com lógicas diferentes — um persistia a escolha, o outro não; um marcava
  // `is-active` em dois dos quatro botões, o outro nos quatro. O resultado
  // dependia da ordem das tags <script>, e o segundo controlador chegava a
  // chamar `mobileToggle.click()` por código para entrar no modo celular:
  // acoplamento por clique sintético.
  //
  // E havia um estado morto. Abaixo de 901 px o CSS escondia a barra de
  // etapas, e nada ligava o modo celular ao redimensionar — ele só era
  // decidido na CARGA. Quem estreitava a janela, ou girava o tablet, caía num
  // app com quatro painéis empilhados e NENHUMA navegação. Medido na
  // auditoria: `body.className` vazio, console-steps oculto, mobile-switch
  // oculto.
  //
  // A regra agora é uma só, e é invariante:
  //
  //     o app nunca fica sem navegação.
  //
  // Em tela estreita, o modo celular entra sozinho — a menos que o operador
  // tenha saído dele de propósito nesta sessão, e nesse caso a barra de
  // etapas fica no lugar. As duas navegações se revezam; nunca somem juntas.
  // =================================================================
  var VIEWS = ["3d", "aq", "pacproto", "mpr"];
  var CLASSES_VIEW = ["mob-3d", "mob-aq", "mob-pacproto", "mob-mpr"];
  var CHAVE_VIEW = "simuladorTC.mobileView";
  var CHAVE_SAIU = "simuladorTC.mobileExit";
  var ESTREITO = 900;

  function initModoDeLayout() {
    var body = document.body;
    var btn = document.getElementById("mobile-toggle");
    var sw = document.getElementById("mobile-switch");
    var bExit = document.getElementById("mob-exit");
    var botoes = Array.prototype.slice.call(document.querySelectorAll("[data-mobile-view]"));
    if (!btn || !sw || botoes.length !== VIEWS.length) return;

    function pokeResize() { window.dispatchEvent(new Event("resize")); }
    function estreito() { return window.innerWidth <= ESTREITO; }
    function saiuDeProposito() {
      try { return sessionStorage.getItem(CHAVE_SAIU) === "1"; } catch (e) { return false; }
    }
    function marcarSaida(saiu) {
      try {
        if (saiu) sessionStorage.setItem(CHAVE_SAIU, "1");
        else sessionStorage.removeItem(CHAVE_SAIU);
      } catch (e) { /* sem persistência: vale só para esta janela */ }
    }
    function normalizar(v) {
      // Migração: as telas "pac" e "proto" foram fundidas em "pacproto".
      if (v === "pac" || v === "proto") v = "pacproto";
      return VIEWS.indexOf(v) >= 0 ? v : "3d";
    }
    function viewGuardada() {
      try { return normalizar(localStorage.getItem(CHAVE_VIEW)); } catch (e) { return "3d"; }
    }

    function setView(v, guardar) {
      v = normalizar(v);
      CLASSES_VIEW.forEach(function (c) { body.classList.remove(c); });
      body.classList.add("mob-" + v);
      botoes.forEach(function (b) {
        var ativo = b.getAttribute("data-mobile-view") === v;
        b.classList.toggle("is-active", ativo);
        if (ativo) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
      });
      if (guardar !== false) {
        try { localStorage.setItem(CHAVE_VIEW, v); } catch (e) { /* sem persistência */ }
      }
      window.requestAnimationFrame(function () {
        pokeResize();
        var painel = body.querySelector(".dash-pane:not([style*='display: none'])");
        if (painel) painel.scrollTop = 0;
      });
    }

    function ligarCelular(ligado) {
      body.classList.toggle("is-mobile", ligado);
      btn.setAttribute("aria-pressed", ligado ? "true" : "false");
      sw.hidden = !ligado;
      if (ligado) setView(viewGuardada(), false);
      else CLASSES_VIEW.forEach(function (c) { body.classList.remove(c); });
      pokeResize();
    }

    btn.addEventListener("click", function () {
      var ligando = !body.classList.contains("is-mobile");
      marcarSaida(!ligando);
      ligarCelular(ligando);
    });
    botoes.forEach(function (b) {
      b.addEventListener("click", function () { setView(b.getAttribute("data-mobile-view")); });
    });
    if (bExit) bExit.addEventListener("click", function () {
      marcarSaida(true);
      ligarCelular(false);
    });

    // Reavalia a CADA redimensionamento, e não só na carga: girar o tablet ou
    // estreitar a janela é exatamente quando o app ficava sem navegação.
    function reavaliar() {
      var celular = body.classList.contains("is-mobile");
      if (estreito() && !celular && !saiuDeProposito()) ligarCelular(true);
    }
    window.addEventListener("resize", reavaliar);
    reavaliar();
    if (body.classList.contains("is-mobile")) setView(viewGuardada(), false);
  }

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

    /** Aplica a escala e ANUNCIA o valor: a alça de canto é um `role="slider"`. */
    function aplicarEscala(v) {
      scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, v));
      panel.style.setProperty("--panel-scale", scale);
      var pct = Math.round(scale * 100);
      resize.setAttribute("aria-valuenow", String(pct));
      resize.setAttribute("aria-valuetext", pct + "%");
    }

    function loadState() {
      try {
        var s = parseFloat(localStorage.getItem(KEY_SCALE));
        if (!isNaN(s)) aplicarEscala(s);
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
        aplicarEscala(startScale + d / baseW);
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

    // ---- E PELO TECLADO ----
    //
    // As duas alças diziam `role="button"` e traziam `tabindex="-1"`: eram
    // anunciadas ao leitor de tela como botões e não podiam ser alcançadas por
    // ninguém. Uma promessa que o app não cumpria.
    //
    // Cumpri-la é mais honesto do que retirá-la. Mover e redimensionar o painel
    // de comandos é conveniência — mas quem opera só por teclado é justamente
    // quem mais precisa tirar o painel da frente da imagem.
    //
    // A alça de mover é `role="application"` porque captura as setas (não há
    // papel padrão para arrastar em duas dimensões). A de canto é
    // `role="slider"`, que É o papel certo: tem valor, mínimo e máximo, e o
    // leitor de tela já anuncia que se opera com as setas.
    var PASSO = 12, PASSO_FINO = 2;        // px por tecla
    var DEGRAU = 0.05, DEGRAU_FINO = 0.01; // escala por tecla

    function mover(dx, dy) {
      ensurePositioned();
      var left = parseFloat(panel.style.getPropertyValue("--panel-left")) || 0;
      var top = parseFloat(panel.style.getPropertyValue("--panel-top")) || 0;
      var c = clampPos(left + dx, top + dy);
      panel.style.setProperty("--panel-left", c.left + "px");
      panel.style.setProperty("--panel-top", c.top + "px");
      persistPos();
    }

    var SETAS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

    grip.addEventListener("keydown", function (e) {
      var d = SETAS[e.key];
      if (!d) return;
      e.preventDefault();
      var p = e.shiftKey ? PASSO_FINO : PASSO;
      mover(d[0] * p, d[1] * p);
    });

    resize.addEventListener("keydown", function (e) {
      var passo = e.shiftKey ? DEGRAU_FINO : DEGRAU;
      var d = 0;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") d = passo;
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") d = -passo;
      else if (e.key === "Home") { ensurePositioned(); aplicarEscala(SCALE_MIN); reclampCurrent(); persistScale(); e.preventDefault(); return; }
      else if (e.key === "End") { ensurePositioned(); aplicarEscala(SCALE_MAX); reclampCurrent(); persistScale(); e.preventDefault(); return; }
      else return;
      e.preventDefault();
      ensurePositioned();
      aplicarEscala(scale + d);
      reclampCurrent();
      persistScale();
    });

    loadState();
    aplicarEscala(scale); // o slider nasce anunciando o valor que tem
  }

  function initConsoleMode() {
    var body = document.body;
    var bar = document.getElementById("console-steps");
    var toggle = document.getElementById("console-toggle");
    var banner = document.getElementById("console-banner");
    if (!bar || !toggle) return;

    var KEY = "simuladorTC.console";
    var STEPS = ["sim", "pacproto", "acq", "mpr"];
    var state = { on: true, step: "sim" }; // console é o padrão no desktop
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved) {
        if (saved.on === false) state.on = false;
        // Migração: as etapas "pac" e "proto" foram fundidas em "pacproto".
        var savedStep = (saved.step === "pac" || saved.step === "proto") ? "pacproto" : saved.step;
        if (STEPS.indexOf(savedStep) >= 0) state.step = savedStep;
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
    /**
     * O console guiado depende do modo celular, e nao mais da LARGURA.
     *
     * Exigir 901 px fazia sentido enquanto o CSS escondia a barra de etapas em
     * tela estreita — mas era exatamente isso que produzia o estado sem
     * navegacao: quem saisse do modo celular numa janela estreita ficava com o
     * console desligado E a barra oculta. A barra agora rola na horizontal
     * quando nao cabe, entao ela funciona em qualquer largura.
     */
    function podeUsarConsole() {
      return !body.classList.contains("is-mobile");
    }

    function setDot(step, show) {
      var d = document.getElementById("cdot-" + step);
      if (d) d.hidden = !show;
    }

    // Pendências didáticas + banner persistente (nome · prontuário ·
    // protocolo · posição/status da mesa, espelhados do display).
    function updateInfo() {
      var pac = (SimTC.examSessionApi && SimTC.examSessionApi.get) ? SimTC.examSessionApi.get() : null;
      var prot = SimTC.examProtocol ? SimTC.examProtocol.data : null;
      var onTable = SimTC.tableDriveApi && SimTC.tableDriveApi.isPatientOnTable && SimTC.tableDriveApi.isPatientOnTable();
      setDot("pacproto", !(pac && prot));
      setDot("sim", !!(pac && SimTC.tableDriveApi && !onTable));
      setDot("acq", !!(pac && prot && (!SimTC.tableDriveApi || onTable)));
      setDot("mpr", !(SimTC.mprApi && SimTC.mprApi.hasVolume && SimTC.mprApi.hasVolume()));
      var parts = [];
      parts.push(pac ? (pac.nome + " · " + (pac.prontuario || "s/ prontuário")) : "Sem paciente em exame");
      if (prot) parts.push("Prot.: " + prot.nome);
      var dt = document.getElementById("display-table");
      var ds = document.getElementById("display-status");
      if (dt && dt.textContent) parts.push("Mesa " + dt.textContent.trim());
      if (ds && ds.textContent) parts.push(ds.textContent.trim());
      var text = parts.join("  ·  ");
      // Banner do console (desktop) e banner de paisagem do celular
      // compartilham a mesma informação de contexto.
      if (banner) banner.textContent = text;
      // O trilho tem 66 px: o contexto nao cabe escrito nele. Continua no DOM
      // (o leitor de tela o le, e o rodape de mensagens o repete por extenso) e
      // aparece ao passar o mouse sobre a coluna.
      if (bar) bar.setAttribute("title", text);
      var mb = document.getElementById("mobile-banner");
      if (mb) mb.textContent = text;
    }

    // Aplica classes/visibilidade SEM disparar resize (usada também no
    // handler de resize — evita loop com o pokeResize).
    function applyClasses() {
      var active = state.on && podeUsarConsole();
      body.classList.toggle("console-mode", active);
      STEPS.forEach(function (st) {
        body.classList.toggle("cstep-" + st, active && st === state.step);
      });
      // A barra some SO no modo celular. Antes ela sumia junto com o console
      // guiado — e desde que os tres botoes de icone passaram a morar nela
      // (a barra de status foi removida), some-la deixaria o operador sem
      // como voltar ao console, sem como entrar no modo celular e sem como
      // trocar o tema. Fora do console ela encolhe ate ser so os botoes; quem
      // faz isso e o CSS.
      bar.hidden = !podeUsarConsole();
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
      SimTC.showMessage(state.on
        ? "Console guiado: uma etapa por vez (1 Sala → 2 Paciente & Protocolo → 3 Exame → 4 MPR/3D)."
        : "Modo painel: 4 quadrantes simultâneos com divisórias ajustáveis.", "info");
    });

    // Entrar/sair do modo celular ou cruzar o breakpoint de 900px
    // liga/desliga o console (sem loop: applyClasses não dispara resize).
    window.addEventListener("resize", applyClasses);

    setInterval(function () {
      if (!bar.hidden || body.classList.contains("is-mobile")) updateInfo();
    }, 1200);

    SimTC.contratos.declarar("consoleUiApi", {
      isConsole: function () { return state.on && podeUsarConsole(); },
      getStep: function () { return state.step; },
      setStep: function (st) {
        if (STEPS.indexOf(st) < 0) return;
        state.step = st; persist(); apply();
      }
    });

    apply();
  }

  // -----------------------------------------------------------------
  // EMPRESTAR UM ELEMENTO A OUTRO LUGAR DA TELA
  //
  // Dois pedacos do app mudam de pai conforme a etapa: o viewport 3D (vai do
  // quadrante da Sala para o slot do Exame) e a barra de comandos da sequencia
  // (vai para o topo, no modo celular). A manobra era escrita duas vezes, igual
  // nas duas, e nas duas o endereco de casa era guardado como REFERENCIA AO
  // IRMAO SEGUINTE:
  //
  //     var homeNext = el.nextSibling;
  //     ...
  //     home.insertBefore(el, homeNext);
  //
  // Isso so funciona enquanto ninguem mexer no container de origem. No dia em
  // que aquele irmao sair do DOM, `insertBefore` lanca NotFoundError e o
  // elemento fica orfao no meio da tela — um defeito que aparece longe daqui.
  //
  // Uma ancora de comentario nao tem esse problema: ela e nossa, ninguem a
  // remove, e ela marca o lugar exato. Invisivel, e nao conta em :nth-child.
  // -----------------------------------------------------------------
  function emprestar(el, nome) {
    var ancora = document.createComment(" " + nome + " mora aqui ");
    el.parentNode.insertBefore(ancora, el);
    return {
      /** Devolve o elemento ao lugar de origem. Devolve true se mudou de pai. */
      paraCasa: function () {
        if (el.parentNode === ancora.parentNode) return false;
        ancora.parentNode.insertBefore(el, ancora.nextSibling);
        return true;
      },
      /** Move para o destino. Devolve true se mudou de pai. */
      para: function (destino) {
        if (el.parentNode === destino) return false;
        destino.appendChild(el);
        return true;
      }
    };
  }

  // A auditoria (item E-06) sugeria PARAR de reparentar o canvas WebGL e, em
  // vez disso, deixa-lo num unico lugar, posicionado por CSS sobre o slot da
  // vez. Foi medido antes de decidir: seis idas e voltas entre a Sala e o
  // Exame, no Chromium, com o contexto sob observacao —
  //
  //     sala -> sala-view    1439x738   canvas 1769x907
  //     exame -> acq3d-body   322x310   canvas  396x381
  //     ... (6 ciclos)        webglcontextlost: 0   isContextLost(): false
  //
  // O contexto sobrevive, o ResizeObserver reajusta o buffer, e a cena
  // continua desenhando. Trocar isso por um canvas fixo rastreando o retangulo
  // de um slot custaria sincronizar posicao, rolagem e empilhamento a mao — mais
  // superficie de erro do que a que existe hoje, para consertar algo que nao
  // esta quebrado. FICA COMO ESTA, e a medida fica escrita para quem revisitar.
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

    var emprestimo = emprestar(vp, "viewport 3D");
    var curPhase = "idle";
    var userHidden = false;

    // Devolve o viewport 3D ao quadrante da Sala.
    function toHome() {
      emprestimo.paraCasa();
      pip.hidden = true;
      if (acq3d) acq3d.hidden = true;
    }

    function update() {
      var b = document.body;
      var mobile = b.classList.contains("is-mobile");
      var onExamDesktop = !!(SimTC.consoleUiApi && SimTC.consoleUiApi.isConsole() && SimTC.consoleUiApi.getStep() === "acq");
      var onExamMobile = mobile && b.classList.contains("mob-aq");
      // Sala 3D fica SEMPRE visível na etapa Exame (antes, durante e depois
      // da aquisição), para o aluno acompanhar a mesa.
      var want = (onExamDesktop || onExamMobile) && !userHidden;
      if (!want) { toHome(); return; }
      // Layout de 4 quadrantes: a Sala 3D vive no quadrante inferior direito
      // (slot #acq3d-body), no desktop e no celular. O PiP flutuante fica
      // como fallback caso o slot não exista.
      if (acq3dBody) {
        emprestimo.para(acq3dBody);
        if (acq3d) acq3d.hidden = false;
        pip.hidden = true;
      } else {
        emprestimo.para(pipBody);
        pip.hidden = false;
        if (acq3d) acq3d.hidden = true;
      }
      // O ResizeObserver do renderer reajusta o canvas ao reparentar.
      requestAnimationFrame(function () { window.dispatchEvent(new Event("resize")); });
    }

    SimTC.aoMudarFase(function (p) {
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

  function initMobileExamCommands() {
    var foot = document.querySelector(".acq-seq__foot");
    var host = document.getElementById("acq-topo-cmds");
    if (!foot || !host) return;
    var emprestimo = emprestar(foot, "comandos da sequencia");
    function update() {
      var b = document.body;
      var want = b.classList.contains("is-mobile") && b.classList.contains("mob-aq");
      if (want) {
        emprestimo.para(host);
        host.hidden = false;
      } else {
        emprestimo.paraCasa();
        host.hidden = true;
      }
    }
    var mo = new MutationObserver(update);
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", update);
    update();
  }

  window.SimTC = window.SimTC || {};
  SimTC.Layout = {
    init: function () {
      initDashboardSplit();
      initModoDeLayout();
      initMobilePanel();
      initConsoleMode();
      initAcqPip();
      initMobileExamCommands();
    }
  };

})();