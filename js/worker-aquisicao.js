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

// A revisao de cache vem na URL do proprio Worker (js/motor-imagem.js a poe
// ali). Republicar aqui deixa o acervo versionar as URLs do volume tambem
// dentro do Worker — senao ele buscaria o manifesto sem versao e poderia ler
// do cache uma procedencia que nao corresponde ao volume carregado.
try {
  var _rev = (self.location.search || "").replace(/^\?/, "");
  var _m = /(?:^|&)v=([0-9a-z]+)/.exec(_rev);
  if (_m) self.__SIMTC_REV__ = _m[1];
} catch (e) { /* sem location: segue sem versao */ }

// Os proprios modulos do nucleo levam a revisao: sem ela o Worker tem cache
// separado do da pagina e pode rodar uma versao do core diferente da que a
// interface carregou — o tipo de divergencia que nao da erro, so resultado
// errado.
var _v = self.__SIMTC_REV__ ? "?v=" + self.__SIMTC_REV__ : "";
importScripts.apply(self, [
  "../core/bus.js" + _v,
  "../core/clock.js" + _v,
  "../core/model/patient.js" + _v,
  "../core/model/protocol.js" + _v,
  "../core/model/exam.js" + _v,
  "../core/state.js" + _v,
  "../core/phantom/volume.js" + _v,
  "../core/phantom/acervo.js" + _v,
  "../core/acquisition/fisica.js" + _v,
  "../core/acquisition/noise.js" + _v,
  "../core/acquisition/projector.js" + _v,
  "../core/acquisition/scan.js" + _v,
  "../core/dose/ctdi.js" + _v,
  "../core/dose/aec.js" + _v,
  "../core/recon/serie.js" + _v
]);

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

    // ---- AEC ----
    // A modulacao sai da atenuacao medida no proprio volume, como o
    // equipamento real faz a partir do topograma.
    var modulacao = null;
    if (m.aec && m.aec.ativo && m.aquisicao.mas > 0) {
      var perfil = C.aec.perfilAtenuacao(vol, m.plano.inicioMm, m.plano.fimMm,
                                         (q.linhaMm || vol.spacingMm[2]), m.aquisicao.kv);
      modulacao = C.aec.modularLongitudinal(perfil, {
        masReferencia: m.aquisicao.mas,
        alfa: m.aec.alfa == null ? 0.6 : m.aec.alfa
      });
    }

    // ---- IRRADIAÇÃO (uma vez) ----
    responder({ tipo: "etapa", etapa: "irradiando", feito: 0, total: 1 });
    var bruto = C.recon.adquirirBruto({
      modulacaoAEC: modulacao,
      volume: vol,
      plano: m.plano,
      aquisicao: m.aquisicao,
      linhaMm: q.linhaMm,
      vistas: q.vistas || 120,
      // resolucao (nao "detectores"): reduzir canais recortaria o campo e
      // produziria truncamento.
      resolucao: q.resolucao || 128,
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
      },
      // Dose CALCULADA — nao digitada. O diametro efetivo sai do proprio
      // volume, no meio da faixa varrida.
      dose: C.dose.relatorio({
        kv: m.aquisicao.kv,
        mas: modulacao ? modulacao.masMedio : m.aquisicao.mas,
        pitch: m.aquisicao.pitch, modo: m.aquisicao.modo,
        regiao: m.regiao,
        comprimentoMm: bruto.comprimentoMm,
        diametroEfetivoMm: C.dose.diametroEfetivoMm(vol, (m.plano.inicioMm + m.plano.fimMm) / 2)
      }),
      aec: modulacao ? {
        masMedio: modulacao.masMedio, razaoDose: modulacao.razaoDose,
        masMin: Math.min.apply(null, modulacao.mas),
        masMax: Math.max.apply(null, modulacao.mas),
        alfa: modulacao.alfa, explicacao: C.aec.explicar(modulacao)
      } : null
    }, series.map(function (s) { return s.dados.buffer; }));

  }).catch(function (e) {
    responder({ tipo: "erro", mensagem: (e && e.message) || String(e) });
  });
};
