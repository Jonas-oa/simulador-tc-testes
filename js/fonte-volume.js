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

  /**
   * Recorta o eixo crânio-caudal da projeção a uma faixa em milímetros.
   *
   * O eixo CC é a LARGURA da projeção crua (Core.Volume.scout monta assim),
   * então recortar é ficar com um intervalo de colunas.
   */
  function recortarCC(proj, z0Mm, z1Mm) {
    var mmPorCol = proj.mmPorPixel[0];
    var c0 = Math.max(0, Math.floor(z0Mm / mmPorCol));
    var c1 = Math.min(proj.w, Math.ceil(z1Mm / mmPorCol));
    var w = Math.max(2, c1 - c0);
    var out = new Uint8ClampedArray(w * proj.h);
    for (var y = 0; y < proj.h; y++) {
      var de = y * proj.w + c0;
      var para = y * w;
      for (var x = 0; x < w; x++) out[para + x] = proj.cinza[de + x];
    }
    return { w: w, h: proj.h, cinza: out, mmPorPixel: proj.mmPorPixel };
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
        fonte: { nome: rotuloFonte(v), licenca: licencaDe(v) }
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

    /**
     * Trecho do volume que o TOPOGRAMA cobre, em mm a partir do corte
     * inferior.
     *
     * Um scout não varre o cadáver inteiro: cobre a região que vai ser
     * examinada, com folga para o operador enquadrar. Fazer o topograma varrer
     * todo o volume tinha uma consequência concreta e imediata — o volume de
     * tronco passou a 694 mm, e a mesa precisava desse curso ANTES de começar.
     * Num protocolo caudocranial, que retira a mesa enquanto varre, isso é
     * curso que não existe a partir do repouso: a aquisição recusava com
     * "faltam 695 mm" e o exame simplesmente não saía do lugar.
     *
     * A faixa vem do padrão da região (core/phantom/acervo.js) com 25% de
     * folga de cada lado, presa aos limites do volume. Sem padrão declarado,
     * cobre o volume todo — que é o comportamento certo para um volume feito
     * sob medida para uma região só.
     */
    faixaTopograma: function (regiao) {
      var v = Fonte.volume(regiao);
      if (!v) return null;
      var L = v.dims[2] * v.spacingMm[2];
      var fp = Core.Acervo.faixaPadrao(regiao);
      if (!fp) return { z0Mm: 0, z1Mm: L, comprimentoMm: L };
      var folga = (fp.fimMm - fp.inicioMm) * 0.25;
      var z0 = Math.max(0, fp.inicioMm - folga);
      var z1 = Math.min(L, fp.fimMm + folga);
      if (!(z1 - z0 > 20)) return { z0Mm: 0, z1Mm: L, comprimentoMm: L };
      return { z0Mm: z0, z1Mm: z1, comprimentoMm: z1 - z0 };
    },

    /** Topograma por projeção real do volume, limitado à faixa da região. */
    scout: function (regiao, orientacao) {
      var v = Fonte.volume(regiao);
      if (!v) return null;
      var orient = orientacao === "frontal" ? "frontal" : "lateral";
      var f = Fonte.faixaTopograma(regiao);
      var chave = v.id + ":" + orient + ":" + Math.round(f.z0Mm) + "-" + Math.round(f.z1Mm);
      if (cacheScout[chave]) return cacheScout[chave];
      // Recorta ANTES de inverter: na projeção crua o eixo CC ainda cresce com
      // o índice z, que é como a faixa está expressa.
      var proj = recortarCC(v.scout(orient), f.z0Mm, f.z1Mm);
      // Superior primeiro: à esquerda no lateral, em cima no frontal.
      proj = inverterCC(proj);
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
      var f = Fonte.faixaTopograma(regiao);
      var chave = v.id + ":" + (orientacao === "frontal" ? "frontal" : "lateral") +
                  ":" + Math.round(f.z0Mm) + "-" + Math.round(f.z1Mm);
      if (!cacheLimites[chave]) {
        var l = v.limitesAnatomicos(orientacao);
        var L = v.dims[2] * v.spacingMm[2];
        // O núcleo devolve frações do índice z sobre o VOLUME inteiro; o
        // topograma mostra só a faixa recortada, e com o superior primeiro.
        // As duas conversões têm de andar juntas: sem a inversão a validação
        // compara a caixa com a anatomia do lado oposto; sem o reenquadramento
        // na faixa, compara com uma escala que não é a da imagem exibida.
        var aMm = l.cc[0] * L, bMm = l.cc[1] * L;
        var comp = f.comprimentoMm;
        var fa = (f.z1Mm - bMm) / comp;   // topo da imagem = z1
        var fb = (f.z1Mm - aMm) / comp;
        cacheLimites[chave] = {
          cc: [Math.max(0, Math.min(1, fa)), Math.max(0, Math.min(1, fb))],
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

    /** Comprimento que o TOPOGRAMA cobre — é o curso que a mesa percorre. */
    comprimentoTopogramaMm: function (regiao) {
      var f = Fonte.faixaTopograma(regiao);
      return f ? f.comprimentoMm : null;
    },

    /**
     * Converte fração do topograma no eixo crânio-caudal (0 = extremidade
     * SUPERIOR exibida) para milímetro no VOLUME (0 = primeiro corte, que é o
     * INFERIOR). É a única conversão entre as duas convenções, e leva em conta
     * que o topograma mostra apenas a faixa da região.
     */
    fracaoCCparaMm: function (regiao, fracao) {
      var f = Fonte.faixaTopograma(regiao);
      if (!f) return null;
      return f.z1Mm - fracao * f.comprimentoMm;
    },

    /**
     * Inversa exata de fracaoCCparaMm: milímetro no VOLUME -> fração do
     * topograma. Existe como par declarado porque quem semeia a caixa de
     * planejamento precisa ir nesta direção, e fazer a conta "na mão" no outro
     * arquivo foi exatamente o que quebrou: dividir um milímetro do volume
     * pelo comprimento do topograma mistura dois referenciais e encolheu uma
     * faixa de 66% para 15%.
     */
    mmParaFracaoCC: function (regiao, mm) {
      var f = Fonte.faixaTopograma(regiao);
      if (!f || !(f.comprimentoMm > 0)) return null;
      return (f.z1Mm - mm) / f.comprimentoMm;
    },

    limparCache: function () {
      cacheAxial = Object.create(null);
      cacheScout = Object.create(null);
      cacheLimites = Object.create(null);
    }
  };

  // Procedência vem do MANIFESTO do volume, não de uma tabela paralela aqui.
  // A tabela existia e ficou desatualizada quando os volumes foram trocados: a
  // legenda passou a creditar CPTAC-CCRCC para um volume do TotalSegmentator.
  // Em dado CC BY isso não é um texto velho, é descumprimento da licença — a
  // atribuição é a única condição que a licença impõe. Mantendo o crédito ao
  // lado do dado que ele descreve, trocar um implica trocar o outro.
  var CREDITO_RESERVA = {
    rotulo: "", fonte: "origem não declarada no manifesto",
    licenca: "", doi: "", sujeito: null
  };
  function creditoDe(v) {
    return (v && v.manifest && v.manifest.credito) || CREDITO_RESERVA;
  }
  function rotuloRegiao(regiao, v) {
    return creditoDe(v).rotulo || regiao || (v && v.id) || "";
  }
  function rotuloFonte(v) {
    var c = creditoDe(v);
    return c.fonte + (c.sujeito ? " · sujeito " + c.sujeito : "");
  }
  function licencaDe(v) {
    var c = creditoDe(v);
    if (!c.licenca) return "";
    return c.licenca + (c.doi ? " — DOI " + c.doi + "." : ".");
  }

  window.SimTC = window.SimTC || {};
  SimTC.FonteVolume = Fonte;

})();
