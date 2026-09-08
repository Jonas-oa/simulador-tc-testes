/**
 * js/worklist-exemplo.js
 * A worklist do dia — a lista que chega do RIS, já preenchida.
 *
 * POR QUE ISTO EXISTE
 *
 * Num tomógrafo de verdade o operador quase nunca digita um paciente. A lista
 * de agendamento chega do sistema de informação (RIS) pela DICOM Modality
 * Worklist, e o trabalho do técnico é OUTRO: conferir se a pessoa à sua frente
 * é a pessoa da lista, ler a indicação clínica, e escolher o protocolo que
 * responde àquela pergunta.
 *
 * O simulador começava com a lista vazia e um formulário em branco. Isso
 * ensinava a digitar, que é a única parte do trabalho que ninguém faz.
 *
 * Cada linha aqui traz a INDICAÇÃO CLÍNICA, e é de propósito: é ela que
 * justifica a região, a fase de contraste e, mais adiante, o protocolo. Um
 * "TCE, queda da própria altura" e uma "cefaleia crônica" pedem o mesmo crânio
 * por motivos diferentes — e um deles tem pressa.
 *
 * Selecionar uma linha NÃO cadastra: preenche o formulário. A conferência
 * continua sendo um ato do operador, como tem de ser.
 *
 * Peso e altura estão aqui porque alimentam a modulação de corrente (AEC) e o
 * SSDE: um paciente de 108 kg e um de 52 kg não recebem a mesma dose para a
 * mesma imagem, e o aluno precisa ver isso mudar.
 *
 * Script clássico. Sem dependências.
 */
(function () {
  "use strict";

  /**
   * Agendamentos de um turno. Nomes fictícios; prontuários no formato de um
   * serviço público brasileiro; horários em ordem de chegada.
   */
  var AGENDA = [
    {
      hora: "07:20", prontuario: "2026-041187",
      nome: "Maria Aparecida Ferreira", sexo: "Feminino", idade: 68,
      pesoKg: 71, alturaCm: 158, regiao: "Crânio",
      indicacao: "AVC? Déficit motor à direita há 40 min. Protocolo de urgência.",
      prioridade: "urgente"
    },
    {
      hora: "07:55", prontuario: "2026-041203",
      nome: "José Carlos de Oliveira", sexo: "Masculino", idade: 54,
      pesoKg: 96, alturaCm: 176, regiao: "Tórax",
      indicacao: "Dor torácica súbita e dispneia. Suspeita de TEP — angio com contraste.",
      prioridade: "urgente"
    },
    {
      hora: "08:30", prontuario: "2026-039874",
      nome: "Ana Beatriz Nogueira", sexo: "Feminino", idade: 31,
      pesoKg: 58, alturaCm: 165, regiao: "Abdome",
      indicacao: "Dor em fossa ilíaca direita há 18 h. Apendicite?",
      prioridade: "rotina"
    },
    {
      hora: "09:05", prontuario: "2026-038119",
      nome: "Sebastião Ramos Pinto", sexo: "Masculino", idade: 73,
      pesoKg: 68, alturaCm: 171, regiao: "Crânio",
      indicacao: "TCE, queda da própria altura. Anticoagulado.",
      prioridade: "urgente"
    },
    {
      hora: "09:40", prontuario: "2026-042330",
      nome: "Luiza Martins Cavalcanti", sexo: "Feminino", idade: 8,
      pesoKg: 26, alturaCm: 128, regiao: "Crânio",
      indicacao: "Cefaleia com vômitos matinais. PEDIÁTRICO — reduzir dose.",
      prioridade: "rotina"
    },
    {
      hora: "10:15", prontuario: "2026-040556",
      nome: "Antônio Silva Barbosa", sexo: "Masculino", idade: 61,
      pesoKg: 108, alturaCm: 174, regiao: "Abdome",
      indicacao: "Estadiamento de neoplasia colorretal. Controle de 6 meses.",
      prioridade: "rotina"
    },
    {
      hora: "10:50", prontuario: "2026-041902",
      nome: "Rita de Cássia Lopes", sexo: "Feminino", idade: 45,
      pesoKg: 63, alturaCm: 160, regiao: "Coluna",
      indicacao: "Lombalgia com irradiação. Hérnia discal L4-L5?",
      prioridade: "rotina"
    },
    {
      hora: "11:25", prontuario: "2026-042471",
      nome: "Paulo Henrique Assunção", sexo: "Masculino", idade: 27,
      pesoKg: 79, alturaCm: 183, regiao: "Membros",
      indicacao: "Fratura complexa de tornozelo direito. Planejamento cirúrgico.",
      prioridade: "rotina"
    },
    {
      hora: "13:00", prontuario: "2026-037645",
      nome: "Terezinha Gomes da Mata", sexo: "Feminino", idade: 82,
      pesoKg: 52, alturaCm: 149, regiao: "Pescoço",
      indicacao: "Nódulo cervical palpável há 2 meses. Caracterizar.",
      prioridade: "rotina"
    },
    {
      hora: "13:35", prontuario: "2026-042688",
      nome: "Marcos Vinícius Tavares", sexo: "Masculino", idade: 39,
      pesoKg: 84, alturaCm: 178, regiao: "Pelve",
      indicacao: "Trauma em acidente de moto. Avaliar arcabouço ósseo.",
      prioridade: "urgente"
    }
  ];

  window.SimTC = window.SimTC || {};
  SimTC.worklistExemplo = AGENDA;

})();
