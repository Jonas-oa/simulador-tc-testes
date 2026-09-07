/**
 * js/medidas.js
 * Ferramentas de medida sobre a série reconstruída: distância, ângulo e ROI.
 *
 * A auditoria registrou a ausência: o visualizador tinha janelamento, crosshair
 * e renderização 3D, mas nenhuma forma de MEDIR — nem distância, nem ângulo,
 * nem estatística de HU. Para um simulador de TC isso é central: o aluno
 * precisa ver que um pixel de água dá ~0 HU e um de osso passa de 1000, e que
 * o desvio-padrão numa ROI homogênea É o ruído que o mAs escolhido produziu.
 *
 * As medidas usam os HU REAIS da série reconstruída e o `pixelMm` que veio de
 * FOV/matriz — não a imagem em tons de cinza da tela. Uma distância medida
 * aqui é a distância física.
 *
 * Depende de: js/motor-imagem.js, js/ui/formatar.js
 * Script clássico.
 *
 * DUPLICAÇÃO DELIBERADA. Existe um segundo módulo de medidas em
 * `dicom-viewer/js/medidas.js`, e a auditoria o apontou como duplicação. A
 * ETAPA 7 decidiu NÃO unificar, e o motivo fica registrado aqui para que
 * ninguém "conserte" isso por engano:
 *
 *   • `dicom-viewer/` é cópia vendorizada de outro repositório
 *     (Jonas-oa/Leitor-Dicon), com licença própria e um README que aponta o
 *     commit de origem. Unificar exigiria acoplá-lo ao `core/` deste projeto,
 *     e ressincronizar com o upstream deixaria de ser possível.
 *   • Os modelos diferem de verdade: lá se mede num volume com espaçamento
 *     por eixo, em três planos; aqui, numa série reconstruída com `pixelMm`
 *     escalar, só no axial.
 *
 * O que os dois têm em comum é a fórmula, não a estrutura. A fronteira é de
 * vendor, e nomear a fronteira vale mais do que apagá-la.
 */
(function () {
  "use strict";

  var FERRAMENTAS = ["nenhuma", "distancia", "angulo", "roi"];

  function init() {
    var caixa = document.getElementById("ws-slice-viewer");
    var img = document.getElementById("ws-slice-img");
    var barra = document.getElementById("ws-medidas");
    var painel = document.getElementById("ws-medidas-saida");
    if (!caixa || !img || !barra) return;

    var canvas = document.createElement("canvas");
    canvas.className = "ws-medidas__tela";
    canvas.hidden = true;
    caixa.appendChild(canvas);

    var ferramenta = "nenhuma";
    var medidas = [];          // {tipo, pontos:[{x,y}...], resultado}
    var arrastando = null;
    var corteAtual = -1;

    function motor() { return window.SimTC && SimTC.MotorImagem; }
    function serie() { var m = motor(); return m && m.temSeries() ? m.serieAtual() : null; }

    // ---- geometria: tela <-> imagem <-> paciente ------------------------
    function ajustarTela() {
      var r = img.getBoundingClientRect();
      var rc = caixa.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      canvas.width = Math.round(r.width);
      canvas.height = Math.round(r.height);
      canvas.style.left = (r.left - rc.left) + "px";
      canvas.style.top = (r.top - rc.top) + "px";
      canvas.style.width = r.width + "px";
      canvas.style.height = r.height + "px";
      return true;
    }

    /** Ponto do evento em coordenadas do CANVAS (px de tela). */
    function pontoDe(ev) {
      var r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    /** Converte px de tela para px da MATRIZ reconstruída. */
    function paraMatriz(p) {
      var s = serie();
      if (!s || !canvas.width) return null;
      return { x: p.x / canvas.width * s.matriz, y: p.y / canvas.height * s.matriz };
    }

    /** Distância em MILÍMETROS entre dois pontos de tela. */
    function distanciaMm(a, b) {
      var s = serie();
      if (!s) return null;
      var ma = paraMatriz(a), mb = paraMatriz(b);
      var dx = (mb.x - ma.x) * s.pixelMm, dy = (mb.y - ma.y) * s.pixelMm;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function anguloGraus(a, b, c) {
      // ângulo em B, entre BA e BC
      var v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
      var n1 = Math.hypot(v1.x, v1.y), n2 = Math.hypot(v2.x, v2.y);
      if (!n1 || !n2) return null;
      var cos = (v1.x * v2.x + v1.y * v2.y) / (n1 * n2);
      return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    }

    /**
     * Estatística de HU numa ROI retangular. Percorre os HU REAIS da série,
     * não os tons de cinza — é isso que faz a medida valer.
     */
    function estatisticaROI(a, b) {
      var s = serie();
      if (!s) return null;
      var ma = paraMatriz(a), mb = paraMatriz(b);
      var x0 = Math.max(0, Math.floor(Math.min(ma.x, mb.x)));
      var x1 = Math.min(s.matriz - 1, Math.ceil(Math.max(ma.x, mb.x)));
      var y0 = Math.max(0, Math.floor(Math.min(ma.y, mb.y)));
      var y1 = Math.min(s.matriz - 1, Math.ceil(Math.max(ma.y, mb.y)));
      if (x1 <= x0 || y1 <= y0) return null;

      var n = s.matriz;
      var base = corteAtual * n * n;
      var soma = 0, soma2 = 0, cont = 0, mn = Infinity, mx = -Infinity;
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          var v = s.hu[base + y * n + x];
          soma += v; soma2 += v * v; cont++;
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
      if (!cont) return null;
      var media = soma / cont;
      var dp = Math.sqrt(Math.max(0, soma2 / cont - media * media));
      var areaMm2 = cont * s.pixelMm * s.pixelMm;
      return {
        media: media, dp: dp, min: mn, max: mx,
        pixels: cont, areaMm2: areaMm2,
        larguraMm: (x1 - x0 + 1) * s.pixelMm,
        alturaMm: (y1 - y0 + 1) * s.pixelMm
      };
    }

    // ---- desenho ---------------------------------------------------------
    function desenhar() {
      if (!canvas.width) return;
      var ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 1.5;
      ctx.font = "12px ui-monospace, Menlo, Consolas, monospace";
      ctx.textBaseline = "bottom";

      var lista = medidas.slice();
      if (arrastando) lista.push(arrastando);

      lista.forEach(function (m) {
        var cor = m === arrastando ? "#ffd166" : "#4fd1e0";
        ctx.strokeStyle = cor; ctx.fillStyle = cor;
        var p = m.pontos;
        if (m.tipo === "distancia" && p.length >= 2) {
          linha(ctx, p[0], p[1]);
          alca(ctx, p[0]); alca(ctx, p[1]);
          var d = distanciaMm(p[0], p[1]);
          if (d != null) rotulo(ctx, meio(p[0], p[1]), SimTC.fmt.mm(d));
        } else if (m.tipo === "angulo" && p.length >= 2) {
          linha(ctx, p[0], p[1]);
          if (p.length >= 3) {
            linha(ctx, p[1], p[2]);
            var a = anguloGraus(p[0], p[1], p[2]);
            if (a != null) rotulo(ctx, p[1], SimTC.fmt.graus(a, 1));
          }
          p.forEach(function (q) { alca(ctx, q); });
        } else if (m.tipo === "roi" && p.length >= 2) {
          var x = Math.min(p[0].x, p[1].x), y = Math.min(p[0].y, p[1].y);
          var w = Math.abs(p[1].x - p[0].x), h = Math.abs(p[1].y - p[0].y);
          ctx.strokeRect(x, y, w, h);
          var e = m.resultado || estatisticaROI(p[0], p[1]);
          if (e) rotulo(ctx, { x: x + w / 2, y: y }, Math.round(e.media) + " HU");
        }
      });
    }

    function linha(ctx, a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    function alca(ctx, p) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.stroke(); }
    function meio(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    function rotulo(ctx, p, txt) {
      var larg = ctx.measureText(txt).width + 8;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(p.x - larg / 2, p.y - 18, larg, 16);
      ctx.fillStyle = "#e8f7fa";
      ctx.textAlign = "center";
      ctx.fillText(txt, p.x, p.y - 5);
      ctx.restore();
    }

    // ---- painel de resultados -------------------------------------------
    function renderSaida() {
      if (!painel) return;
      if (!medidas.length) { painel.hidden = true; painel.innerHTML = ""; return; }
      var html = "";
      medidas.forEach(function (m, i) {
        var p = m.pontos;
        if (m.tipo === "distancia" && p.length >= 2) {
          var d = distanciaMm(p[0], p[1]);
          html += item(i, "Distância", d != null ? SimTC.fmt.mm(d) : "—");
        } else if (m.tipo === "angulo" && p.length >= 3) {
          var a = anguloGraus(p[0], p[1], p[2]);
          html += item(i, "Ângulo", a != null ? SimTC.fmt.graus(a, 1) : "—");
        } else if (m.tipo === "roi" && p.length >= 2) {
          var e = m.resultado;
          if (e) {
            html += item(i, "ROI",
              "<b>" + SimTC.fmt.hu(e.media) + "</b> ± " + SimTC.fmt.n(e.dp, 1) +
              " <small>(mín " + e.min + " · máx " + e.max + " · " +
              e.pixels + " px · " + SimTC.fmt.mm2(e.areaMm2) + ")</small>");
          }
        }
      });
      painel.innerHTML = html;
      painel.hidden = false;
    }
    function item(i, tipo, valor) {
      return '<div class="ws-med__item"><span class="ws-med__tipo">' + tipo +
        '</span><span class="ws-med__val">' + valor +
        '</span><button type="button" class="ws-med__x" data-rm="' + i + '" aria-label="Remover medida">✕</button></div>';
    }

    // ---- interação -------------------------------------------------------
    canvas.addEventListener("pointerdown", function (ev) {
      if (ferramenta === "nenhuma" || !serie()) return;
      ev.preventDefault();
      var p = pontoDe(ev);
      if (ferramenta === "angulo" && arrastando && arrastando.pontos.length === 2) {
        arrastando.pontos.push(p);
        medidas.push(arrastando); arrastando = null;
        desenhar(); renderSaida();
        return;
      }
      arrastando = { tipo: ferramenta, pontos: [p, p] };
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignora */ }
      desenhar();
    });

    canvas.addEventListener("pointermove", function (ev) {
      if (!arrastando) return;
      var p = pontoDe(ev);
      arrastando.pontos[arrastando.pontos.length - 1] = p;
      desenhar();
    });

    canvas.addEventListener("pointerup", function (ev) {
      if (!arrastando) return;
      try { canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* ignora */ }
      if (arrastando.tipo === "angulo" && arrastando.pontos.length === 2) {
        desenhar();   // aguarda o terceiro clique
        return;
      }
      if (arrastando.tipo === "roi") arrastando.resultado = estatisticaROI(arrastando.pontos[0], arrastando.pontos[1]);
      // descarta cliques sem arraste
      var d = Math.hypot(arrastando.pontos[1].x - arrastando.pontos[0].x,
                         arrastando.pontos[1].y - arrastando.pontos[0].y);
      if (d >= 5) medidas.push(arrastando);
      arrastando = null;
      desenhar(); renderSaida();
    });

    if (painel) painel.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest("[data-rm]") : null;
      if (!b) return;
      medidas.splice(parseInt(b.getAttribute("data-rm"), 10), 1);
      desenhar(); renderSaida();
    });

    barra.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest(".ws-med__btn") : null;
      if (!b) return;
      var f = b.getAttribute("data-ferramenta");
      if (f === "limpar") {
        medidas = []; arrastando = null;
        desenhar(); renderSaida();
        return;
      }
      ferramenta = (ferramenta === f) ? "nenhuma" : f;
      if (FERRAMENTAS.indexOf(ferramenta) < 0) ferramenta = "nenhuma";
      arrastando = null;
      atualizarBarra();
      desenhar();
    });

    function atualizarBarra() {
      Array.prototype.forEach.call(barra.querySelectorAll(".ws-med__btn"), function (b) {
        b.classList.toggle("is-active", b.getAttribute("data-ferramenta") === ferramenta);
      });
      canvas.style.pointerEvents = ferramenta === "nenhuma" ? "none" : "auto";
      canvas.style.cursor = ferramenta === "nenhuma" ? "default" : "crosshair";
    }

    // ---- ciclo de vida ---------------------------------------------------
    var API = {
      /** Ativa a barra quando há série reconstruída, no corte informado. */
      sincronizar: function (indiceCorte) {
        var s = serie();
        var ativo = !!s;
        barra.hidden = !ativo;
        canvas.hidden = !ativo;
        if (!ativo) { medidas = []; renderSaida(); return; }
        if (indiceCorte !== corteAtual) {
          // Medidas pertencem ao corte em que foram feitas: trocar de corte
          // (ou de série) as descarta, em vez de exibi-las sobre outro plano.
          corteAtual = indiceCorte;
          medidas = []; arrastando = null;
          renderSaida();
        }
        if (ajustarTela()) desenhar();
      },
      ferramenta: function (f) { if (f) { ferramenta = f; atualizarBarra(); } return ferramenta; },
      medidas: function () { return medidas.slice(); },
      // expostos para teste
      _estatisticaROI: estatisticaROI,
      _distanciaMm: distanciaMm
    };

    window.addEventListener("resize", function () { if (ajustarTela()) desenhar(); });
    atualizarBarra();

    window.SimTC = window.SimTC || {};
    SimTC.Medidas = API;
  }

  window.SimTC = window.SimTC || {};
  SimTC.MedidasInit = { init: init };

})();
