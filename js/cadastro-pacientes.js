/**
 * js/cadastro-pacientes.js
 * Simulador Educacional de TC — Tela de Cadastro de Pacientes.
 *
 * Formulario (prontuario, nome, sexo, idade, regiao) + lista persistida
 * em IndexedDB. Os pacientes cadastrados alimentam a lista de Exames da
 * aquisicao. Nenhum dado clinico e presumido.
 *
 * Depende de: js/shared.js (SimTC)
 * Script classico — sem ES modules, sem bundler.
 */
(function () {
  "use strict";

  function initPatients() {
    var fPront = document.getElementById("pac-prontuario");
    var fNome = document.getElementById("pac-nome");
    var fSexo = document.getElementById("pac-sexo");
    var fIdade = document.getElementById("pac-idade");
    var fRegiao = document.getElementById("pac-regiao");
    var btnAdd = document.getElementById("pac-add");
    var listEl = document.getElementById("pac-list");
    var examList = document.getElementById("ws-patient-list");
    if (!fNome || !btnAdd || !listEl) return;

    var pacientes = [];
    var memoryFallback = false;

    if (fRegiao && !fRegiao.options.length) {
      SimTC.REGIOES.forEach(function (r) {
        var o = document.createElement("option");
        o.value = r; o.textContent = r;
        fRegiao.appendChild(o);
      });
    }

    function persist(o) { if (memoryFallback) return Promise.resolve(); return SimTC.dbStorePut("pacientes", o).catch(function () { memoryFallback = true; }); }
    function persistDel(id) { if (memoryFallback) return Promise.resolve(); return SimTC.dbStoreDel("pacientes", id).catch(function () { memoryFallback = true; }); }

    function currentPatient() { return pacientes.length ? pacientes[pacientes.length - 1] : null; }

    function renderExamList() {
      if (!examList) return;
      examList.innerHTML = "";
      var p = currentPatient();
      var li = document.createElement("li");
      li.className = "ws-list__item" + (p ? " ws-list__item--active" : "");
      var nm = document.createElement("span"); nm.className = "ws-list__name";
      var meta = document.createElement("span"); meta.className = "ws-list__meta";
      if (!p) {
        nm.textContent = "Nenhum paciente em exame";
        meta.textContent = "Cadastre o paciente para iniciar";
      } else {
        nm.textContent = p.nome + (p.prontuario ? " · " + p.prontuario : "");
        var parts = [p.regiao, p.idade ? p.idade + " anos" : "", p.sexo].filter(Boolean);
        if (SimTC.examProtocol.name) parts.push("Prot.: " + SimTC.examProtocol.name);
        meta.textContent = parts.join(" · ") || "Em exame";
      }
      li.appendChild(nm); li.appendChild(meta);
      examList.appendChild(li);
    }
    SimTC.examProtocol.refresh = renderExamList;

    // API usada pelo viewer: um exame por vez; encerrar apaga o registro.
    SimTC.examSessionApi = {
      get: currentPatient,
      end: function () {
        var p = currentPatient();
        if (!p) return Promise.resolve();
        return persistDel(p.id).then(function () {
          pacientes = pacientes.filter(function (x) { return x.id !== p.id; });
          renderList(); renderExamList();
        });
      }
    };

    function renderList() {
      listEl.innerHTML = "";
      if (pacientes.length === 0) {
        var empty = document.createElement("li");
        empty.className = "pac-list__empty";
        empty.textContent = "Nenhum paciente cadastrado ainda.";
        listEl.appendChild(empty);
        return;
      }
      pacientes.forEach(function (p) {
        var li = document.createElement("li");
        li.className = "pac-list__item";
        var info = document.createElement("div"); info.className = "pac-list__info";
        var nm = document.createElement("span"); nm.className = "pac-list__name"; nm.textContent = p.nome;
        var meta = document.createElement("span"); meta.className = "pac-list__meta";
        meta.textContent = [p.prontuario ? "Pront. " + p.prontuario : "", p.sexo, p.idade ? p.idade + " anos" : "", p.regiao].filter(Boolean).join(" · ");
        info.appendChild(nm); info.appendChild(meta);
        var del = document.createElement("button");
        del.type = "button"; del.className = "pac-list__del"; del.setAttribute("aria-label", "Excluir paciente"); del.textContent = "✕";
        del.addEventListener("click", function () {
          if (!window.confirm("Excluir o paciente \"" + p.nome + "\"?")) return;
          persistDel(p.id).then(function () {
            pacientes = pacientes.filter(function (x) { return x.id !== p.id; });
            renderList(); renderExamList();
          });
        });
        li.appendChild(info); li.appendChild(del);
        listEl.appendChild(li);
      });
    }

    function addPatient() {
      var nome = (fNome.value || "").trim();
      if (!nome) { fNome.focus(); SimTC.showMessage("Informe o nome do paciente.", "warning"); return; }
      var novo = {
        id: "pac_" + Date.now(),
        prontuario: fPront ? (fPront.value || "").trim() : "",
        nome: nome,
        sexo: fSexo ? fSexo.value : "",
        idade: fIdade ? (fIdade.value || "").trim() : "",
        regiao: fRegiao ? fRegiao.value : ""
      };
      pacientes.push(novo);
      persist(novo).then(function () {
        renderList(); renderExamList();
        if (fPront) fPront.value = "";
        fNome.value = "";
        if (fIdade) fIdade.value = "";
        fNome.focus();
        SimTC.showMessage("Paciente \"" + novo.nome + "\" cadastrado" + (memoryFallback ? " (temporário)." : "."), "success");
      });
    }

    btnAdd.addEventListener("click", addPatient);
    fNome.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addPatient(); } });

    SimTC.dbStoreAll("pacientes")
      .catch(function (err) { memoryFallback = true; SimTC.showMessage("Cadastro em modo temporário: " + err.message, "info"); return []; })
      .then(function (list) { pacientes = list || []; renderList(); renderExamList(); });
  }

  // Registra modulo
  window.SimTC = window.SimTC || {};
  SimTC.Pacientes = { init: initPatients };

})();