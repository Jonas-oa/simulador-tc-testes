/**
 * core/model/protocol.js
 * Protocolo de aquisição — modelo TIPADO.
 *
 * Corrige a raiz de B-15: hoje todo campo do protocolo é texto livre, e a
 * aquisição extrai números por expressão regular ("≈55 mGy (ref.)" → 55).
 * Isso torna impossível validar, comparar ou versionar protocolos, e é o que
 * permite salvar um protocolo com pitch em modo sequencial.
 *
 * Aqui o protocolo vira objeto com unidades no nome do campo e números de
 * verdade. `normalizar()` aceita tanto o formato antigo (strings) quanto o
 * novo, para que a migração seja transparente.
 *
 * O motor de validação completo é a Fase 9; aqui ficam apenas a forma
 * canônica e as coerções.
 *
 * SEM dependência de DOM. Script clássico.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};
  Core.model = Core.model || {};

  var MODOS = ["helicoidal", "sequencial", "volumetrico"];
  var DIRECOES = ["caudocranial", "craniocaudal"];
  var SCOUTS = ["lateral", "frontal"];
  var KERNELS = ["liso", "padrao", "nitido"];

  /**
   * Extrai o primeiro número de uma string tolerante a formato brasileiro e a
   * texto solto: "1,2" → 1.2 · "64 × 0,6 mm" → 64 · "≈55 mGy (ref.)" → 55.
   * Devolve null quando não há número — nunca NaN, que se propaga em silêncio.
   */
  function num(v) {
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (v == null) return null;
    var m = String(v).replace(/,/g, ".").match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  function naFaixa(n, min, max, padrao) {
    if (n == null) return padrao;
    if (n < min || n > max) return padrao;
    return n;
  }

  function umDe(v, lista, padrao) {
    var s = v == null ? "" : String(v).trim().toLowerCase();
    return lista.indexOf(s) >= 0 ? s : padrao;
  }

  /**
   * Colimação: aceita "64 × 0,6 mm" (n detectores × largura) e "40 mm"
   * (largura total). Devolve sempre a forma estruturada MAIS a largura total
   * em mm, que é o que a física consome (v_mesa = pitch × colimação / t_rot).
   */
  function normalizarColimacao(v) {
    if (v && typeof v === "object" && v.larguraMm != null) {
      var n1 = naFaixa(num(v.nDetectores), 1, 1024, 1);
      var l1 = naFaixa(num(v.larguraMm), 0.1, 80, 0.6);
      return { nDetectores: n1, larguraMm: l1, totalMm: n1 * l1 };
    }
    var ms = v == null ? null : String(v).replace(/,/g, ".").match(/\d+(\.\d+)?/g);
    if (!ms || !ms.length) return { nDetectores: 64, larguraMm: 0.6, totalMm: 38.4 };
    if (ms.length >= 2) {
      var n = parseFloat(ms[0]), l = parseFloat(ms[1]);
      return { nDetectores: n, larguraMm: l, totalMm: n * l };
    }
    var total = parseFloat(ms[0]);
    return { nDetectores: 1, larguraMm: total, totalMm: total };
  }

  /** Mapeia nomes didáticos de kernel usados no acervo antigo. */
  function normalizarKernel(v) {
    var s = (v == null ? "" : String(v)).toLowerCase();
    if (!s) return "padrao";
    if (/osso|nitid|sharp|bone|ultra/.test(s)) return "nitido";
    if (/mole|liso|smooth|soft|encéf|encef|cereb|brain/.test(s)) return "liso";
    return umDe(s, KERNELS, "padrao");
  }

  /**
   * Forma canônica do protocolo. Aceita o objeto legado (campos kv, mas,
   * pitch, colimacao, espessura… como string) e devolve o modelo tipado.
   * NÃO inventa valor clínico: campo ausente vira null e a interface deve
   * dizer que falta, em vez de assumir um número.
   */
  function normalizarProtocolo(cru) {
    cru = cru || {};
    var aq = cru.aquisicao || cru;
    var modo = umDe(aq.modo, MODOS, "helicoidal");
    var colim = normalizarColimacao(aq.colimacao);

    var recons = Array.isArray(cru.reconstrucoes) ? cru.reconstrucoes : null;
    if (!recons) {
      // Legado: um único conjunto de parâmetros de reconstrução solto.
      var esp = num(cru.espessura);
      recons = [{
        nome: "Padrão",
        espessuraMm: naFaixa(esp, 0.4, 20, null),
        incrementoMm: naFaixa(num(cru.incremento) != null ? num(cru.incremento) : esp, 0.1, 20, null),
        kernel: normalizarKernel(cru.kernel),
        fovMm: naFaixa(num(cru.fov), 50, 700, null),
        matriz: naFaixa(num(cru.matriz), 128, 1024, 512),
        algoritmo: "FBP"
      }];
    }

    return {
      id: cru.id || ("prot_" + Date.now()),
      versao: naFaixa(num(cru.versao), 1, 9999, 1),
      nome: cru.nome == null ? "" : String(cru.nome).trim(),
      regiao: cru.regiao == null ? "" : String(cru.regiao).trim(),
      indicacao: cru.indicacao == null ? "" : String(cru.indicacao).trim(),
      bloqueado: !!cru.bloqueado,

      scout: {
        orientacao: umDe((cru.scout && cru.scout.orientacao) || cru.scout, SCOUTS, "lateral"),
        comprimentoMm: naFaixa(num(cru.scout && cru.scout.comprimentoMm), 50, 2000, 300),
        kv: naFaixa(num(cru.scout && cru.scout.kv), 70, 150, 120),
        mas: naFaixa(num(cru.scout && cru.scout.mas), 1, 1000, 35)
      },

      aquisicao: {
        modo: modo,
        kv: naFaixa(num(aq.kv), 70, 150, null),
        mas: naFaixa(num(aq.mas), 1, 2000, null),
        tempoRotacaoS: naFaixa(num(aq.tempoRotacaoS != null ? aq.tempoRotacaoS : aq.rotacao), 0.2, 3, 1.0),
        // Pitch não se aplica ao sequencial — manter null evita o erro
        // clássico de "pitch em step-and-shoot".
        pitch: modo === "sequencial" ? null : naFaixa(num(aq.pitch), 0.1, 3, 1.0),
        colimacao: colim,
        direcao: umDe(aq.direcao, DIRECOES, "caudocranial"),
        tiltGantryDeg: naFaixa(num(aq.tiltGantryDeg != null ? aq.tiltGantryDeg : aq.tilt), -30, 30, 0)
      },

      dose: {
        aec: (cru.dose && cru.dose.aec) || { ativo: false, estrategia: "ruidoAlvo", valorAlvo: null },
        // CALCULADOS na Fase 6 — nunca digitados. O valor legado em texto
        // ("≈55 mGy (ref.)") é preservado só como referência histórica.
        ctdivolEstimado: null,
        dlpEstimado: null,
        ctdivolLegado: num(cru.dose)
      },

      reconstrucoes: recons.map(function (r) {
        return {
          nome: r.nome || "Série",
          espessuraMm: naFaixa(num(r.espessuraMm), 0.4, 20, null),
          incrementoMm: naFaixa(num(r.incrementoMm), 0.1, 20, null),
          kernel: normalizarKernel(r.kernel),
          fovMm: naFaixa(num(r.fovMm), 50, 700, null),
          matriz: naFaixa(num(r.matriz), 128, 1024, 512),
          algoritmo: r.algoritmo || "FBP"
        };
      }),

      contraste: cru.contraste || null,
      obs: cru.obs == null ? "" : String(cru.obs)
    };
  }

  /**
   * Velocidade da mesa no helicoidal, em mm/s.
   *   v = pitch × colimação_total / tempo_de_rotação      [definição]
   * No sequencial não há avanço contínuo — devolve 0.
   */
  function velocidadeMesaMmS(p) {
    var aq = p && p.aquisicao;
    if (!aq || aq.modo === "sequencial") return 0;
    var pitch = aq.pitch || 1;
    var colim = (aq.colimacao && aq.colimacao.totalMm) || 0;
    var rot = aq.tempoRotacaoS || 1;
    return (pitch * colim) / rot;
  }

  /**
   * mAs efetivo = mAs / pitch.  [definição, AAPM]
   * É esta grandeza — não o mAs nominal — que governa o ruído da imagem.
   */
  function masEfetivo(p) {
    var aq = p && p.aquisicao;
    if (!aq || aq.mas == null) return null;
    if (aq.modo === "sequencial" || !aq.pitch) return aq.mas;
    return aq.mas / aq.pitch;
  }

  Core.model.normalizarProtocolo = normalizarProtocolo;
  Core.model.normalizarColimacao = normalizarColimacao;
  Core.model.velocidadeMesaMmS = velocidadeMesaMmS;
  Core.model.masEfetivo = masEfetivo;
  Core.model.PROTOCOLO_MODOS = MODOS;
  Core.model.PROTOCOLO_DIRECOES = DIRECOES;
  Core.model.PROTOCOLO_KERNELS = KERNELS;

})(typeof self !== "undefined" ? self : this);
