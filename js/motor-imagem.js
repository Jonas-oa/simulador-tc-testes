/**
 * js/motor-imagem.js
 * Ponte entre o motor de aquisição/reconstrução e a tela.
 *
 * É o cabo que faltava. Até aqui o núcleo sabia projetar, aplicar Poisson,
 * filtrar e retroprojetar — tudo testado —, mas a interface continuava
 * exibindo os cortes do volume direto. Resultado: mudar o mAs não mudava nada
 * na tela, que era exatamente o defeito B-02 que o motor veio resolver.
 *
 * Este módulo:
 *   • dispara a aquisição num Worker (o cálculo não pode travar a sala 3D);
 *   • guarda as séries reconstruídas;
 *   • entrega os cortes como dataURL, no mesmo contrato que a tela já usa.
 *
 * Depende de: core/ (via Worker), js/fonte-volume.js
 * Script clássico.
 */
(function () {
  "use strict";

  var worker = null;
  var emCurso = null;

  var estado = {
    series: [],        // séries reconstruídas do último exame
    atual: 0,          // índice da série exibida
    bruto: null,       // resumo do dado bruto
    dose: null,        // relatorio de dose CALCULADO
    aec: null,         // o que a modulacao fez
    janela: { wl: 40, ww: 400 }
  };

  var cache = Object.create(null);   // "serie:corte:wl:ww" -> dataURL

  function pintarHU(hu, n, janela) {
    var lut = window.SimTCCore.lutJanela(janela.wl, janela.ww);
    var MIN = window.SimTCCore.HU.MIN;
    var cvs = document.createElement("canvas");
    cvs.width = n; cvs.height = n;
    var ctx = cvs.getContext("2d");
    var img = ctx.createImageData(n, n);
    var d = img.data;
    for (var i = 0, o = 0; i < hu.length; i++, o += 4) {
      var k = hu[i] - MIN;
      if (k < 0) k = 0; else if (k >= lut.length) k = lut.length - 1;
      d[o] = d[o + 1] = d[o + 2] = lut[k];
      d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cvs.toDataURL();
  }

  var Motor = {
    disponivel: function () {
      return typeof Worker === "function" && !!window.SimTCCore && !!window.SimTCCore.recon;
    },

    ocupado: function () { return !!emCurso; },

    /**
     * Executa a aquisição completa.
     * @param {object} o
     * @param {string} o.regiaoId       id do volume ("torax", "tronco", "cranio")
     * @param {object} o.plano          { inicioMm, fimMm } no eixo CC do volume
     * @param {object} o.aquisicao      { kv, mas, pitch, modo }
     * @param {Array}  o.reconstrucoes  parâmetros de cada série
     * @param {object} [o.qualidade]    { vistas, detectores, linhaMm }
     * @param {function} [o.aoProgresso]
     * @returns {Promise}
     */
    executar: function (o) {
      if (emCurso) return Promise.reject(new Error("Já existe uma reconstrução em curso."));
      return new Promise(function (resolve, reject) {
        try {
          // Versao na URL: sem ela o navegador serve o Worker do cache e
          // uma alteracao no motor simplesmente nao aparece.
          worker = new Worker("js/worker-aquisicao.js?v=" + (window.__SIMTC_REV__ || "1"));
        } catch (e) {
          reject(new Error("Não foi possível iniciar o processador de imagens: " + e.message));
          return;
        }
        emCurso = { resolve: resolve, reject: reject };

        worker.onmessage = function (ev) {
          var m = ev.data || {};
          if (m.tipo === "etapa") {
            if (o.aoProgresso) o.aoProgresso(m);
            return;
          }
          if (m.tipo === "erro") {
            finalizar();
            reject(new Error(m.mensagem));
            return;
          }
          if (m.tipo === "pronto") {
            estado.series = m.series.map(function (s) {
              s.hu = new Int16Array(s.dados);
              delete s.dados;
              return s;
            });
            estado.atual = 0;
            estado.bruto = m.bruto;
            estado.dose = m.dose || null;
            estado.aec = m.aec || null;
            cache = Object.create(null);
            finalizar();
            resolve(estado);
          }
        };
        worker.onerror = function (ev) {
          finalizar();
          reject(new Error(ev.message || "falha no processador de imagens"));
        };

        worker.postMessage({
          tipo: "executar",
          regiaoId: o.regiaoId,
          plano: o.plano,
          aquisicao: o.aquisicao,
          reconstrucoes: o.reconstrucoes,
          regiao: o.regiao,
          aec: o.aec || null,
          qualidade: o.qualidade,
          semente: o.semente || Math.floor(Math.random() * 100000) + 1
        });
      });
    },

    abortar: function () {
      if (!worker) return;
      try { worker.terminate(); } catch (e) { /* ignora */ }
      if (emCurso) emCurso.reject(new Error("Reconstrução abortada."));
      finalizar();
    },

    // ---- consulta ------------------------------------------------------
    temSeries: function () { return estado.series.length > 0; },
    series: function () { return estado.series; },
    serieAtual: function () { return estado.series[estado.atual] || null; },
    indiceAtual: function () { return estado.atual; },
    bruto: function () { return estado.bruto; },
    dose: function () { return estado.dose; },
    aec: function () { return estado.aec; },

    selecionarSerie: function (i) {
      if (i < 0 || i >= estado.series.length) return false;
      estado.atual = i;
      return true;
    },

    cortes: function () {
      var s = Motor.serieAtual();
      return s ? s.cortes : 0;
    },

    janela: function (j) {
      if (j) { estado.janela = { wl: j.wl, ww: j.ww }; }
      return estado.janela;
    },

    /** Corte i da série atual, como dataURL — mesmo contrato da tela. */
    axial: function (i) {
      var s = Motor.serieAtual();
      if (!s) return null;
      i = Math.max(0, Math.min(s.cortes - 1, i | 0));
      var j = estado.janela;
      var chave = estado.atual + ":" + i + ":" + j.wl + ":" + j.ww;
      if (cache[chave]) return cache[chave];
      var n = s.matriz;
      var fatia = s.hu.subarray(i * n * n, (i + 1) * n * n);
      var url = pintarHU(fatia, n, j);
      cache[chave] = url;
      return url;
    },

    /**
     * Quantos cortes o plano tem, na série atual.
     *
     * Coronal e sagital cortam a matriz no plano, então têm `matriz` cortes;
     * o axial tem os cortes que a reconstrução produziu. Antes existiam TRÊS
     * respostas diferentes para isto — a do slider, a da mprApi e a da série —
     * porque cada uma media um volume diferente.
     */
    cortesNoPlano: function (plano) {
      var s = Motor.serieAtual();
      if (!s) return 0;
      return (plano === "coronal" || plano === "sagital") ? s.matriz : s.cortes;
    },

    /**
     * Reformatação coronal ou sagital, a partir dos HU da série.
     *
     * Isto substitui um caminho que renderizava cada corte axial em PNG,
     * recarregava como <img>, desenhava num canvas de 256 px, lia os pixels de
     * volta e montava um volume de OITO BITS já janelado — destruindo os HU
     * que o motor tinha acabado de reconstruir. Pior: o laço percorria os
     * cortes do VOLUME-FONTE (125, no crânio) enquanto a série tinha 32, e a
     * leitura saturava no último corte: três quartos das linhas do coronal
     * eram cópias da mesma imagem, e o resultado era uma faixa vertical
     * uniforme. Foi escrito antes de existir motor de reconstrução e nunca
     * migrado depois que ele chegou.
     *
     * Agora a reformatação lê o mesmo Int16Array que o axial exibe, com o
     * `pixelMm` e o `incrementoMm` que a própria reconstrução definiu.
     *
     * ORIENTAÇÃO. O volume é LPS: x cresce para a esquerda do paciente, y para
     * posterior, z para superior. Nos dois planos o eixo vertical é o z, com a
     * cabeça em cima — daí a inversão da linha. No coronal o eixo horizontal é
     * x (direita→esquerda); no sagital é y (anterior→posterior), com o
     * anterior à esquerda, que é como se lê um perfil.
     *
     * @param {"coronal"|"sagital"} plano
     * @param {number} idx  linha (coronal, y) ou coluna (sagital, x) da matriz
     * @returns {string|null} dataURL, ou null sem série
     */
    reformatar: function (plano, idx) {
      var s = Motor.serieAtual();
      if (!s || (plano !== "coronal" && plano !== "sagital")) return null;
      var n = s.matriz, nz = s.cortes;
      idx = Math.max(0, Math.min(n - 1, idx | 0));
      var j = estado.janela;
      var chave = "r:" + plano + ":" + estado.atual + ":" + idx + ":" + j.wl + ":" + j.ww;
      if (cache[chave]) return cache[chave];

      var lut = window.SimTCCore.lutJanela(j.wl, j.ww);
      var MIN = window.SimTCCore.HU.MIN;
      var planoDeCorte = n * n;

      var cru = document.createElement("canvas");
      cru.width = n; cru.height = nz;
      var cx = cru.getContext("2d");
      var img = cx.createImageData(n, nz);
      var d = img.data;

      for (var z = 0; z < nz; z++) {
        var linha = nz - 1 - z;              // cabeça em cima
        var base = z * planoDeCorte;
        var destino = linha * n * 4;
        for (var c = 0; c < n; c++) {
          var hu = (plano === "coronal")
            ? s.hu[base + idx * n + c]        // fixa y = idx, varre x
            : s.hu[base + c * n + idx];       // fixa x = idx, varre y
          var k = hu - MIN;
          if (k < 0) k = 0; else if (k >= lut.length) k = lut.length - 1;
          var o = destino + c * 4;
          d[o] = d[o + 1] = d[o + 2] = lut[k];
          d[o + 3] = 255;
        }
      }
      cx.putImageData(img, 0, 0);

      // A grade é anisotrópica: o corte tem `incrementoMm` e o pixel no plano
      // tem `pixelMm`. Sem corrigir a proporção, um crânio de 158 mm com
      // cortes de 5 mm apareceria achatado a um sexto da altura real.
      var larguraMm = n * s.pixelMm;
      var alturaMm = nz * s.incrementoMm;
      var saida = document.createElement("canvas");
      saida.width = n;
      saida.height = Math.max(1, Math.round(n * alturaMm / larguraMm));
      var sc = saida.getContext("2d");
      sc.imageSmoothingEnabled = true;
      sc.drawImage(cru, 0, 0, n, nz, 0, 0, saida.width, saida.height);

      var url = saida.toDataURL();
      cache[chave] = url;
      return url;
    },

    /** Estatística de HU numa janela quadrada do corte — HU REAIS. */
    estatistica: function (i, cx, cy, lado) {
      var s = Motor.serieAtual();
      if (!s) return null;
      var n = s.matriz;
      var fatia = s.hu.subarray(i * n * n, (i + 1) * n * n);
      return window.SimTCCore.scan.desvioEmROI(fatia, n, cx, cy, lado || 11);
    },

    limpar: function () {
      estado.series = []; estado.atual = 0; estado.bruto = null;
      estado.dose = null; estado.aec = null;
      cache = Object.create(null);
    }
  };

  function finalizar() {
    if (worker) { try { worker.terminate(); } catch (e) {} worker = null; }
    emCurso = null;
  }

  window.SimTC = window.SimTC || {};
  SimTC.MotorImagem = Motor;

})();
