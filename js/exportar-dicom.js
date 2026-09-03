/**
 * js/exportar-dicom.js
 * Exporta a série reconstruída como arquivos DICOM, num .zip.
 *
 * Fecha o fluxo que a auditoria cobrava: o exame sai da plataforma num formato
 * que qualquer visualizador DICOM abre. Antes, a "saída" era um objeto
 * improvisado com geometria errada por fator 2 e HU que cobriam −160..+223.
 *
 * O ZIP é gravado sem compressão (método STORE). Um DICOM de 16 bits comprime
 * pouco, e evitar o deflate dispensa uma dependência inteira.
 *
 * Depende de: core/dicom/writer.js
 * Script clássico.
 */
(function () {
  "use strict";

  // ---- CRC-32, exigido pelo formato ZIP --------------------------------
  var TABELA_CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(v) { return [v & 255, (v >> 8) & 255]; }
  function u32(v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]; }
  function bytesDe(txt) {
    var b = []; for (var i = 0; i < txt.length; i++) b.push(txt.charCodeAt(i) & 255);
    return b;
  }

  /**
   * ZIP sem compressão a partir de [{nome, bytes}].
   * @returns {Blob}
   */
  function zipar(arquivos) {
    var partes = [], central = [], deslocamento = 0;

    arquivos.forEach(function (a) {
      var nome = bytesDe(a.nome);
      var crc = crc32(a.bytes);
      var tam = a.bytes.length;

      var local = [].concat(
        u32(0x04034b50), u16(20), u16(0), u16(0),   // assinatura, versão, flags, método STORE
        u16(0), u16(0),                              // hora e data (irrelevantes aqui)
        u32(crc), u32(tam), u32(tam),
        u16(nome.length), u16(0), nome
      );
      partes.push(new Uint8Array(local));
      partes.push(a.bytes);

      central.push([].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0),
        u16(0), u16(0),
        u32(crc), u32(tam), u32(tam),
        u16(nome.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(deslocamento), nome
      ));
      deslocamento += local.length + tam;
    });

    var inicioCentral = deslocamento, tamCentral = 0;
    central.forEach(function (c) { partes.push(new Uint8Array(c)); tamCentral += c.length; });
    partes.push(new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0),
      u16(arquivos.length), u16(arquivos.length),
      u32(tamCentral), u32(inicioCentral), u16(0)
    )));

    return new Blob(partes, { type: "application/zip" });
  }

  function baixar(blob, nome) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = nome;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function nomeSeguro(s) {
    return String(s || "exame").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "exame";
  }

  var Exportador = {
    disponivel: function () {
      return !!(window.SimTCCore && window.SimTCCore.dicom &&
                window.SimTC && SimTC.MotorImagem && SimTC.MotorImagem.temSeries());
    },

    /**
     * Exporta a série ATUAL como .zip de arquivos DICOM.
     * @returns {{arquivos:number, nome:string}}
     */
    exportarSerieAtual: function () {
      var Core = window.SimTCCore;
      var M = SimTC.MotorImagem;
      var s = M.serieAtual();
      if (!s) throw new Error("Nenhuma série reconstruída para exportar.");

      var pac = (SimTC.examSessionApi && SimTC.examSessionApi.get()) || {};
      var prot = (SimTC.examProtocol && SimTC.examProtocol.data) || {};
      var dz = M.dose() || {};
      var origem = s.origem || {};

      var r = Core.dicom.gerarSerie({
        serie: s,
        numeroSerie: M.indiceAtual() + 1,
        paciente: {
          // Nome DICOM segue "Sobrenome^Nome"; sem sobrenome, vai o nome todo.
          nome: (pac.nome || "ANONIMO").replace(/\^/g, " "),
          id: pac.prontuario || pac.id || "SIM",
          sexo: pac.sexo || ""
        },
        estudo: {
          studyUID: Core.model.novoUID(),
          frameUID: Core.model.novoUID(),
          descricao: prot.nome || "Simulacao educacional de TC"
        },
        tecnica: {
          kv: origem.kv, mas: origem.mas, pitch: origem.pitch,
          tempoRotacaoS: 0.5,
          colimacaoMm: origem.linhaMm,
          ctdivol: dz.ctdivol
        },
        janela: M.janela()
      });

      var nome = "TC_" + nomeSeguro(pac.nome) + "_" + nomeSeguro(s.nome) + ".zip";
      baixar(zipar(r.arquivos), nome);
      return { arquivos: r.arquivos.length, nome: nome };
    },

    zipar: zipar,
    crc32: crc32
  };

  window.SimTC = window.SimTC || {};
  SimTC.ExportarDicom = Exportador;

})();
