/**
 * js/cadastro-pacientes.js
 * Simulador Educacional de TC — Lista de trabalho e exames realizados.
 *
 * Passa a ser a CAMADA DE TELA da worklist do núcleo (core/model/patient.js).
 * Toda a regra de "quem está em exame" vive lá; aqui só se desenha e se
 * escuta o barramento.
 *
 * Corrige:
 *   B-10  o exame era do ÚLTIMO paciente cadastrado, inferido em silêncio;
 *         cadastrar um segundo sequestrava o exame em curso, e o Stop
 *         APAGAVA o registro do banco. Agora a seleção é explícita e
 *         encerrar arquiva em vez de apagar.
 *   B-20  não havia lista de exames realizados. Agora existe, persistida em
 *         IndexedDB (store "estudos"), com reabrir para revisão.
 *
 * Preenchida por este modulo: SimTC.examSessionApi
 *
 * Depende de: js/shared.js (SimTC), core/ (SimTCCore)
 * Script classico — sem ES modules, sem bundler.
 */
(function () {
  "use strict";

  function initPatients() {
    var fPront = document.getElementById("pac-prontuario");
    var fNome = document.getElementById("pac-nome");
    var fSexo = document.getElementById("pac-sexo");
    var fIdade = document.getElementById("pac-idade");
    var fPeso = document.getElementById("pac-peso");
    var fAltura = document.getElementById("pac-altura");
    var fRegiao = document.getElementById("pac-regiao");
    var btnAdd = document.getElementById("pac-add");
    var listEl = document.getElementById("pac-list");
    var estudoEl = document.getElementById("estudo-list");
    var examList = document.getElementById("ws-patient-list");
    if (!fNome || !btnAdd || !listEl) return;

    var Core = window.SimTCCore;
    if (!Core || !Core.sessao) {
      SimTC.showMessage("Núcleo do simulador não carregou — a lista de trabalho ficará indisponível.", "error");
      return;
    }
    var sessao = Core.sessao;
    var worklist = sessao.worklist;
    var EV = Core.EVENTOS;

    var memoryFallback = false;
    var estudos = [];

    if (fRegiao && !fRegiao.options.length) {
      SimTC.REGIOES.forEach(function (r) {
        var o = document.createElement("option");
        o.value = r; o.textContent = r;
        fRegiao.appendChild(o);
      });
    }

    // ---- persistência (tolerante: sem IndexedDB, segue em memória) ------
    function persist(o) {
      if (memoryFallback) return Promise.resolve();
      return SimTC.dbStorePut("pacientes", o).catch(function () { memoryFallback = true; });
    }
    function persistDel(id) {
      if (memoryFallback) return Promise.resolve();
      return SimTC.dbStoreDel("pacientes", id).catch(function () { memoryFallback = true; });
    }
    function persistEstudo(e) {
      if (memoryFallback) return Promise.resolve();
      return SimTC.dbStorePut("estudos", e).catch(function () { memoryFallback = true; });
    }

    // ---- painel de exame (quadrante de aquisição) -----------------------
    function renderExamList() {
      if (!examList) return;
      examList.innerHTML = "";
      var p = worklist.selecionado();
      var li = document.createElement("li");
      li.className = "ws-list__item" + (p ? " ws-list__item--active" : "");
      var nm = document.createElement("span"); nm.className = "ws-list__name";
      var meta = document.createElement("span"); meta.className = "ws-list__meta";
      if (!p) {
        nm.textContent = "Nenhum paciente em exame";
        meta.textContent = worklist.quantidade()
          ? "Selecione o paciente na lista de trabalho"
          : "Cadastre o paciente para iniciar";
      } else {
        nm.textContent = p.nome + (p.prontuario ? " · " + p.prontuario : "");
        var partes = [p.regiao, p.idadeAnos != null ? p.idadeAnos + " anos" : "", p.sexo].filter(Boolean);
        if (SimTC.examProtocol.name) partes.push("Prot.: " + SimTC.examProtocol.name);
        meta.textContent = partes.join(" · ") || "Em exame";
      }
      li.appendChild(nm); li.appendChild(meta);
      examList.appendChild(li);
    }
    SimTC.examProtocol.refresh = renderExamList;

    // ---- lista de trabalho ----------------------------------------------
    function renderList() {
      listEl.innerHTML = "";
      var itens = worklist.todos();
      if (!itens.length) {
        var vazio = document.createElement("li");
        vazio.className = "pac-list__empty";
        vazio.textContent = "Nenhum paciente cadastrado ainda.";
        listEl.appendChild(vazio);
        return;
      }
      var selId = worklist.selecionado() ? worklist.selecionado().id : null;

      itens.forEach(function (p) {
        var emExame = p.id === selId;
        var li = document.createElement("li");
        li.className = "pac-list__item pac-list__item--sel" + (emExame ? " is-exame" : "");
        li.setAttribute("role", "button");
        li.setAttribute("tabindex", "0");
        li.setAttribute("aria-pressed", String(emExame));
        li.title = emExame ? "Paciente em exame" : "Colocar em exame";

        var info = document.createElement("div"); info.className = "pac-list__info";
        var nm = document.createElement("span"); nm.className = "pac-list__name";
        nm.textContent = p.nome;
        var meta = document.createElement("span"); meta.className = "pac-list__meta";
        meta.textContent = Core.model.resumoPaciente(p);
        info.appendChild(nm); info.appendChild(meta);
        li.appendChild(info);

        if (emExame) {
          var tag = document.createElement("span");
          tag.className = "pac-list__tag";
          tag.textContent = "em exame";
          li.appendChild(tag);
        }

        var del = document.createElement("button");
        del.type = "button"; del.className = "pac-list__del";
        del.setAttribute("aria-label", "Excluir paciente " + p.nome);
        del.textContent = "✕";
        del.addEventListener("click", function (ev) {
          ev.stopPropagation();       // excluir não é selecionar
          if (!window.confirm("Excluir o paciente \"" + p.nome + "\" da lista de trabalho?")) return;
          worklist.remover(p.id);
          persistDel(p.id).then(function () { renderList(); renderExamList(); });
        });
        li.appendChild(del);

        function alternar() {
          // Clicar no paciente em exame o retira de exame (sem apagá-lo).
          if (p.id === (worklist.selecionado() && worklist.selecionado().id)) {
            worklist.encerrarExame();
            SimTC.showMessage("Exame encerrado. O paciente continua na lista de trabalho.", "info");
          } else {
            worklist.selecionar(p.id);
            SimTC.showMessage("Paciente em exame: " + p.nome + ".", "success");
          }
        }
        li.addEventListener("click", alternar);
        li.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); alternar(); }
        });

        listEl.appendChild(li);
      });
    }

    // ---- exames realizados (B-20) ---------------------------------------
    function formatarQuando(iso) {
      try {
        var d = new Date(iso);
        return d.toLocaleDateString("pt-BR") + " " +
               d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      } catch (e) { return iso || ""; }
    }

    function renderEstudos() {
      if (!estudoEl) return;
      estudoEl.innerHTML = "";
      if (!estudos.length) {
        var vazio = document.createElement("li");
        vazio.className = "pac-list__empty";
        vazio.textContent = "Nenhum exame realizado ainda.";
        estudoEl.appendChild(vazio);
        return;
      }
      // Mais recentes primeiro.
      estudos.slice().sort(function (a, b) {
        return String(b.dataHora).localeCompare(String(a.dataHora));
      }).forEach(function (e) {
        var li = document.createElement("li");
        li.className = "pac-list__item";

        var info = document.createElement("div"); info.className = "pac-list__info";
        var nm = document.createElement("span"); nm.className = "pac-list__name";
        nm.textContent = (e.pacienteNome || "—") + (e.protocoloNome ? " · " + e.protocoloNome : "");
        var meta = document.createElement("span"); meta.className = "pac-list__meta";
        var partes = [];
        if (e.regiao) partes.push(e.regiao);
        if (e.cortes) partes.push(e.cortes + " cortes");
        if (e.faixaMm) partes.push(Math.round(e.faixaMm) + " mm");
        if (e.dlp) partes.push("DLP " + Math.round(e.dlp) + " mGy·cm");
        meta.textContent = partes.join(" · ");
        info.appendChild(nm); info.appendChild(meta);
        li.appendChild(info);

        var quando = document.createElement("span");
        quando.className = "pac-list__quando";
        quando.textContent = formatarQuando(e.dataHora);
        li.appendChild(quando);

        // Reabrir: recoloca o paciente em exame para revisão/edição.
        var abrir = document.createElement("button");
        abrir.type = "button"; abrir.className = "pac-list__acao";
        abrir.textContent = "Reabrir";
        abrir.addEventListener("click", function () {
          var p = e.pacienteId ? worklist.porId(e.pacienteId) : null;
          if (!p) {
            // Paciente já removido da lista — recria a partir do estudo.
            p = worklist.adicionar({
              id: e.pacienteId, nome: e.pacienteNome, prontuario: e.prontuario,
              regiao: e.regiao, idadeAnos: e.idadeAnos, pesoKg: e.pesoKg, alturaCm: e.alturaCm
            });
            persist(p);
          }
          worklist.selecionar(p.id);
          SimTC.showMessage("Exame de " + p.nome + " reaberto para revisão.", "info");
        });
        li.appendChild(abrir);

        var del = document.createElement("button");
        del.type = "button"; del.className = "pac-list__del";
        del.setAttribute("aria-label", "Excluir exame");
        del.textContent = "✕";
        del.addEventListener("click", function () {
          if (!window.confirm("Excluir este exame do histórico?")) return;
          estudos = estudos.filter(function (x) { return x.studyUID !== e.studyUID; });
          if (!memoryFallback) SimTC.dbStoreDel("estudos", e.studyUID).catch(function () {});
          renderEstudos();
        });
        li.appendChild(del);

        estudoEl.appendChild(li);
      });
    }

    // ---- API consumida pela aquisição -----------------------------------
    SimTC.examSessionApi = {
      get: function () { return worklist.selecionado(); },

      /**
       * Encerrar NÃO apaga mais o paciente: apenas o tira de exame. Ele
       * permanece na lista de trabalho e o exame, se houve aquisição, ficou
       * arquivado por `arquivar()`.
       */
      end: function () {
        worklist.encerrarExame();
        return Promise.resolve();
      },

      /**
       * Arquiva o exame realizado. Chamado pela aquisição ao concluir.
       * Guarda um RESUMO (não os pixels): quem foi, com que protocolo, que
       * faixa, quantos cortes e a dose estimada.
       */
      arquivar: function (resumo) {
        var p = worklist.selecionado();
        if (!p) return Promise.resolve(null);
        var e = {
          studyUID: (Core.model.novoUID ? Core.model.novoUID() : "est_" + Date.now()),
          dataHora: new Date().toISOString(),
          pacienteId: p.id,
          pacienteNome: p.nome,
          prontuario: p.prontuario,
          idadeAnos: p.idadeAnos,
          pesoKg: p.pesoKg,
          alturaCm: p.alturaCm,
          regiao: (resumo && resumo.regiao) || p.regiao || "",
          protocoloNome: (resumo && resumo.protocoloNome) || "",
          modo: (resumo && resumo.modo) || "",
          faixaMm: (resumo && resumo.faixaMm) || null,
          cortes: (resumo && resumo.cortes) || null,
          dlp: (resumo && resumo.dlp) || null,
          isoOffsetCm: (resumo && resumo.isoOffsetCm) != null ? resumo.isoOffsetCm : null
        };
        estudos.push(e);
        renderEstudos();
        return persistEstudo(e).then(function () { return e; });
      },

      listarEstudos: function () { return estudos.slice(); }
    };

    // ---- cadastro --------------------------------------------------------
    function addPatient() {
      var novo;
      try {
        novo = Core.model.criarPaciente({
          prontuario: fPront ? fPront.value : "",
          nome: fNome.value,
          sexo: fSexo ? ({ Feminino: "F", Masculino: "M", Outro: "O" })[fSexo.value] || "" : "",
          idade: fIdade ? fIdade.value : "",
          pesoKg: fPeso ? fPeso.value : "",
          alturaCm: fAltura ? fAltura.value : "",
          regiao: fRegiao ? fRegiao.value : ""
        });
      } catch (err) {
        fNome.focus();
        SimTC.showMessage(err.message, "warning");
        return;
      }

      // Cadastrar NÃO coloca em exame — a seleção é um ato separado.
      worklist.adicionar(novo);
      persist(novo).then(function () {
        renderList(); renderExamList();
        if (fPront) fPront.value = "";
        fNome.value = "";
        if (fIdade) fIdade.value = "";
        if (fPeso) fPeso.value = "";
        if (fAltura) fAltura.value = "";
        fNome.focus();
        SimTC.showMessage(
          "Paciente \"" + novo.nome + "\" cadastrado" + (memoryFallback ? " (temporário)" : "") +
          ". Clique nele na lista para colocá-lo em exame.", "success");
      });
    }

    btnAdd.addEventListener("click", addPatient);
    fNome.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addPatient(); }
    });

    // ---- barramento: a tela apenas reage --------------------------------
    Core.bus.on(EV.EXAME_SELECIONADO, function () { renderList(); renderExamList(); });
    Core.bus.on(EV.EXAME_ENCERRADO, function () { renderList(); renderExamList(); });
    Core.bus.on(EV.PACIENTE_ADICIONADO, function () { renderList(); });
    Core.bus.on(EV.PACIENTE_REMOVIDO, function () { renderList(); renderExamList(); });

    // ---- carga inicial ---------------------------------------------------
    Promise.all([
      SimTC.dbStoreAll("pacientes").catch(function (err) {
        memoryFallback = true;
        SimTC.showMessage("Cadastro em modo temporário: " + err.message, "info");
        return [];
      }),
      SimTC.dbStoreAll("estudos").catch(function () { return []; })
    ]).then(function (r) {
      worklist.carregar(r[0] || []);
      estudos = r[1] || [];
      renderList(); renderExamList(); renderEstudos();
    });
  }

  // Registra modulo
  window.SimTC = window.SimTC || {};
  SimTC.Pacientes = { init: initPatients };

})();
