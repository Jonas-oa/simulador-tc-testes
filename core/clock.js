/**
 * core/clock.js
 * Relógio de simulação com PASSO FIXO, desacoplado do loop de pintura.
 *
 * Problema que isto resolve (B-14 da auditoria): toda a física da sala rodava
 * dentro de requestAnimationFrame. Quando o navegador para de pintar — aba em
 * segundo plano, janela minimizada, canvas fora da tela, dispositivo em
 * economia de energia — o rAF é suspenso e a AQUISIÇÃO CONGELA no meio. Num
 * equipamento real a mesa não para porque ninguém está olhando.
 *
 * Solução: o relógio aceita várias FONTES de tique. A física avança pelo tempo
 * real decorrido, em passos fixos, qualquer que seja a fonte:
 *
 *   • rAF   — quando a página pinta (barato, sincronizado com o vídeo)
 *   • timer — Worker com setInterval; não sofre throttling de aba oculta
 *
 * As duas fontes podem correr juntas sem dobrar a simulação: `avancar()` mede
 * o tempo REAL desde o último processamento, então quem chegar primeiro
 * consome o intervalo e a outra fonte encontra ~0 para consumir.
 *
 * Passo fixo também torna a simulação REPRODUTÍVEL: mesma sequência de passos
 * produz o mesmo resultado, o que é o que permite testar a física.
 *
 * SEM dependência de DOM — funciona em Worker. Script clássico.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};

  var PASSO_PADRAO_S = 1 / 120;   // 120 Hz: fino o bastante p/ mesa e gantry
  var ATRASO_MAX_S = 0.25;        // teto de tempo real absorvido por chamada

  function agoraMs() {
    return (raiz.performance && raiz.performance.now)
      ? raiz.performance.now()
      : Date.now();
  }

  /**
   * @param {object} [opts]
   * @param {number} [opts.passoS=1/120]  duração do passo fixo, em segundos
   * @param {number} [opts.atrasoMaxS=0.25] teto de recuperação por chamada.
   *   Sem teto, voltar de 10 min em segundo plano dispararia 72 000 passos de
   *   uma vez e travaria a aba ("espiral da morte"). Com teto, o tempo
   *   excedente é descartado e a simulação simplesmente não andou.
   */
  function Relogio(opts) {
    opts = opts || {};
    this.passoS = opts.passoS > 0 ? opts.passoS : PASSO_PADRAO_S;
    this.atrasoMaxS = opts.atrasoMaxS > 0 ? opts.atrasoMaxS : ATRASO_MAX_S;

    this._acumuladoS = 0;
    this._ultimoMs = null;
    this._assinantes = [];
    this._rodando = false;
    this._fontes = [];

    // Telemetria — usada pelos testes de aceite e pelo diagnóstico.
    this.tempoSimS = 0;      // tempo simulado acumulado
    this.passos = 0;         // total de passos executados
    this.descartadoS = 0;    // tempo real perdido por exceder atrasoMaxS
    this.fonteAtual = null;  // "raf" | "timer" — quem entregou o último passo
  }

  /** Assina o passo fixo. fn(passoS, tempoSimS). Devolve cancelador. */
  Relogio.prototype.aoPasso = function (fn) {
    if (typeof fn !== "function") throw new TypeError("assinante precisa ser função");
    this._assinantes.push(fn);
    var self = this;
    return function () {
      var i = self._assinantes.indexOf(fn);
      if (i >= 0) self._assinantes.splice(i, 1);
    };
  };

  /**
   * Consome o tempo real decorrido em passos fixos. Idempotente entre fontes:
   * chamar duas vezes no mesmo instante executa passos só na primeira.
   * @returns {number} quantidade de passos executados nesta chamada
   */
  Relogio.prototype.avancar = function (marcaMs, fonte) {
    if (!this._rodando) return 0;
    var t = (typeof marcaMs === "number") ? marcaMs : agoraMs();

    if (this._ultimoMs === null) { this._ultimoMs = t; return 0; }

    var decorridoS = (t - this._ultimoMs) / 1000;
    this._ultimoMs = t;
    if (!(decorridoS > 0)) return 0;   // relógio parado ou para trás

    if (decorridoS > this.atrasoMaxS) {
      this.descartadoS += decorridoS - this.atrasoMaxS;
      decorridoS = this.atrasoMaxS;
    }

    this._acumuladoS += decorridoS;

    // Tolerância contra deriva de ponto flutuante. Sem ela, 0,055 s menos
    // cinco passos de 0,01 s sobra 0,00499…9 em vez de 0,005, e o passo
    // seguinte deixa de fechar por uma diferença invisível — a simulação
    // "perde" passos de forma imprevisível.
    var eps = this.passoS * 1e-9;

    var executados = 0;
    while (this._acumuladoS >= this.passoS - eps) {
      this._acumuladoS -= this.passoS;
      this.tempoSimS += this.passoS;
      this.passos++;
      executados++;
      this.fonteAtual = fonte || null;
      var lista = this._assinantes;
      for (var i = 0; i < lista.length; i++) {
        try { lista[i](this.passoS, this.tempoSimS); }
        catch (e) {
          if (raiz.console && raiz.console.error) raiz.console.error("[relogio] passo falhou:", e);
        }
      }
    }
    return executados;
  };

  /** Fração do passo já acumulada (0..1) — para interpolar o render. */
  Relogio.prototype.alfa = function () {
    return this.passoS > 0 ? (this._acumuladoS / this.passoS) : 0;
  };

  /**
   * Liga o relógio e suas fontes.
   * @param {object} [opts]
   * @param {boolean} [opts.raf=true]    usa requestAnimationFrame quando existir
   * @param {boolean} [opts.timer=true]  usa Worker/setInterval (imune a throttling)
   * @param {number}  [opts.timerMs=16]  período do tique do timer
   */
  Relogio.prototype.iniciar = function (opts) {
    if (this._rodando) return this;
    opts = opts || {};
    this._rodando = true;
    this._ultimoMs = null;
    this._acumuladoS = 0;

    var self = this;
    var usarRaf = opts.raf !== false && typeof raiz.requestAnimationFrame === "function";
    var usarTimer = opts.timer !== false;

    if (usarRaf) {
      var idRaf = null;
      (function laco(marca) {
        if (!self._rodando) return;
        self.avancar(marca, "raf");
        idRaf = raiz.requestAnimationFrame(laco);
      })(agoraMs());
      this._fontes.push(function () {
        if (idRaf !== null && raiz.cancelAnimationFrame) raiz.cancelAnimationFrame(idRaf);
      });
    }

    if (usarTimer) {
      this._fontes.push(criarFonteTimer(function () {
        self.avancar(agoraMs(), "timer");
      }, opts.timerMs || 16));
    }

    return this;
  };

  Relogio.prototype.parar = function () {
    this._rodando = false;
    for (var i = 0; i < this._fontes.length; i++) {
      try { this._fontes[i](); } catch (e) { /* ignora */ }
    }
    this._fontes = [];
    return this;
  };

  Relogio.prototype.rodando = function () { return this._rodando; };

  /**
   * Avanço MANUAL, para testes: executa exatamente n passos, sem depender de
   * tempo real nem de fonte de tique. É o que torna a física verificável.
   */
  Relogio.prototype.passoManual = function (n) {
    n = n | 0;
    for (var k = 0; k < n; k++) {
      this.tempoSimS += this.passoS;
      this.passos++;
      this.fonteAtual = "manual";
      for (var i = 0; i < this._assinantes.length; i++) {
        this._assinantes[i](this.passoS, this.tempoSimS);
      }
    }
    return this;
  };

  /**
   * Fonte de tique imune ao throttling de aba oculta.
   * Navegadores limitam setTimeout/setInterval a ~1 Hz em páginas ocultas,
   * mas NÃO limitam timers dentro de um Worker. Quando Worker não estiver
   * disponível (ou já estivermos dentro de um), cai para setInterval.
   */
  function criarFonteTimer(aoTique, periodoMs) {
    var dentroDeWorker = (typeof raiz.importScripts === "function");
    if (!dentroDeWorker && typeof raiz.Worker === "function" &&
        typeof raiz.Blob === "function" && raiz.URL && raiz.URL.createObjectURL) {
      try {
        var fonte = "var id=setInterval(function(){postMessage(0)}," + periodoMs + ");" +
                    "onmessage=function(){clearInterval(id);close()};";
        var url = raiz.URL.createObjectURL(new raiz.Blob([fonte], { type: "text/javascript" }));
        var w = new raiz.Worker(url);
        w.onmessage = aoTique;
        return function () {
          try { w.postMessage("parar"); } catch (e) { /* ignora */ }
          try { w.terminate(); } catch (e) { /* ignora */ }
          try { raiz.URL.revokeObjectURL(url); } catch (e) { /* ignora */ }
        };
      } catch (e) { /* cai no setInterval abaixo */ }
    }
    var id = raiz.setInterval(aoTique, periodoMs);
    return function () { raiz.clearInterval(id); };
  }

  Core.Relogio = Relogio;
  Core.relogio = new Relogio();

})(typeof self !== "undefined" ? self : this);
