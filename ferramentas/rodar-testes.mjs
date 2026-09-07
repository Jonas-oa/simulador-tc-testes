/**
 * ferramentas/rodar-testes.mjs
 *
 * Roda as tres suites do projeto num navegador headless e devolve codigo de
 * saida diferente de zero se alguma reprovar. E o que o CI executa.
 *
 * Existe porque as suites sao PAGINAS, nao arquivos de teste de um runner:
 *
 *   testes/core.html      o nucleo roda dentro de um Web Worker — e essa e
 *                         justamente a prova de que core/ nao toca no DOM.
 *   testes/leitor.html    os modulos do leitor sao ES modules e precisam de
 *                         um documento para serem importados.
 *   testes/regressao.html dirige o app de verdade dentro de um iframe.
 *
 * Nenhuma delas roda em Node puro, e converte-las para isso jogaria fora
 * exatamente a garantia que elas dao. Entao o runner abre as paginas num
 * Chromium e le o objeto de resultado que cada uma publica em window.
 *
 * Uso:
 *   node ferramentas/rodar-testes.mjs [url-base]
 *
 * Sem argumento, sobe um servidor estatico proprio na porta 8777. Com
 * argumento, usa o servidor ja em pe (util no desenvolvimento local):
 *   node ferramentas/rodar-testes.mjs http://localhost:8777
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const SUITES = [
  { arquivo: "testes/core.html",      global: "__RESULTADO_TESTES__",    rotulo: "nucleo",     timeoutMs: 120000 },
  { arquivo: "testes/leitor.html",    global: "__RESULTADO_LEITOR__",    rotulo: "leitor",     timeoutMs: 120000 },
  // A regressao carrega um volume de TC e reconstroi um exame inteiro.
  { arquivo: "testes/regressao.html", global: "__RESULTADO_REGRESSAO__", rotulo: "regressao",  timeoutMs: 900000 },
];

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".gz":   "application/gzip",
  ".ico":  "image/x-icon",
  ".md":   "text/markdown; charset=utf-8",
};

/** Servidor estatico minimo — evita depender de python no ambiente do CI. */
function servir(porta) {
  const s = createServer(async (req, res) => {
    try {
      const semQuery = decodeURIComponent(req.url.split("?")[0]);
      const rel = semQuery === "/" ? "/index.html" : semQuery;
      const alvo = path.join(RAIZ, rel);
      // Nao servir nada fora da raiz do projeto.
      if (!alvo.startsWith(RAIZ)) { res.writeHead(403).end(); return; }
      const dados = await readFile(alvo);
      res.writeHead(200, {
        "Content-Type": TIPOS[path.extname(alvo).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(dados);
    } catch {
      res.writeHead(404).end("nao encontrado");
    }
  });
  return new Promise((ok) => s.listen(porta, () => ok(s)));
}

function linha(r) {
  return `    ${r.ok ? "✓" : "✗"} ${r.nome}${r.erro ? "\n        " + String(r.erro).replace(/\n/g, "\n        ") : ""}`;
}

async function main() {
  const baseArg = process.argv[2];
  let servidor = null;
  let base = baseArg;

  if (!base) {
    servidor = await servir(8777);
    base = "http://localhost:8777";
    console.log(`servidor estatico em ${base}`);
  }

  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  let reprovou = false;

  for (const suite of SUITES) {
    const pagina = await contexto.newPage();
    const erros = [];
    pagina.on("pageerror", (e) => erros.push(String(e)));

    const url = `${base}/${suite.arquivo}`;
    process.stdout.write(`\n── ${suite.rotulo}  ${url}\n`);
    const t0 = Date.now();

    let dados = null;
    try {
      await pagina.goto(url, { waitUntil: "load", timeout: 60000 });
      await pagina.waitForFunction(
        (g) => {
          const d = window[g];
          // A regressao publica resultados parciais enquanto roda; so vale
          // quando ela mesma se declara completa.
          return d && (d.completo === undefined || d.completo === true || d.erroSuite);
        },
        suite.global,
        { timeout: suite.timeoutMs, polling: 1000 }
      );
      dados = await pagina.evaluate((g) => window[g], suite.global);
    } catch (e) {
      console.log(`    tempo esgotado ou falha ao carregar: ${e.message}`);
      reprovou = true;
      await pagina.close();
      continue;
    }

    const seg = ((Date.now() - t0) / 1000).toFixed(0);
    const falhas = dados.falhas || 0;
    const total = dados.total || 0;
    const passou = total - falhas;

    if (dados.erroSuite) {
      console.log(`    a suite nao terminou: ${dados.erroSuite}`);
      reprovou = true;
    } else if (suite.global === "__RESULTADO_REGRESSAO__") {
      console.log(
        `    ${dados.executados}/${dados.total} executados  ` +
        `${dados.esperadas} falha(s) esperada(s)  ` +
        `${dados.inesperadas} inesperada(s)  ${dados.corrigidas} corrigido(s)  (${seg}s)`
      );
    } else {
      console.log(`    ${passou}/${total} testes  ${falhas ? falhas + " falha(s)" : "tudo verde"}  (${seg}s)`);
    }

    for (const r of dados.resultados || []) if (!r.ok) console.log(linha(r));
    if (erros.length) {
      console.log("    erros de pagina:");
      for (const e of erros) console.log("      " + e);
    }
    if (falhas > 0) reprovou = true;
    await pagina.close();
  }

  await navegador.close();
  if (servidor) servidor.close();

  console.log(`\n${reprovou ? "REPROVADO" : "APROVADO"}\n`);
  process.exit(reprovou ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
