/**
 * core/protocol/gestor.js
 * Gestor de protocolos — duplicar, comparar, versionar, exportar e importar.
 *
 * Roda sobre o OBJETO, sem tocar na tela, pelas mesmas razões de
 * core/protocol/validacao.js: dá para testar sem navegador, e um protocolo que
 * chega de um arquivo passa exatamente pelas regras do que foi digitado.
 *
 * O que cada operação existe para resolver:
 *
 *   DUPLICAR   O catálogo canônico é referência. Sem uma cópia explícita, a
 *              única forma de experimentar é editar a referência — e aí ela
 *              deixa de ser referência. A cópia nasce DESTRAVADA e guarda de
 *              quem veio.
 *
 *   COMPARAR   A pergunta didática central é "o que muda se eu baixar o kV?".
 *              Responder exige ver os dois protocolos lado a lado com a
 *              diferença marcada, não decorar dois formulários.
 *
 *   VERSIONAR  Editar um protocolo apaga o anterior. Guardar o estado antes de
 *              cada gravação permite voltar atrás — e deixa visível o caminho
 *              que o aluno percorreu.
 *
 *   EXPORTAR   Um professor precisa distribuir um conjunto de protocolos. O
 *   IMPORTAR   arquivo é JSON com esquema declarado; na volta, cada protocolo
 *              passa por normalizarProtocolo e pela validação, e o que for
 *              recusado é DITO, não descartado em silêncio (mesma regra que
 *              transformou coerção silenciosa em erro no S-03).
 *
 * SEM dependência de DOM. Script clássico.
 */
(function (raiz) {
  "use strict";

  var Core = raiz.SimTCCore = raiz.SimTCCore || {};

  var ESQUEMA = "simtc.protocolos/1";
  var MAX_HISTORICO = 20;

  // Campos comparáveis: caminho no objeto, rótulo e unidade. A ordem é a de
  // leitura de um protocolo, não a do objeto.
  var CAMPOS = [
    ["nome", "Nome", ""],
    ["regiao", "Região", ""],
    ["indicacao", "Indicação", ""],
    ["scout.orientacao", "Topograma", ""],
    ["aquisicao.modo", "Modo", ""],
    ["aquisicao.kv", "Tensão", "kV"],
    ["aquisicao.mas", "Corrente-tempo", "mAs"],
    ["aquisicao.pitch", "Pitch", ""],
    ["aquisicao.tempoRotacaoS", "Tempo de rotação", "s"],
    ["aquisicao.colimacao.totalMm", "Colimação total", "mm"],
    ["aquisicao.direcao", "Direção", ""],
    ["aquisicao.tiltGantryDeg", "Tilt do gantry", "°"],
    ["dose.aec.ativo", "AEC", ""]
  ];

  var CAMPOS_RECON = [
    ["nome", "Nome da série", ""],
    ["espessuraMm", "Espessura", "mm"],
    ["incrementoMm", "Incremento", "mm"],
    ["kernel", "Kernel", ""],
    ["fovMm", "FOV", "mm"],
    ["matriz", "Matriz", ""]
  ];

  function pegar(obj, caminho) {
    var partes = caminho.split("."), v = obj;
    for (var i = 0; i < partes.length; i++) {
      if (v == null) return undefined;
      v = v[partes[i]];
    }
    return v;
  }

  function iguais(a, b) {
    if (a === b) return true;
    if (a == null && b == null) return true;
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
    return false;
  }

  function novoId() {
    return "prot_" + Date.now().toString(36) + "_" +
           Math.floor(Math.random() * 1e6).toString(36);
  }

  function copiaProfunda(o) {
    return JSON.parse(JSON.stringify(o));
  }

  /**
   * Cópia editável de um protocolo.
   *
   * A cópia nasce destravada mesmo que a origem esteja travada: é exatamente
   * para isso que ela serve. Guarda `derivadoDe` para que a comparação com a
   * referência continue possível depois.
   */
  function duplicar(p, opcoes) {
    opcoes = opcoes || {};
    var novo = copiaProfunda(p);
    novo.id = opcoes.id || novoId();
    novo.nome = opcoes.nome || ((p.nome || "Protocolo") + " (cópia)");
    novo.bloqueado = false;
    novo.favorito = false;
    novo.versao = 1;
    novo.historico = [];
    novo.derivadoDe = { id: p.id || null, nome: p.nome || null, versao: p.versao || 1 };
    novo.criadoEm = opcoes.agora || new Date().toISOString();
    return novo;
  }

  /**
   * Diferenças entre dois protocolos, campo a campo.
   * Devolve só o que MUDOU — lista vazia significa protocolos equivalentes nos
   * campos que governam a aquisição.
   */
  function comparar(a, b) {
    var out = [];
    CAMPOS.forEach(function (c) {
      var va = pegar(a, c[0]), vb = pegar(b, c[0]);
      if (!iguais(va, vb)) {
        out.push({ campo: c[0], rotulo: c[1], unidade: c[2], de: va, para: vb });
      }
    });

    var ra = (a && a.reconstrucoes) || [], rb = (b && b.reconstrucoes) || [];
    var n = Math.max(ra.length, rb.length);
    for (var i = 0; i < n; i++) {
      var pre = "reconstrucoes[" + i + "].";
      if (!ra[i]) {
        out.push({ campo: pre.slice(0, -1), rotulo: "Série " + (i + 1),
                   unidade: "", de: null, para: (rb[i] && rb[i].nome) || "(nova)" });
        continue;
      }
      if (!rb[i]) {
        out.push({ campo: pre.slice(0, -1), rotulo: "Série " + (i + 1),
                   unidade: "", de: ra[i].nome || "(série)", para: null });
        continue;
      }
      CAMPOS_RECON.forEach(function (c) {
        var va2 = ra[i][c[0]], vb2 = rb[i][c[0]];
        if (!iguais(va2, vb2)) {
          out.push({ campo: pre + c[0], rotulo: "Série " + (i + 1) + " · " + c[1],
                     unidade: c[2], de: va2, para: vb2 });
        }
      });
    }
    return out;
  }

  /**
   * Guarda o estado atual no histórico e incrementa a versão.
   *
   * Chamar ANTES de aplicar a edição: o que entra no histórico é o que estava
   * valendo. O histórico tem teto — sem ele, um protocolo muito editado
   * cresceria sem fim dentro do IndexedDB.
   */
  function registrarVersao(p, nota, agora) {
    var h = Array.isArray(p.historico) ? p.historico : [];
    var instantaneo = copiaProfunda(p);
    delete instantaneo.historico;
    h.push({
      versao: p.versao || 1,
      em: agora || new Date().toISOString(),
      nota: nota || "",
      estado: instantaneo
    });
    while (h.length > MAX_HISTORICO) h.shift();
    p.historico = h;
    p.versao = (p.versao || 1) + 1;
    return p;
  }

  /**
   * Volta o protocolo a uma versão do histórico. O estado ATUAL é guardado
   * antes, de modo que voltar atrás também é reversível.
   */
  function reverter(p, indice, agora) {
    var h = Array.isArray(p.historico) ? p.historico : [];
    if (!(indice >= 0) || indice >= h.length) return null;
    var alvo = copiaProfunda(h[indice].estado);
    var versaoAlvo = h[indice].versao;
    registrarVersao(p, "antes de voltar à versão " + versaoAlvo, agora);

    var historico = p.historico, versao = p.versao, id = p.id;
    var k;
    for (k in p) if (Object.prototype.hasOwnProperty.call(p, k)) delete p[k];
    for (k in alvo) if (Object.prototype.hasOwnProperty.call(alvo, k)) p[k] = alvo[k];
    p.id = id;                 // a identidade não volta no tempo
    p.historico = historico;
    p.versao = versao;
    p.bloqueado = false;       // voltar atrás é edição: não reintroduz a trava
    p.revertidoDe = versaoAlvo;
    return p;
  }

  /** Envelope JSON com esquema declarado. */
  function exportar(lista, meta) {
    meta = meta || {};
    var protocolos = (Array.isArray(lista) ? lista : [lista]).map(function (p) {
      var c = copiaProfunda(p);
      delete c.historico;      // histórico é local; não viaja entre máquinas
      return c;
    });
    return JSON.stringify({
      esquema: ESQUEMA,
      geradoEm: meta.agora || new Date().toISOString(),
      origem: meta.origem || "Simulador Educacional de TC",
      protocolos: protocolos
    }, null, 2);
  }

  /**
   * Lê um arquivo exportado. Cada protocolo passa por normalizarProtocolo e
   * pela validação; o que não puder ser executado é RECUSADO com motivo, nunca
   * aceito em silêncio nem "consertado" por conta própria.
   *
   * @returns {{aceitos:Array, recusados:Array, erro:string|null}}
   */
  function importar(texto, opcoes) {
    opcoes = opcoes || {};
    var dados;
    try {
      dados = JSON.parse(texto);
    } catch (e) {
      return { aceitos: [], recusados: [], erro: "Arquivo não é JSON válido: " + e.message };
    }
    if (!dados || typeof dados !== "object") {
      return { aceitos: [], recusados: [], erro: "Arquivo vazio ou fora do formato." };
    }
    if (dados.esquema !== ESQUEMA) {
      return { aceitos: [], recusados: [], erro:
        "Esquema \"" + (dados.esquema || "ausente") + "\" — esperado \"" + ESQUEMA + "\"." };
    }
    var lista = Array.isArray(dados.protocolos) ? dados.protocolos : [];
    if (!lista.length) {
      return { aceitos: [], recusados: [], erro: "O arquivo não contém nenhum protocolo." };
    }

    var aceitos = [], recusados = [];
    lista.forEach(function (cru, i) {
      var rotulo = (cru && cru.nome) || ("protocolo " + (i + 1));
      var p;
      try {
        p = Core.model.normalizarProtocolo(cru);
      } catch (e) {
        recusados.push({ nome: rotulo, motivo: "não pôde ser lido: " + e.message });
        return;
      }
      var v = Core.validacao ? Core.validacao.validar(p, {}) : { erros: [], podeExecutar: true };
      if (!v.podeExecutar) {
        recusados.push({
          nome: rotulo,
          motivo: v.erros.map(function (a) { return a.texto; }).join(" "),
          erros: v.erros
        });
        return;
      }
      // Identidade nova por padrão: importar não sobrescreve o que já existe.
      if (!opcoes.preservarId) p.id = novoId();
      p.bloqueado = false;
      p.importadoEm = opcoes.agora || new Date().toISOString();
      aceitos.push(p);
    });

    return { aceitos: aceitos, recusados: recusados, erro: null };
  }

  Core.gestorProtocolos = {
    ESQUEMA: ESQUEMA,
    MAX_HISTORICO: MAX_HISTORICO,
    CAMPOS: CAMPOS,
    duplicar: duplicar,
    comparar: comparar,
    registrarVersao: registrarVersao,
    reverter: reverter,
    exportar: exportar,
    importar: importar,
    novoId: novoId
  };

})(typeof self !== "undefined" ? self : this);
