/**
 * js/fonte-volume.js
 * Origem das imagens do exame a partir dos volumes de TC REAIS.
 *
 * Implementa o mesmo contrato mínimo que `js/phantoms.js` já expunha —
 * `has / manifest / axial(i) / scout(kind)` — previsto desde o início para
 * receber uma origem DICOM sem tocar no resto do simulador. É essa troca.
 *
 * O que muda de verdade: as imagens deixam de ser PNG já janelados e passam a
 * ser geradas de um campo 3D de Hounsfield (core/phantom/volume.js). Isso
 * corrige de uma vez:
 *
 *   B-05  os HU exportados cobriam −160..+223 e mentiam `unidadeHU: true`;
 *   B-06  janelas de pulmão e osso não tinham dado que as sustentasse;
 *   B-07  o "volume" era uma pilha de cortes quase idênticos, sem anatomia
 *         no eixo Z — coronal e sagital saíam como borrão;
 *   B-17  qualquer região que não fosse Tórax exibia um crânio, em silêncio.
 *
 * E o topograma deixa de ser uma figura pronta: passa a ser uma PROJEÇÃO do
 * volume (integral da atenuação ao longo do raio), como um scout real.
 *
 * Depende de: core/phantom/volume.js, core/phantom/acervo.js
 * Script clássico.
 */
(function () {
  "use strict";

  var Core = window.SimTCCore;
  if (!Core || !Core.Acervo) return;

  var cacheAxial = Object.create(null);   // "id:i:wl:ww" -> dataURL
  var cacheScout = Object.create(null);   // "id:orient"  -> dataURL
  var cacheLimites = Object.create(null); // "id:orient"  -> limites anatômicos
  var carregados = Object.create(null);   // id -> Volume

  function pintar(w, h, cinza) {
    var cvs = document.createElement("canvas");
    cvs.width = w; cvs.height = h;
    var ctx = cvs.getContext("2d");
    var img = ctx.createImageData(w, h);
    var d = img.data;
    for (var i = 0, o = 0; i < cinza.length; i++, o += 4) {
      d[o] = d[o + 1] = d[o + 2] = cinza[i];
      d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cvs;
  }

  /**
   * O scout sai com o eixo crânio-caudal na horizontal e proporção física
   * (mm por pixel difere entre os eixos). Reescala para pixels quadrados,
   * senão o topograma aparece esticado e o planejamento da faixa erra.
   */
  /**
   * Volume.scout() devolve sempre o eixo crânio-caudal na HORIZONTAL. A tela,
   * porém, trata o scout frontal com o eixo CC na VERTICAL (cabeça em cima),
   * que é como se vê um topograma AP. Sem transpor, o planejamento da faixa
   * mediria o eixo errado.
   */
  function transpor(proj) {
    var w = proj.w, h = proj.h;
    var out = new Uint8ClampedArray(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) out[x * h + (h - 1 - y)] = proj.cinza[y * w + x];
    }
    return { w: h, h: w, cinza: out, mmPorPixel: [proj.mmPorPixel[1], proj.mmPorPixel[0]] };
  }

  /**
   * Inverte o eixo crânio-caudal da projeção.
   *
   * Core.Volume.scout monta a imagem com a largura sendo o índice z do volume,
   * e z cresce para SUPERIOR (convenção LPS). Sem inverter, o topograma sai com
   * os pés primeiro: no lateral a base do crânio ficava à esquerda e o vértice
   * à direita; no frontal, depois de transpor, a bacia ficava EM CIMA e os
   * pulmões embaixo — o paciente de cabeça para baixo.
   *
   * O comentário das caixas de planejamento em js/aquisicao.js sempre descreveu
   * a convenção certa ("vértice à esquerda", "crânio em cima"); era o desenho
   * que discordava. Invertendo aqui, as zonas-alvo didáticas voltam a apontar
   * para a anatomia que nomeiam.
   *
   * Quem lê fração do topograma tem de aplicar a MESMA inversão para chegar ao
   * milímetro do volume — é o que fazem limitesAnatomicos e fracaoCCparaMm.
   */
  function inverterCC(proj) {
    var w = proj.w, h = proj.h;
    var out = new Uint8ClampedArray(w * h);
    for (var y = 0; y < h; y++) {
      var base = y * w;
      for (var x = 0; x < w; x++) out[base + (w - 1 - x)] = proj.cinza[base + x];
    }
    return { w: w, h: h, cinza: out, mmPorPixel: proj.mmPorPixel };
  }

  function pintarProporcional(proj) {
    var base = pintar(proj.w, proj.h, proj.cinza);
    var mmX = proj.mmPorPixel[0], mmY = proj.mmPorPixel[1];
    var larguraMm = proj.w * mmX, alturaMm = proj.h * mmY;
    var escala = 900 / Math.max(larguraMm, alturaMm);   // ~900 px no maior lado
    var w2 = Math.max(2, Math.round(larguraMm * escala));
    var h2 = Math.max(2, Math.round(alturaMm * escala));
    var out = document.createElement("canvas");
    out.width = w2; out.height = h2;
    var c = out.getContext("2d");
    c.imageSmoothingEnabled = true;
    c.drawImage(base, 0, 0, proj.w, proj.h, 0, 0, w2, h2);
    return out.toDataURL();
  }

  function idDaRegiao(regiao) {
    return Core.Acervo.volumeDaRegiao(regiao);
  }

  var Fonte = {
    /** A região tem volume no acervo? */
    has: function (regiao) {
      var id = idDaRegiao(regiao);
      return !!id && !!carregados[id];
    },

    /** Região reconhecida pelo acervo, mesmo que ainda não carregada. */
    cobre: function (regiao) { return !!idDaRegiao(regiao); },

    regioesCobertas: function () { return Core.Acervo.regioesCobertas(); },

    /**
     * Carrega o volume da região. O contrato de imagens é síncrono, então a
     * carga acontece uma vez, antes de a aquisição começar.
     * @returns {Promise<boolean>} false se a região não tem volume
     */
    preparar: function (regiao) {
      var id = idDaRegiao(regiao);
      if (!id) return Promise.resolve(false);
      if (carregados[id]) return Promise.resolve(true);
      return Core.Acervo.carregar(id).then(function (vol) {
        carregados[id] = vol;
        return true;
      });
    },

    volume: function (regiao) {
      var id = idDaRegiao(regiao);
      return id ? carregados[id] || null : null;
    },

    /** Manifesto no formato que a tela de aquisição já consome. */
    manifest: function (regiao) {
      var v = Fonte.volume(regiao);
      if (!v) return null;
      var m = v.manifest || {};
      return {
        id: v.id,
        nome: rotuloRegiao(regiao, v),
        modalidade: "CT",
        cortes: v.dims[2],
        largura: v.dims[0],
        altura: v.dims[1],
        espacamento_mm: { x: v.spacingMm[0], y: v.spacingMm[1], z: v.spacingMm[2] },
        janela_exibicao: { wl: v.janelaPadrao.wl, ww: v.janelaPadrao.ww },
        hu_min: m.hu_min, hu_max: m.hu_max,
        extensao_mm: m.extensao_mm || null,
        fonte: { nome: rotuloFonte(v.id), licenca: licencaDe(v.id) }
      };
    },

    /** Corte axial i, janelado. Devolve dataURL (interface antiga). */
    axial: function (regiao, i, janela) {
      var v = Fonte.volume(regiao);
      if (!v) return null;
      var j = janela || v.janelaPadrao;
      var chave = v.id + ":" + i + ":" + j.wl + ":" + j.ww;
      if (cacheAxial[chave]) return cacheAxial[chave];
      var f = v.fatiaAxial(i, j);
      var url = pintar(f.w, f.h, f.cinza).toDataURL();
      cacheAxial[chave] = url;
      return url;
    },

    /** Topograma por projeção real do volume. */
    scout: function (regiao, orientacao) {
      var v = Fonte.volume(regiao);
      if (!v) return null;
      var orient = orientacao === "frontal" ? "frontal" : "lateral";
      var chave = v.id + ":" + orient;
      if (cacheScout[chave]) return cacheScout[chave];
      // Superior primeiro: à esquerda no lateral, em cima no frontal.
      var proj = inverterCC(v.scout(orient));
      // No frontal, o eixo CC vai para a vertical.
      if (orient === "frontal") proj = transpor(proj);
      var url = pintarProporcional(proj);
      cacheScout[chave] = url;
      return url;
    },

    /**
     * Limites anatômicos no scout, em fração da imagem. Cacheado: varrer o
     * volume inteiro custa caro e o resultado não muda.
     */
    limitesAnatomicos: function (regiao, orientacao) {
      var v = Fonte.volume(regiao);
      if (!v) return null;
      var chave = v.id + ":" + (orientacao === "frontal" ? "frontal" : "lateral");
      if (!cacheLimites[chave]) {
        var l = v.limitesAnatomicos(orientacao);
        // O núcleo devolve frações do índice z (z cresce para superior); o
        // topograma exibe superior primeiro. Sem esta inversão, a validação
        // compararia a caixa desenhada com a anatomia do lado oposto.
        cacheLimites[chave] = {
          cc: [1 - l.cc[1], 1 - l.cc[0]],
          perp: l.perp
        };
      }
      return cacheLimites[chave];
    },

    /** Comprimento real do volume no eixo crânio-caudal, em mm. */
    comprimentoCCmm: function (regiao) {
      var v = Fonte.volume(regiao);
      return v ? v.dims[2] * v.spacingMm[2] : null;
    },

    /**
     * Converte fração do topograma no eixo crânio-caudal (0 = extremidade
     * SUPERIOR exibida) para milímetro no volume (0 = primeiro corte, que é o
     * INFERIOR). É a única conversão entre as duas convenções; quem precisar
     * de milímetros a partir da caixa de planejamento passa por aqui.
     */
    fracaoCCparaMm: function (regiao, fracao) {
      var L = Fonte.comprimentoCCmm(regiao);
      if (L == null) return null;
      return (1 - fracao) * L;
    },

    limparCache: function () {
      cacheAxial = Object.create(null);
      cacheScout = Object.create(null);
      cacheLimites = Object.create(null);
    }
  };

  var ROTULOS = {
    cranio: "Crânio", torax: "Tórax",
    tronco: "Tronco (tórax inferior, abdome, pelve, coluna lombar)"
  };
  var FONTES = {
    cranio: "TCIA · CPTAC-AML",
    torax: "TCIA · LIDC-IDRI",
    tronco: "TCIA · CPTAC-CCRCC"
  };
  var LICENCAS = {
    cranio: "CC BY 4.0 — DOI 10.7937/tcia.2019.b6foe619.",
    torax: "CC BY 3.0 — DOI 10.7937/K9/TCIA.2015.LO9QL9SX.",
    tronco: "CC BY 4.0 — DOI 10.7937/k9/tcia.2018.oblamn27."
  };
  function rotuloRegiao(regiao, v) { return ROTULOS[v.id] || regiao || v.id; }
  function rotuloFonte(id) { return FONTES[id] || "TCIA"; }
  function licencaDe(id) { return LICENCAS[id] || ""; }

  window.SimTC = window.SimTC || {};
  SimTC.FonteVolume = Fonte;

})();
