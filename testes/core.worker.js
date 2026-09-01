/**
 * testes/core.worker.js
 * Suíte do núcleo, executada DENTRO de um Web Worker.
 *
 * Por que Worker e não Node: o critério de aceite da Fase 1 é "core/ roda sem
 * DOM". Um Worker não tem `document`, `window` nem `navigator.userAgent` de
 * página — se qualquer arquivo do núcleo tocar no DOM, o importScripts falha
 * aqui. É uma prova mais direta do que rodar em Node, e não exige instalar
 * nada. (Node não está disponível nesta máquina.)
 */
/* eslint-env worker */
"use strict";

importScripts(
  "../core/bus.js",
  "../core/clock.js",
  "../core/model/patient.js",
  "../core/model/protocol.js",
  "../core/model/exam.js",
  "../core/state.js"
);

var C = self.SimTCCore;
var M = C.model;

var resultados = [];
function teste(nome, fn) {
  try {
    fn();
    resultados.push({ nome: nome, ok: true });
  } catch (e) {
    resultados.push({ nome: nome, ok: false, erro: e && e.message ? e.message : String(e) });
  }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || "condição falsa"); }
function igual(a, b, msg) {
  if (a !== b) throw new Error((msg || "valores diferentes") + " — obtido " + JSON.stringify(a) + ", esperado " + JSON.stringify(b));
}
function perto(a, b, tol, msg) {
  if (!(Math.abs(a - b) <= tol)) throw new Error((msg || "fora da tolerância") + " — obtido " + a + ", esperado " + b + " ±" + tol);
}

// =====================================================================
// 0. AUSÊNCIA DE DOM — o critério central da fase
// =====================================================================
teste("núcleo carrega sem DOM (Worker não tem document/window)", function () {
  ok(typeof self.document === "undefined", "document existe no Worker?!");
  ok(typeof self.window === "undefined", "window existe no Worker?!");
  ok(!!C && !!C.Bus && !!C.Relogio && !!C.model && !!C.Sessao, "núcleo não expôs a API esperada");
});

// =====================================================================
// 1. BARRAMENTO
// =====================================================================
teste("bus: emit entrega a todos os assinantes", function () {
  var b = new C.Bus(), n = 0;
  b.on("x", function () { n++; });
  b.on("x", function () { n++; });
  b.emit("x", 1);
  igual(n, 2, "assinantes chamados");
});

teste("bus: off cancela a assinatura", function () {
  var b = new C.Bus(), n = 0;
  var cancelar = b.on("x", function () { n++; });
  b.emit("x"); cancelar(); b.emit("x");
  igual(n, 1);
});

teste("bus: ouvinte que lança não impede os demais", function () {
  var b = new C.Bus(), n = 0;
  b.on("x", function () { throw new Error("falha proposital"); });
  b.on("x", function () { n++; });
  b.emit("x");
  igual(n, 1, "segundo ouvinte deve rodar mesmo com o primeiro falhando");
});

teste("bus: replay entrega o último valor a quem assina depois", function () {
  // Este é o padrão que evita a classe de bug do handshake do leitor DICOM.
  var b = new C.Bus(), visto = null;
  b.emit("pronto", { v: 42 });
  b.on("pronto", function (d) { visto = d; }, true);
  ok(visto && visto.v === 42, "assinante tardio deveria receber o último valor");
});

// =====================================================================
// 2. RELÓGIO DE PASSO FIXO
// =====================================================================
teste("relógio: passo manual avança exatamente n passos", function () {
  var r = new C.Relogio({ passoS: 1 / 100 });
  var passos = 0, somaDt = 0;
  r.aoPasso(function (dt) { passos++; somaDt += dt; });
  r.passoManual(250);
  igual(passos, 250, "quantidade de passos");
  perto(somaDt, 2.5, 1e-9, "tempo simulado acumulado");
  perto(r.tempoSimS, 2.5, 1e-9, "tempoSimS");
});

teste("relógio: acumulador converte tempo real em passos fixos", function () {
  var r = new C.Relogio({ passoS: 1 / 100 });   // 10 ms por passo
  var passos = 0;
  r.aoPasso(function () { passos++; });
  r._rodando = true;
  r.avancar(1000);          // primeira chamada só ancora o relógio
  igual(passos, 0, "primeira chamada não deve executar passos");
  r.avancar(1055);          // 55 ms => 5 passos, sobra 5 ms
  igual(passos, 5, "55 ms a 10 ms/passo");
  r.avancar(1060);          // +5 ms => fecha o 6º passo
  igual(passos, 6);
});

teste("relógio: duas fontes no mesmo instante não dobram a simulação", function () {
  // rAF e timer podem chamar avancar() quase juntos; quem chega primeiro
  // consome o intervalo e o outro encontra ~0.
  var r = new C.Relogio({ passoS: 1 / 100 });
  var passos = 0;
  r.aoPasso(function () { passos++; });
  r._rodando = true;
  r.avancar(0);
  r.avancar(100, "raf");    // 100 ms => 10 passos
  igual(passos, 10);
  r.avancar(100, "timer");  // mesmo instante => nenhum passo extra
  igual(passos, 10, "segunda fonte não pode dobrar a física");
});

teste("relógio: atraso longo é limitado (sem espiral da morte)", function () {
  var r = new C.Relogio({ passoS: 1 / 100, atrasoMaxS: 0.25 });
  var passos = 0;
  r.aoPasso(function () { passos++; });
  r._rodando = true;
  r.avancar(0);
  r.avancar(600000);        // 10 minutos em segundo plano
  igual(passos, 25, "deve absorver no máximo 0,25 s => 25 passos");
  ok(r.descartadoS > 599, "tempo excedente deve ser contabilizado como descartado");
});

teste("relógio: tempo real para trás não gera passos negativos", function () {
  var r = new C.Relogio({ passoS: 1 / 100 });
  var passos = 0;
  r.aoPasso(function () { passos++; });
  r._rodando = true;
  r.avancar(5000);
  r.avancar(4000);          // relógio andou para trás
  igual(passos, 0);
});

// =====================================================================
// 3. PACIENTE E LISTA DE TRABALHO  (B-10)
// =====================================================================
teste("paciente: idade e peso absurdos viram null, não lixo", function () {
  var p = M.criarPaciente({ nome: "Teste", idade: "-999", pesoKg: "9999", alturaCm: "170" });
  igual(p.idadeAnos, null, "idade -999");
  igual(p.pesoKg, null, "peso 9999 kg");
  igual(p.alturaCm, 170, "altura válida deve virar número");
  igual(typeof p.alturaCm, "number", "altura precisa ser número, não string");
});

teste("paciente: nome vazio é recusado", function () {
  var lancou = false;
  try { M.criarPaciente({ nome: "   " }); } catch (e) { lancou = true; }
  ok(lancou, "nome só com espaços deveria ser recusado");
});

teste("worklist: cadastrar um 2º paciente NÃO sequestra o exame", function () {
  var w = new M.Worklist(new C.Bus());
  var a = w.adicionar({ nome: "Paciente A" });
  w.selecionar(a.id);
  w.adicionar({ nome: "Paciente B" });
  igual(w.selecionado().nome, "Paciente A", "seleção deve permanecer no A");
  igual(w.quantidade(), 2);
});

teste("worklist: adicionar não seleciona automaticamente", function () {
  var w = new M.Worklist(new C.Bus());
  w.adicionar({ nome: "Sozinho" });
  igual(w.selecionado(), null, "cadastro não deve implicar seleção");
});

teste("worklist: encerrar exame PRESERVA o paciente na lista", function () {
  var w = new M.Worklist(new C.Bus());
  var a = w.adicionar({ nome: "Preservado" });
  w.selecionar(a.id);
  w.encerrarExame();
  igual(w.selecionado(), null, "seleção deve ser limpa");
  igual(w.quantidade(), 1, "paciente NÃO pode ser apagado ao encerrar");
  ok(!!w.porId(a.id), "registro deve continuar recuperável");
});

teste("worklist: remover é ação separada e limpa a seleção", function () {
  var w = new M.Worklist(new C.Bus());
  var a = w.adicionar({ nome: "Removido" });
  w.selecionar(a.id);
  w.remover(a.id);
  igual(w.quantidade(), 0);
  igual(w.selecionado(), null);
});

// =====================================================================
// 4. PROTOCOLO TIPADO  (B-15)
// =====================================================================
teste("protocolo: strings do formato legado viram números", function () {
  var p = M.normalizarProtocolo({
    nome: "Crânio", regiao: "Crânio",
    kv: "120", mas: "300", pitch: "0,55", rotacao: "1,0",
    colimacao: "64 × 0,6 mm", espessura: "5,0 mm encéfalo", fov: "220–250 mm",
    kernel: "Encéfalo (liso) + Osso (nítido)", dose: "≈55 mGy (ref.)",
    modo: "helicoidal", direcao: "caudocranial", scout: "lateral"
  });
  igual(p.aquisicao.kv, 120);
  igual(p.aquisicao.mas, 300);
  perto(p.aquisicao.pitch, 0.55, 1e-9);
  igual(p.aquisicao.colimacao.nDetectores, 64);
  perto(p.aquisicao.colimacao.larguraMm, 0.6, 1e-9);
  perto(p.aquisicao.colimacao.totalMm, 38.4, 1e-9);
  igual(p.reconstrucoes[0].espessuraMm, 5);
  igual(p.reconstrucoes[0].fovMm, 220);
  igual(p.dose.ctdivolEstimado, null, "CTDIvol deve ser calculado, nunca herdado do texto");
  igual(p.dose.ctdivolLegado, 55, "valor antigo preservado só como referência");
});

teste("protocolo: modo sequencial zera o pitch", function () {
  var p = M.normalizarProtocolo({ modo: "sequencial", pitch: "0,55", kv: 120, mas: 300 });
  igual(p.aquisicao.pitch, null, "pitch não se aplica ao step-and-shoot");
});

teste("protocolo: campo ausente vira null, não valor inventado", function () {
  var p = M.normalizarProtocolo({ nome: "Em branco", regiao: "Pelve" });
  igual(p.aquisicao.kv, null);
  igual(p.aquisicao.mas, null);
  igual(p.reconstrucoes[0].espessuraMm, null);
});

teste("protocolo: velocidade da mesa = pitch × colimação / rotação", function () {
  var p = M.normalizarProtocolo({
    modo: "helicoidal", pitch: "1,0", colimacao: "64 × 0,6 mm", rotacao: "0,5", kv: 120, mas: 300
  });
  // 1,0 × 38,4 mm ÷ 0,5 s = 76,8 mm/s
  perto(M.velocidadeMesaMmS(p), 76.8, 1e-6);
});

teste("protocolo: mAs efetivo = mAs / pitch", function () {
  var p = M.normalizarProtocolo({ modo: "helicoidal", mas: "300", pitch: "1,5", kv: 120 });
  perto(M.masEfetivo(p), 200, 1e-9);
  var s = M.normalizarProtocolo({ modo: "sequencial", mas: "300", kv: 120 });
  perto(M.masEfetivo(s), 300, 1e-9, "no sequencial não há divisão por pitch");
});

// =====================================================================
// 5. PLANO E CONTAGEM DE CORTES  (raiz de B-03)
// =====================================================================
teste("plano: faixa é medida em mm, não em % da imagem", function () {
  var plano = M.criarPlano({ inicioMm: -60, fimMm: 60, fovMm: 220 });
  igual(M.comprimentoPlanoMm(plano), 120);
});

teste("plano: extremos invertidos são normalizados", function () {
  var plano = M.criarPlano({ inicioMm: 60, fimMm: -60 });
  igual(plano.inicioMm, -60);
  igual(plano.fimMm, 60);
});

teste("cortes acompanham a faixa planejada (não são fixos)", function () {
  var p120 = M.criarPlano({ inicioMm: 0, fimMm: 120 });
  var p177 = M.criarPlano({ inicioMm: 0, fimMm: 177 });
  igual(M.contarCortes(p120, 5), 24, "120 mm com incremento 5 mm");
  igual(M.contarCortes(p177, 5), 35, "177 mm com incremento 5 mm");
  ok(M.contarCortes(p120, 5) !== M.contarCortes(p177, 5),
     "faixas diferentes precisam produzir contagens diferentes (era 60 nas duas)");
});

teste("cortes: espessura fina gera mais imagens no mesmo dado bruto", function () {
  var plano = M.criarPlano({ inicioMm: 0, fimMm: 120 });
  igual(M.contarCortes(plano, 5), 24);
  igual(M.contarCortes(plano, 1.25), 96);
});

// =====================================================================
// 6. SESSÃO
// =====================================================================
teste("sessão: iniciar exame sem paciente selecionado é recusado", function () {
  var s = new C.Sessao({ bus: new C.Bus() });
  s.worklist.adicionar({ nome: "Não selecionado" });
  var lancou = false;
  try { s.abrirExame(); } catch (e) { lancou = true; }
  ok(lancou, "abrir exame sem seleção explícita deve falhar");
});

teste("sessão: pendências listam exatamente o que falta", function () {
  var s = new C.Sessao({ bus: new C.Bus() });
  var f1 = s.pendenciasParaIniciar();
  ok(f1.length >= 3, "sem nada configurado, deve haver várias pendências");
  var p = s.worklist.adicionar({ nome: "Pronto" });
  s.worklist.selecionar(p.id);
  s.selecionarProtocolo({ nome: "Crânio", kv: "120", mas: "300", modo: "sequencial" });
  s.atualizarMesa({ pacienteNaMesa: true });
  igual(s.pendenciasParaIniciar().length, 0, "com tudo pronto não deve haver pendência");
});

teste("sessão: cortes por reconstrução refletem plano + protocolo", function () {
  var s = new C.Sessao({ bus: new C.Bus() });
  s.selecionarProtocolo({
    nome: "Crânio", kv: 120, mas: 300, modo: "sequencial",
    reconstrucoes: [
      { nome: "Encéfalo", espessuraMm: 5, incrementoMm: 5, kernel: "liso", fovMm: 220, matriz: 512 },
      { nome: "Osso", espessuraMm: 1.25, incrementoMm: 1.25, kernel: "nitido", fovMm: 220, matriz: 512 }
    ]
  });
  var p = s.worklist.adicionar({ nome: "X" });
  s.worklist.selecionar(p.id);
  s.abrirExame();
  s.definirPlano({ inicioMm: 0, fimMm: 150 });
  var c = s.cortesPorReconstrucao();
  igual(c.length, 2);
  igual(c[0].cortes, 30, "150 mm / 5 mm");
  igual(c[1].cortes, 120, "150 mm / 1,25 mm");
});

teste("sessão: exame completo de ponta a ponta, sem navegador", function () {
  var bus = new C.Bus();
  var s = new C.Sessao({ bus: bus });
  var fases = [];
  bus.on(C.EVENTOS.FASE_MUDOU, function (d) { fases.push(d.estado); });

  var p = s.worklist.adicionar({ nome: "Fluxo Completo", prontuario: "QA-1", pesoKg: 70, alturaCm: 172 });
  s.worklist.selecionar(p.id);
  s.selecionarProtocolo({
    nome: "Tórax", regiao: "Tórax", kv: 120, mas: 150, pitch: "1,0",
    colimacao: "64 × 0,6 mm", rotacao: "0,5", modo: "helicoidal",
    reconstrucoes: [{ nome: "Mediastino", espessuraMm: 5, incrementoMm: 5, kernel: "liso", fovMm: 350, matriz: 512 }]
  });
  s.atualizarMesa({ pacienteNaMesa: true, posM: 0.3, alturaM: 0.66, isoOffsetCm: 0 });
  igual(s.pendenciasParaIniciar().length, 0);

  var estudo = s.abrirExame();
  ok(/^2\.25\./.test(estudo.studyUID), "StudyInstanceUID deve usar o ramo 2.25");

  s.mudarFase("scout");
  s.definirPlano({ inicioMm: -150, fimMm: 150, fovMm: 350 });
  s.mudarFase("planejando");
  s.mudarFase("adquirindo");
  s.progresso(0.5);
  s.mudarFase("reconstruindo");

  var serie = M.criarSerie({
    scanRunId: s.scan.id,
    reconstrucao: s.protocolo.reconstrucoes[0],
    dims: [512, 512, M.contarCortes(s.scan.plano, 5)],
    espacamentoMm: [350 / 512, 350 / 512, 5]
  });
  M.adicionarSerie(estudo, serie);
  s.mudarFase("revisao");

  igual(s.scan.medidas.comprimentoMm, 300, "faixa de 300 mm");
  igual(estudo.series.length, 1);
  igual(serie.dims[2], 60, "300 mm / 5 mm = 60 cortes");
  perto(serie.espacamentoMm[0], 0.6836, 1e-3, "pixel = FOV / matriz");
  igual(fases.join(">"), "scout>planejando>adquirindo>reconstruindo>revisao");

  // encerrar preserva o paciente
  s.encerrarExame();
  igual(s.worklist.quantidade(), 1);
  igual(s.worklist.selecionado(), null);
});

// =====================================================================
postMessage({
  total: resultados.length,
  falhas: resultados.filter(function (r) { return !r.ok; }).length,
  resultados: resultados
});
