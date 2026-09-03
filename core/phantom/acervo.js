/**
 * core/phantom/acervo.js
 * Carrega os volumes de TC reais de assets/volumes/<regiao>/.
 *
 * Formato gravado por ferramentas/dicom_para_volume.py:
 *   manifest.json    dims, espacamento_mm, origem_mm, hu_min/max, fonte
 *   volume.i16.gz    Int16 bruto em HU, ordem z,y,x, comprimido com gzip
 *
 * A descompressão usa DecompressionStream, disponível em Chrome 80+,
 * Firefox 113+ e Safari 16.4+. Sem ela o navegador é antigo demais para o
 * resto da plataforma também — o erro diz isso em vez de falhar em silêncio.
 *
 * SEM dependência de DOM (usa apenas fetch, que existe em Worker também).
 * Script clássico.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};

  var BASE = "assets/volumes/";

  // Regiões anatômicas -> volume que as contém. Corrige B-17: antes, tudo que
  // não fosse Tórax caía num crânio, sem aviso. Aqui, região sem volume é
  // dito explicitamente, e várias regiões podem compartilhar um volume mais
  // amplo (o tronco cobre tórax inferior, abdome, pelve e coluna lombar).
  var MAPA_REGIAO = {
    "Crânio": "cranio",
    "Cranio": "cranio",
    "Pescoço": null,
    "Pescoco": null,
    "Tórax": "torax",
    "Torax": "torax",
    "Abdome": "tronco",
    "Pelve": "tronco",
    "Coluna": "tronco",
    "Membros": null
  };

  /**
   * Faixa de varredura PADRÃO por região, em milímetros medidos a partir da
   * extremidade INFERIOR do volume (o corte de índice 0).
   *
   * Existe porque, sem ela, a caixa de planejamento começava sempre na mesma
   * fração do topograma, qualquer que fosse a região. No volume de tronco isso
   * fazia "Abdome" e "Coluna" produzirem exatamente o mesmo exame — o aluno
   * escolhia protocolos diferentes e recebia as mesmas imagens.
   *
   * Os números vêm de marcos medidos em cada volume, não de estimativa. Para o
   * tronco (694 mm, sujeito s0476):
   *
   *     pico ósseo da bacia   75 mm
   *     crista ilíaca        225 mm
   *     base pulmonar        399 mm
   *     ápice pulmonar       652 mm
   *
   * Para o tórax da LIDC (326 mm): pulmão de 60 a 262 mm.
   *
   * É PADRÃO, não trava: o operador arrasta as linhas e muda o que quiser. O
   * ponto é partir de um enquadramento que corresponde ao exame pedido.
   */
  var FAIXA_PADRAO = {
    cranio: { "Crânio": [8, 182], "Cranio": [8, 182] },
    torax:  { "Tórax": [45, 285], "Torax": [45, 285] },
    tronco: {
      "Tórax":  [380, 670],   // base do diafragma ao ápice pulmonar
      "Torax":  [380, 670],
      "Abdome": [230, 430],   // crista ilíaca à cúpula diafragmática
      "Pelve":  [20, 250],    // abaixo dos fêmures proximais à crista ilíaca
      "Coluna": [150, 440]    // sacro a T12
    }
  };

  var cache = Object.create(null);
  var emVoo = Object.create(null);

  function urlDe(regiao, arquivo) {
    return BASE + regiao + "/" + arquivo;
  }

  function descomprimir(buffer) {
    if (typeof raiz.DecompressionStream !== "function") {
      return Promise.reject(new Error(
        "Este navegador não suporta DecompressionStream — necessário para ler os volumes de TC."));
    }
    var ds = new raiz.DecompressionStream("gzip");
    var fluxo = new raiz.Response(buffer).body.pipeThrough(ds);
    return new raiz.Response(fluxo).arrayBuffer();
  }

  /**
   * Carrega o volume de uma região do acervo. O resultado é cacheado: os
   * volumes chegam a 15 MB e recarregar a cada exame seria desperdício.
   * @returns {Promise<Volume>}
   */
  function carregar(id) {
    if (cache[id]) return Promise.resolve(cache[id]);
    if (emVoo[id]) return emVoo[id];

    var p = fetch(urlDe(id, "manifest.json"), { cache: "force-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("manifest de \"" + id + "\" indisponível (HTTP " + r.status + ")");
        return r.json();
      })
      .then(function (m) {
        return fetch(urlDe(id, "volume.i16.gz"), { cache: "force-cache" })
          .then(function (r) {
            if (!r.ok) throw new Error("volume de \"" + id + "\" indisponível (HTTP " + r.status + ")");
            return r.arrayBuffer();
          })
          .then(descomprimir)
          .then(function (buf) {
            var esp = m.espacamento_mm;
            var vol = new Core.Volume({
              dados: new Int16Array(buf),
              dims: m.dims,
              spacingMm: [esp.x, esp.y, esp.z],
              originMm: m.origem_mm || [0, 0, 0],
              id: id,
              rotulo: m.id || id,
              janelaPadrao: {
                wl: (m.janela_exibicao && m.janela_exibicao.wl) || 40,
                ww: (m.janela_exibicao && m.janela_exibicao.ww) || 400
              },
              fonte: m.aquisicao_original || null
            });

            // O manifesto declara a extensão física; conferir aqui impede que
            // uma troca de asset reintroduza o erro de escala do B-04.
            if (m.extensao_mm) {
              vol.verificarEscala([m.extensao_mm.x, m.extensao_mm.y, m.extensao_mm.z]);
            }
            // E que o volume esteja mesmo em HU, não em cinza janelado (B-05).
            if (m.hu_min > -900 || m.hu_max < 700) {
              throw new Error("Volume \"" + id + "\" não está em HU reais (faixa " +
                m.hu_min + ".." + m.hu_max + ") — esperado ar ≤ −900 e osso ≥ +700.");
            }
            vol.manifest = m;
            cache[id] = vol;
            delete emVoo[id];
            return vol;
          });
      })
      .catch(function (e) { delete emVoo[id]; throw e; });

    emVoo[id] = p;
    return p;
  }

  /** Volume que cobre a região anatômica, ou null se o acervo não a tem. */
  function volumeDaRegiao(regiao) {
    if (!regiao) return null;
    var id = MAPA_REGIAO[regiao];
    return id === undefined ? null : id;
  }

  /**
   * Faixa padrão da região, em mm a partir do corte 0 (inferior) do volume que
   * a cobre. Devolve null quando não há padrão declarado — nesse caso a
   * interface mantém a caixa onde estava, em vez de inventar um enquadramento.
   */
  function faixaPadrao(regiao) {
    var id = volumeDaRegiao(regiao);
    if (!id) return null;
    var porRegiao = FAIXA_PADRAO[id];
    var f = porRegiao && porRegiao[regiao];
    if (!f) return null;
    return { inicioMm: f[0], fimMm: f[1] };
  }

  function regioesCobertas() {
    var out = [];
    for (var r in MAPA_REGIAO) {
      if (MAPA_REGIAO[r]) out.push(r);
    }
    return out;
  }

  Core.Acervo = {
    carregar: carregar,
    volumeDaRegiao: volumeDaRegiao,
    faixaPadrao: faixaPadrao,
    regioesCobertas: regioesCobertas,
    MAPA_REGIAO: MAPA_REGIAO,
    FAIXA_PADRAO: FAIXA_PADRAO,
    emCache: function (id) { return !!cache[id]; }
  };

})(typeof self !== "undefined" ? self : this);
