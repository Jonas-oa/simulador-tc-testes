/**
 * js/worker-aquisicao.js
 * Executa a aquisição e a reconstrução FORA da thread da interface.
 *
 * Projetar e retroprojetar custa centenas de milhões de operações por exame.
 * Feito na thread principal, o navegador congela: a sala 3D para, os botões
 * não respondem e o Windows oferece "encerrar a página". Aqui o cálculo roda
 * num Worker e a interface só recebe progresso.
 *
 * O Worker carrega o volume por conta própria (mesma origem), em vez de
 * recebê-lo por transferência: assim a thread principal não perde o volume
 * que usa para desenhar o topograma.
 */
/* eslint-env worker */
"use strict";

importScripts(
  "../core/bus.js",
  "../core/clock.js",
  "../core/model/patient.js",
  "../core/model/protocol.js",
  "../core/model/exam.js",
  "../core/state.js",
  "../core/phantom/volume.js",
  "../core/phantom/acervo.js",
  "../core/acquisition/fisica.js",
  "../core/acquisition/noise.js",
  "../core/acquisition/projector.js",
  "../core/acquisition/scan.js",
  "../core/recon/serie.js"
);

var C = self.SimTCCore;

// O acervo resolve caminhos relativos à raiz do projeto; dentro de js/ é
// preciso subir um nível.
var fetchOriginal = self.fetch;
self.fetch = function (url, opts) {
  if (typeof url === "string" && url.indexOf("assets/") === 0) url = "../" + url;
  return fetchOriginal.call(self, url, opts);
};

function responder(msg, transferiveis) {
  self.postMessage(msg, transferiveis || []);
}

self.onmessage = function (ev) {
  var m = ev.data || {};
  if (m.tipo !== "executar") return;

  C.Acervo.carregar(m.regiaoId).then(function (vol) {
    var q = m.qualidade || {};

    // ---- IRRADIAÇÃO (uma vez) ----
    responder({ tipo: "etapa", etapa: "irradiando", feito: 0, total: 1 });
    var bruto = C.recon.adquirirBruto({
      volume: vol,
      plano: m.plano,
      aquisicao: m.aquisicao,
      linhaMm: q.linhaMm,
      vistas: q.vistas || 120,
      detectores: q.detectores || 160,
      semente: m.semente || 1,
      aoProgresso: function (feito, total) {
        responder({ tipo: "etapa", etapa: "irradiando", feito: feito, total: total });
      }
    });

    // ---- RECONSTRUÇÃO (N séries do mesmo bruto) ----
    var series = [];
    for (var i = 0; i < m.reconstrucoes.length; i++) {
      var rec = m.reconstrucoes[i];
      var s = C.recon.reconstruirSerie(bruto, rec, function (feito, total) {
        responder({
          tipo: "etapa", etapa: "reconstruindo", serie: rec.nome,
          indiceSerie: i, totalSeries: m.reconstrucoes.length,
          feito: feito, total: total
        });
      });

      // Empacota os cortes num único buffer, para transferir de uma vez.
      var n = s.matriz, nz = s.cortes.length;
      var pacote = new Int16Array(n * n * nz);
      for (var z = 0; z < nz; z++) pacote.set(s.cortes[z].hu, z * n * n);

      series.push({
        nome: s.nome, espessuraMm: s.espessuraMm, incrementoMm: s.incrementoMm,
        kernel: s.kernel, fovMm: s.fovMm, matriz: s.matriz, pixelMm: s.pixelMm,
        posicoesMm: s.posicoesMm, origem: s.origem,
        cortes: nz, dados: pacote
      });
    }

    responder({
      tipo: "pronto",
      series: series,
      bruto: {
        linhas: bruto.linhas.length, linhaMm: bruto.linhaMm,
        comprimentoMm: bruto.comprimentoMm, n0PorLinha: bruto.n0PorLinha,
        vistas: bruto.vistas, detectores: bruto.detectores
      }
    }, series.map(function (s) { return s.dados.buffer; }));

  }).catch(function (e) {
    responder({ tipo: "erro", mensagem: (e && e.message) || String(e) });
  });
};
