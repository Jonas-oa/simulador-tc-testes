/**
 * core/protocol/validacao.js
 * Motor de validação de protocolos — independente da interface.
 *
 * Roda sobre o OBJETO, não sobre a tela. Isso importa por dois motivos: pode
 * ser testado sem navegador, e o mesmo protocolo importado de fora passa pelas
 * mesmas regras que o digitado no editor.
 *
 * TRÊS NÍVEIS, e a distinção entre eles é deliberada:
 *
 *   ERRO    o protocolo não pode ser executado como está. Não é opinião: é
 *           incoerência interna (pitch em step-and-shoot) ou impossibilidade
 *           física (FOV menor que o paciente).
 *   AVISO   tecnicamente executável, mas provavelmente não é o que se quer.
 *           O sistema NÃO bloqueia — mostra a consequência e deixa executar.
 *   INFO    observação didática.
 *
 * A escolha de não bloquear no AVISO é pedagógica: o aluno aprende mais
 * executando um protocolo ruim e vendo o resultado do que sendo impedido.
 *
 * SEM dependência de DOM. Script clássico.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};

  var ERRO = "erro", AVISO = "aviso", INFO = "info";

  function achado(nivel, codigo, campo, texto, consequencia) {
    return {
      nivel: nivel, codigo: codigo, campo: campo || null,
      texto: texto, consequencia: consequencia || null
    };
  }

  /**
   * Valida um protocolo já normalizado.
   *
   * @param {object} p        protocolo (Core.model.normalizarProtocolo)
   * @param {object} [ctx]    contexto do exame, quando houver:
   *        { larguraPacienteMm, comprimentoFaixaMm, extensaoVolumeMm, regiao }
   * @returns {{erros:Array, avisos:Array, infos:Array, podeExecutar:boolean}}
   */
  function validar(p, ctx) {
    ctx = ctx || {};
    var out = [];
    var aq = p.aquisicao || {};
    var recs = p.reconstrucoes || [];

    // ---- ERROS: incoerência interna ou impossibilidade ------------------

    if (aq.modo === "sequencial" && aq.pitch != null) {
      out.push(achado(ERRO, "PITCH_EM_SEQUENCIAL", "aquisicao.pitch",
        "Pitch definido em modo axial sequencial.",
        "No step-and-shoot a mesa fica parada durante a rotação: não há avanço por rotação, logo pitch não é definido."));
    }

    if (aq.modo !== "sequencial" && (aq.pitch == null || !(aq.pitch > 0))) {
      out.push(achado(ERRO, "PITCH_AUSENTE", "aquisicao.pitch",
        "Modo helicoidal sem pitch definido.",
        "Sem pitch não há como calcular a velocidade da mesa nem o mAs efetivo."));
    }

    if (aq.kv == null) {
      out.push(achado(ERRO, "KV_AUSENTE", "aquisicao.kv",
        "Tensão do tubo (kV) não definida.",
        "Sem kV não há espectro: nem a atenuação nem a dose podem ser calculadas."));
    }
    if (aq.mas == null) {
      out.push(achado(ERRO, "MAS_AUSENTE", "aquisicao.mas",
        "Produto corrente-tempo (mAs) não definido.",
        "Sem mAs não há fluência de fótons: a imagem não tem ruído definido nem a dose valor."));
    }

    if (!recs.length) {
      out.push(achado(ERRO, "SEM_RECONSTRUCAO", "reconstrucoes",
        "Aquisição sem nenhuma reconstrução.",
        "Irradiar o paciente e não produzir imagem nenhuma não tem finalidade."));
    }

    recs.forEach(function (r, i) {
      var campo = "reconstrucoes[" + i + "]";
      if (r.espessuraMm != null && !(r.espessuraMm > 0)) {
        out.push(achado(ERRO, "ESPESSURA_INVALIDA", campo + ".espessuraMm",
          "Espessura de corte não positiva na série \"" + r.nome + "\".", null));
      }
      if (r.incrementoMm != null && !(r.incrementoMm > 0)) {
        out.push(achado(ERRO, "INCREMENTO_INVALIDO", campo + ".incrementoMm",
          "Incremento não positivo na série \"" + r.nome + "\".", null));
      }
      if (r.fovMm != null && ctx.larguraPacienteMm && r.fovMm < ctx.larguraPacienteMm) {
        out.push(achado(ERRO, "FOV_MENOR_QUE_PACIENTE", campo + ".fovMm",
          "FOV de " + r.fovMm + " mm é menor que a largura do paciente (" +
          Math.round(ctx.larguraPacienteMm) + " mm) na série \"" + r.nome + "\".",
          "O que fica fora do FOV não é reconstruído e produz artefato de truncamento na borda."));
      }
    });

    if (p.contraste && (!p.contraste.fases || !p.contraste.fases.length)) {
      out.push(achado(ERRO, "CONTRASTE_SEM_FASE", "contraste.fases",
        "Contraste definido sem nenhuma fase.",
        "Sem fase não há quando adquirir: o contraste não tem função no protocolo."));
    }

    if (ctx.comprimentoFaixaMm && ctx.extensaoVolumeMm &&
        ctx.comprimentoFaixaMm > ctx.extensaoVolumeMm * 1.02) {
      out.push(achado(ERRO, "FAIXA_FORA_DO_TOPOGRAMA", "plano",
        "Faixa planejada (" + Math.round(ctx.comprimentoFaixaMm) + " mm) excede a extensão do topograma (" +
        Math.round(ctx.extensaoVolumeMm) + " mm).",
        "Não há dado fora do topograma: a parte excedente não seria adquirida."));
    }

    // ---- AVISOS: executável, mas provavelmente indesejado ---------------

    recs.forEach(function (r, i) {
      var campo = "reconstrucoes[" + i + "]";
      if (r.incrementoMm > r.espessuraMm) {
        out.push(achado(AVISO, "LACUNA_ENTRE_CORTES", campo + ".incrementoMm",
          "Incremento (" + r.incrementoMm + " mm) maior que a espessura (" + r.espessuraMm +
          " mm) na série \"" + r.nome + "\".",
          "Fica um vão de " + (r.incrementoMm - r.espessuraMm).toFixed(2) +
          " mm entre cortes: estruturas pequenas podem cair na lacuna e não aparecer."));
      }
      if (r.kernel === "nitido" && r.espessuraMm >= 5) {
        out.push(achado(AVISO, "NITIDO_COM_CORTE_GROSSO", campo,
          "Kernel nítido com espessura de " + r.espessuraMm + " mm na série \"" + r.nome + "\".",
          "O kernel aumenta o ruído para ganhar resolução no plano, mas o corte grosso já perdeu resolução no eixo Z: paga-se o ruído sem receber o detalhe."));
      }
      if (r.matriz && r.fovMm) {
        var pixel = r.fovMm / r.matriz;
        if (pixel > 1.0) {
          out.push(achado(AVISO, "PIXEL_GROSSO", campo,
            "Pixel de " + pixel.toFixed(2) + " mm na série \"" + r.nome + "\" (FOV " +
            r.fovMm + " / matriz " + r.matriz + ").",
            "Detalhes menores que o pixel não são resolvidos, por mais nítido que seja o kernel."));
        }
      }
    });

    var ehCabeca = Core.dose && Core.dose.fantomaDaRegiao(p.regiao) === "cabeca";
    if (ehCabeca && aq.modo !== "sequencial" && aq.pitch > 1.0) {
      out.push(achado(AVISO, "PITCH_ALTO_EM_CRANIO", "aquisicao.pitch",
        "Pitch " + aq.pitch + " em exame de crânio.",
        "Pitch acima de 1 reduz o mAs efetivo e eleva o ruído justamente onde o contraste entre substâncias cinzenta e branca é baixo. O usual é pitch < 1 ou modo axial sequencial."));
    }

    if (aq.kv != null && aq.kv < 100 && !p.contraste) {
      out.push(achado(AVISO, "KV_BAIXO_SEM_CONTRASTE", "aquisicao.kv",
        "kV de " + aq.kv + " sem contraste iodado.",
        "O ganho de contraste do kV baixo vem do realce do iodo. Sem contraste, o que sobra é mais ruído para a mesma dose."));
    }

    if (ctx.dlpEstimado && Core.dose) {
      var drl = Core.dose.DRL_DLP[p.regiao];
      if (drl && ctx.dlpEstimado > drl) {
        out.push(achado(AVISO, "ACIMA_DO_DRL", "dose",
          "DLP estimado (" + Math.round(ctx.dlpEstimado) + " mGy·cm) acima do nível de referência da região (~" + drl + ").",
          "Nível de referência não é limite: é sinal para revisar mAs, pitch e comprimento da faixa."));
      }
    }

    // ---- INFO: observação didática --------------------------------------

    if (aq.modo === "sequencial") {
      out.push(achado(INFO, "MODO_SEQUENCIAL", "aquisicao.modo",
        "Modo axial sequencial (step-and-shoot).",
        "A mesa avança entre rotações e fica parada durante a irradiação. Elimina o artefato helicoidal e é comum em crânio; em troca, o exame é mais lento."));
    }

    if (recs.length > 1) {
      out.push(achado(INFO, "MULTIPLAS_SERIES", "reconstrucoes",
        recs.length + " séries a partir da mesma aquisição.",
        "O paciente é irradiado uma vez; espessura, kernel e FOV são escolhas de reconstrução."));
    }

    if (p.dose && p.dose.aec && p.dose.aec.ativo) {
      out.push(achado(INFO, "AEC_ATIVA", "dose.aec",
        "Controle automático de exposição ativo.",
        "A corrente varia ao longo do eixo Z conforme a espessura do paciente, buscando ruído mais uniforme."));
    }

    var erros = out.filter(function (a) { return a.nivel === ERRO; });
    var avisos = out.filter(function (a) { return a.nivel === AVISO; });
    var infos = out.filter(function (a) { return a.nivel === INFO; });

    return {
      todos: out, erros: erros, avisos: avisos, infos: infos,
      podeExecutar: erros.length === 0,
      resumo: erros.length + " erro(s), " + avisos.length + " aviso(s), " + infos.length + " informação(ões)"
    };
  }

  Core.validacao = { validar: validar, NIVEIS: { ERRO: ERRO, AVISO: AVISO, INFO: INFO } };

})(typeof self !== "undefined" ? self : this);
