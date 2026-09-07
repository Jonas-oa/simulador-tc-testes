# PROMPT DE CONTINUAÇÃO — Simulador TC Educacional

> **Para quem é este arquivo.** Você é uma IA assumindo este projeto no lugar de outra que
> parou (crédito esgotado, sessão perdida, troca de ferramenta). Leia este arquivo INTEIRO
> antes de tocar em qualquer código. Ele existe para você conseguir responder, sozinho, a
> três perguntas: **o que é este projeto**, **onde exatamente paramos** e **o que fazer a
> seguir** — sem depender do histórico de conversa, que você não tem.
>
> Última atualização: **07/09/2026** · auditoria master concluída (commit `73083a3`),
> **ETAPAS 1 a 5 concluídas e a 6 em curso** — a rede de segurança está de pé, **os 9 P1
> estão corrigidos**, a interface fala com o núcleo, o protocolo é tipado de ponta a ponta e
> ~860 linhas saíram dos dois monólitos e a camada `ui/` começou. As ETAPAS 6 e 7 **não
> terminaram**: o que falta, e por quê, está no BLOCO 5.

---

# BLOCO 0 — COMO DESCOBRIR ONDE PARAMOS

Faça isto **antes** de ler o resto. São quatro comandos e cinco minutos.

```bash
cd <raiz do projeto>

# 1. Qual foi o último trabalho concluído
git log --oneline -12

# 2. Há trabalho em curso não commitado?
git status --short
git diff --stat

# 3. O checklist do BLOCO 5 deste arquivo está atualizado?
grep -n "^- \[" docs/PROMPT-CONTINUACAO.md

# 4. O app ainda está saudável? (a forma curta, se você tiver node)
node ferramentas/rodar-testes.mjs

#    A forma manual: sirva por HTTP (ES modules e Workers não rodam em file://)
python -m http.server 8777
#    e abra no navegador:
#      http://localhost:8777/testes/core.html       -> 103/103 verde
#      http://localhost:8777/testes/leitor.html     ->  11/11  verde
#      http://localhost:8777/testes/regressao.html  -> ver a leitura abaixo (leva minutos)
#      http://localhost:8777/index.html             -> carrega sem erro no console
```

**Como interpretar:**

| O que você vê | O que significa |
|---|---|
| Checklist do BLOCO 5 com etapas marcadas | Essa é a fonte de verdade. Comece pela primeira etapa não marcada. |
| `git status` limpo, commits novos que o checklist não reflete | Leia as mensagens desses commits — elas dizem o que foi feito e o que foi medido. Atualize o checklist e siga. |
| `git status` com arquivos modificados | Alguém parou no meio. **Não descarte nada.** Leia o `git diff` inteiro, entenda a intenção, termine ou reverta de forma consciente. Este projeto documenta o *porquê* nos comentários — o diff provavelmente explica a si mesmo. |
| `core` ou `leitor` vermelhos | A refatoração quebrou algo. Tem prioridade sobre qualquer tarefa nova. |

**Lendo a suíte de regressão** (`testes/regressao.html`) — ela é diferente das outras duas:
ela afirma o comportamento **correto** dos 9 defeitos P1, então **falhar nela é o esperado**
enquanto o defeito correspondente não for corrigido. O placar tem quatro números:

| Número | Significa |
|---|---|
| **falha(s) esperada(s)** | defeitos P1 ainda não corrigidos. Normal. Não reprova o CI. |
| **inesperada(s)** | regressão de verdade — algo que funcionava quebrou. **Reprova.** |
| **corrigido(s)** | o defeito foi consertado mas o id continua em `PENDENTES` no topo do script. Tire-o de lá. **Reprova** de propósito, para a lista não mentir. |
| **executados** | se for menor que o total, a suíte travou no meio. |

Hoje o esperado é: `11/11 executados · 0 esperadas · 0 inesperadas · 0 corrigidos`.
**A lista `PENDENTES` está vazia** — os nove defeitos P1 da auditoria foram corrigidos.
Daqui em diante, qualquer vermelho nesta suíte é regressão de verdade e reprova o build.

**Uma armadilha que já custou tempo aqui:** não meça o estado da máquina pelos mostradores.
`updateReadouts()` roda dentro do `requestAnimationFrame`, enquanto a física roda no relógio
do núcleo, que tem uma fonte por Worker justamente para não parar quando ninguém está
olhando. Com o documento oculto — iframe fora da tela, CI headless, aba em segundo plano —
**a mesa se move e os mostradores congelam no último valor pintado**. Medido:
`tableGroup.position.y = 0,88 m` com o HUD exibindo "80,0 cm". Um teste do teclado que lia o
HUD acusava defeito onde não havia. Para o usuário real o impacto é pequeno (o mostrador
ressincroniza no primeiro repaint), mas é uma incoerência de verdade e está anotada para a
**ETAPA 9**.

O checklist do **BLOCO 5** é a fonte de verdade sobre o progresso. **Mantenha-o atualizado no
mesmo commit em que fizer o trabalho** — é assim que a próxima IA saberá onde você parou.

---

# BLOCO 1 — O QUE É ESTE PROJETO

Simulador web **educacional** de operação de tomógrafo, para treinar estudantes de Radiologia
em posicionamento de paciente, escolha de protocolo, planejamento de faixa, dose e leitura de
imagem. **Não é dispositivo médico. Não faz diagnóstico.**

- **Stack:** HTML + CSS + JavaScript puro. **Sem framework, sem bundler, sem passo de build.**
  Edita e recarrega. Three.js r128 vendorizado em `js/vendor/`.
- **Empacotamento:** site estático (GitHub Pages) + app Electron opcional (`electron-main.js`).
- **Dados:** IndexedDB local (`simuladorTC` v3), sem backend, sem login, sem rede externa.
- **Idioma:** tudo em português do Brasil — interface, comentários, commits, este documento.

Leitura complementar, nesta ordem:

1. `README.md` — visão geral e histórico de revisões (⚠️ **está desatualizado**, ver BLOCO 6).
2. `docs/PROMPT-EVOLUCAO-10-10.md` — o plano-mestre em 12 fases (0 a 11), com critérios de
   aceite, contratos de física e a rubrica 10/10. **É o documento de referência do produto.**
3. Este arquivo — o estado atual e o plano de correção.

## Invariantes que nunca podem ser violados

1. Nada de finalidade clínica ou diagnóstica. Todo texto de tela reforça isso.
2. Nenhum valor clínico inventado. Onde não houver consenso, o campo diz explicitamente
   *"Valor dependente do equipamento e do protocolo institucional."*
3. Imagens vêm de acervos públicos com licença livre, e o **crédito vem do manifesto do
   próprio volume** (`assets/volumes/<regiao>/manifest.json`). São volumes CC BY: a atribuição
   é obrigação de licença, não texto decorativo.
4. Sem framework, sem bundler. Se você acha que precisa de um, releia o BLOCO 4.
5. Núcleo (`core/`) **não toca no DOM**. É essa a razão de ele rodar dentro de um Worker na
   suíte de testes, e é a prova executável do desacoplamento.

---

# BLOCO 2 — ESTADO EM 07/09/2026

## 2.1 O que já está pronto

| Fase | Estado |
|---|---|
| 0 a 7 | Completas e commitadas |
| 8 — Viewer e MPR | **Quase.** O MPR da tela de aquisição passou a sair da série reconstruída (ETAPA 3). Medidas (distância, ângulo, ROI em HU) e slab (média/MIP/MinIP) prontos no leitor. **Faltam:** reformatação **oblíqua** e ROI **elíptica/poligonal** (a atual é circular). |
| 9 — Protocol Manager | **Completa.** Duplicar, travar, comparar, versionar, exportar/importar, motor de validação — e, desde a ETAPA 5, o protocolo persistido é **tipado**, com unidade e faixa. O critério de aceite (nenhum campo numérico aceita texto livre) está atendido. |
| 10 — Educacional | **1 de 4.** A confirmação informada existe (e é a melhor parte do app), mas `education/` e `engines/` (perfis de fabricante) **não existem**. |
| 11 — Testes/perf | **Parcial.** 114 testes verdes + 10 de regressão (8 verdes, 2 vermelhos de propósito — ver BLOCO 0), rodando em CI desde a ETAPA 1. **Falta:** cobertura medida do `core/`, orçamento de performance verificável e testes de caos além dos dois que a regressão cobre. |

## 2.2 O diagnóstico da auditoria (leia isto com atenção)

Foi feita uma auditoria completa em 07/09/2026 — arquitetura, emendas, dados, segurança,
performance, UX e acessibilidade. **50 achados**, 26 deles medidos no app em execução.

**O código é limpo.** Zero `TODO`/`FIXME`/`HACK` em 19.161 linhas, zero código comentado,
zero segredo exposto, zero XSS, `postMessage` com verificação de origem nos dois lados,
Electron endurecido. Cada correção passada deixou registrado *por que* existe. Não gaste
tempo procurando sujeira: não há.

**O problema é outro: existem duas arquiteturas rodando ao mesmo tempo.**

- `core/` — 18 arquivos, 3.758 linhas, domínio puro sem DOM, **103 testes verdes**.
- `js/` — 7.130 linhas de interface que **reimplementou o mesmo domínio** em closures,
  **sem nenhum teste**.

As duas discordavam em execução. **A ETAPA 4 fechou essa distância**: fase, mesa, plano,
protocolo e progresso passam pelo `Core.sessao`, e o barramento do núcleo virou o único canal
de eventos. O que segue é o retrato de ANTES, guardado porque explica de onde vieram os
defeitos — e porque é o teste de que não voltem:

```
núcleo     sessao.mesa.pacienteNaMesa   false        interface  isPatientOnTable()  true
núcleo     sessao.protocolo             null         interface  examProtocol.name   "Crânio"
núcleo     pendenciasParaIniciar()      ["Selecionar o protocolo.", "Posicionar o paciente na mesa."]
interface  (nunca pergunta)             o exame iniciou assim mesmo
```

Quase todo achado grave sai dessa discordância. **O app funciona, e isso não é evidência de
que está certo** — nenhum dos defeitos abaixo produz exceção no console.

## 2.3 Os 9 defeitos P1 — com âncora e como reproduzir

> Os números de linha valem para o commit `73083a3`. Se já houver commits depois, confirme com
> `grep` antes de editar.

### P1-01 · A confirmação informada aprova exame sem protocolo
- **Onde:** `js/aquisicao.js:1594` — `if (!cru) return null;` dentro de `validarExameAtual()`.
- **O que acontece:** sem protocolo, a validação inteira é pulada. O checklist mostra três
  vistos verdes e o botão fica "Confirmar e iniciar", habilitado. O exame roda com o fantoma
  procedural, sem kV e sem mAs.
- **Reproduzir:** cadastre um paciente, selecione-o, ponha na mesa (Decúbito → Dorsal),
  **não escolha protocolo**, vá em Exame → Iniciar → Mover → Iniciar.
- **Correto:** `Core.sessao.pendenciasParaIniciar()` já devolve a lista exata do que falta.
  Chamá-la e bloquear.

### P1-02 · O tilt do gantry troca de sinal
- **Onde:** `js/aquisicao.js:313` — `match(/\d+(\.\d+)?/)`, **sem `-?`**.
- **Consumidor:** `js/aquisicao.js:825` (`setGantryTilt`), o relatório e a confirmação.
- **O que acontece:** tilt `-15` vira **+15**; o gantry 3D inclina para o lado errado.
  `core/model/protocol.js` lê `-15` corretamente — os dois parsers divergem.
- **Correto:** apagar o `num()` local e usar `Core.model.normalizarProtocolo`.

### P1-03 · Dois DLP contraditórios na mesma tela
- **Onde:** `js/aquisicao.js:1537-1539` (cabeçalho, usa a dose **digitada**) contra
  `js/aquisicao.js:1592` (aviso do validador, usa a dose **calculada**).
- **Medido:** cabeçalho `DLP ≈ 866 mGy·cm`, aviso `DLP ≈ 1370 mGy·cm`, no mesmo exame.
- **Correto:** fonte única — `SimTC.MotorImagem.dose()`. O campo `dose` do protocolo é
  referência exibida, nunca insumo de cálculo (esse era o ponto da Fase 6).

### P1-04 · O exame arquivado guarda números que não são os do exame
- **Onde:** `js/aquisicao.js:1390` (`cortes: manifest.cortes`) e `:1391` (dlp digitado).
- **Medido:** a tela diz "Aquisição concluída (**32** cortes)"; o estudo arquivado grava
  **125** (os cortes do volume-fonte) e `dlp: 866`.
- **Correto:** `MotorImagem.serieAtual().cortes` e `MotorImagem.dose().dlp`.

### P1-05 · O MPR coronal/sagital interno está quebrado
- **Onde:** `js/aquisicao.js:1185` — `var Z = manifest.cortes;` dentro de `buildVolume()`.
- **O que acontece:** o volume do MPR é montado a partir dos PNG **já janelados** (HU reais →
  8 bits → PNG → decode → 256 px), e o laço percorre os cortes do **volume-fonte** (125)
  enquanto `srcFor(z)` satura no último corte da **série** (32). Resultado: ~93 linhas são
  cópias do mesmo corte, e o coronal é uma faixa vertical uniforme.
- **Medido:** slider da tela "Coronal 131 / 261"; `mprApi.count('coronal')` = 256; série real
  256×256×32. Três consumidores, três tamanhos.
- **Correto:** reformatar direto do `Int16Array` que `MotorImagem` já tem, com `pixelMm` e
  `incrementoMm` da série. `dicom-viewer/js/mpr.js` já faz isso certo — **apagar**
  `buildVolume`/`buildReformat` em vez de consertá-los. Ver também `js/aquisicao.js:1361`
  (`planeEl.hidden = !vol`), que esconde o seletor de plano quando o `vol` de 8 bits falha.

### P1-06 · Excluir paciente durante o exame perde o exame em silêncio
- **Onde:** `core/model/patient.js:150` (`remover`) e `js/cadastro-pacientes.js:266`
  (`arquivar` devolve `Promise.resolve(null)` sem seleção).
- **O que acontece:** a tela de aquisição não escuta o barramento, continua na fase em que
  estava e, ao concluir, não arquiva nada — sem mensagem.
- **Correto:** a aquisição assina `EVENTOS.EXAME_ENCERRADO` e aborta com aviso.

### P1-07 · O protocolo persistido continua sendo texto livre
- **Onde:** store `protocolos` do IndexedDB · `index.html:373-394` (`type="text"`).
- **Medido, registro real do protocolo "cranio":**
  `dose: "≈55 mGy (ref.)"` · `espessura: "5,0 mm encéfalo / 1,25 mm osso"` · `fov: "220–250 mm"`.
- O critério de aceite da Fase 9 dizia literalmente que `dose` deixaria de ser
  `"≈55 mGy (ref.)"`. O modelo tipado existe em `core/model/protocol.js`, mas é calculado sob
  demanda e descartado — nunca é o que se grava.

### P1-08 · Os comandos de mesa não funcionam por teclado
- **Onde:** `js/sala-exame.js:1201` — `setHeld()` liga só `pointerdown`/`pointerup`.
- **O que acontece:** subir/descer/entrar/sair são `<button>` (focáveis, anunciados como
  botões), mas Enter e Espaço não fazem nada. É a interação central do app. Falha WCAG 2.1.1.

### P1-09 · Regra de validação inalcançável pelo caminho real
- **Onde:** `core/model/protocol.js:147` zera o pitch no modo sequencial **antes** de
  `core/protocol/validacao.js:53` poder acusá-lo.
- **O que acontece:** a regra "pitch em modo sequencial é ERRO" nunca dispara em produção. O
  protocolo de crânio gravado tem exatamente essa contradição (`pitch 0,55` + `sequencial`) e
  o app exibe os dois lado a lado sem dizer nada.
- **Atenção:** o teste `testes/core.worker.js:881` **passa** porque força o estado à mão — e
  documenta isso num comentário. É um teste verde sobre um caminho que não existe.

## 2.4 Outros achados que você vai encontrar

Resumo do que está classificado abaixo de P1. Não são urgentes, mas saber que existem evita
"descobrir" de novo:

- **P2:** duas arquiteturas paralelas · ~~dois controladores de modo celular ligados aos mesmos
  botões (`js/ui-layout.js:123` e `js/mobile-tabs.js`)~~ *(ETAPA 8)* · a trava do protocolo de referência
  nunca é aplicada (`js/protocolos.js:150`, dentro de um `if` que nunca é verdadeiro) · medidas
  duplicadas (`js/medidas.js` e `dicom-viewer/js/medidas.js`) · dois shells do leitor
  (`app.js` e `app-celular.js`, 12 funções homônimas; o do celular não tem medidas nem slab) ·
  dois monólitos (`aquisicao.js` com 1.766 linhas em uma função; `sala-exame.js` com 1.818) ·
  ~~sem navegação nenhuma abaixo de 900 px após redimensionar~~ *(ETAPA 8)* · 35 scripts clássicos bloqueantes ·
  testes nunca rodam automaticamente · `.git` com 81 MB de volumes.
- **P3:** string de debug na mensagem de boas-vindas (`js/sala-exame.js:1828`, mostra a largura
  da janela ao usuário) · `openAppDB()` abre conexão nova por operação e nunca fecha
  (`js/shared.js:80`) · tema não persiste · estudos órfãos ao excluir paciente · `window.confirm`
  convivendo com o modal próprio · handshake do iframe por polling (`js/mpr.js:52`) ·
  reparenting do canvas WebGL (`js/ui-layout.js:409`) · caminho de imagens morto com revisão
  congelada (`js/aquisicao.js:51-53`) · textos de 9,6 px e contraste 3,2:1 no aviso de uso
  não-clínico e na atribuição CC BY · seis regras `[hidden]{display:none!important}` repetidas.
- **P4:** `SHA256SUMS.txt` obsoleto · `dicom-viewer/datasets/manifest.json` vazio ·
  `script.js.bak` (197 KB, fora do git) · README desatualizado · superfícies de debug
  (`window.__leitor`, `window.__ctSimulator`) expostas em produção.

---

# BLOCO 3 — REGRAS DE TRABALHO DESTE PROJETO

Estas convenções foram conquistadas em cima de erros reais. **Segui-las não é opcional.**

## 3.1 Sempre bumpar a revisão de cache depois de editar

```bash
python ferramentas/bump-rev.py
```

Rode isto **depois de qualquer alteração** em `js/`, `core/`, `css/` ou `dicom-viewer/`. Sem
isso o navegador serve a versão antiga e a sua alteração simplesmente não aparece — sem erro,
sem sinal. Isso já custou várias rodadas de diagnóstico neste projeto; o cabeçalho do script
conta a história das quatro camadas do problema. **Se algo que você mudou "não fez efeito",
a primeira hipótese é cache, não bug.**

## 3.2 Medir, não opinar

Feche cada tarefa com a **saída real** colada na resposta: os testes rodando, o valor medido
no navegador, o número antes e depois. Este projeto tem histórico de correções que pareciam
certas e não eram. Vocabulário de veredito, a usar literalmente:

`ESTÁ TECNICAMENTE COERENTE` · `ESTÁ INCOMPLETO` · `É APENAS SIMULAÇÃO VISUAL` ·
`ESTÁ ERRADO` · `ESTÁ AUSENTE`

## 3.3 Comentários explicam o PORQUÊ, não o quê

O padrão do projeto é registrar, no comentário, **qual falha aquele código evita**. Exemplo
real, de `ferramentas/bump-rev.py`:

> *"O do celular era o pior: celular.html é para onde a própria página do leitor redireciona
> em toque + tela estreita, e um módulo de ENTRADA sem versão congela toda a árvore de imports
> abaixo dele."*

Escreva no mesmo registro. É isso que torna o projeto auditável — e foi isso que permitiu
mapear 50 achados sem o histórico de conversa.

## 3.4 Mensagens de commit

- Assunto: uma frase descritiva do que mudou **para o usuário**, não do arquivo tocado.
  Ex.: `Topograma deixa de sair de cabeca para baixo, e cada regiao ganha faixa propria`.
- Corpo: o problema, por que surgiu, o que foi feito, e **a medição** ao final.
- **Sem acentos** nas mensagens de commit (convenção do repositório).
- Rodapé: `Co-Authored-By: <sua identificação>`.

## 3.5 Antes de excluir qualquer coisa

Verifique se há referência. Na dúvida, **não exclua** — marque como
`POSSÍVEL CÓDIGO MORTO — NECESSITA CONFIRMAÇÃO` e pergunte.

⚠️ **Caso específico:** `js/phantoms.js` (390 linhas) parece morto, mas hoje é o que sustenta
o caminho "iniciar sem protocolo". **Só é seguro removê-lo depois que P1-01 estiver corrigido.**

## 3.6 Ritmo

Trabalhe em passos verificáveis, com o teste de aceite escrito **antes ou junto** do código.
Não misture reorganização, correção de bug e melhoria de UX no mesmo passo. Não faça grandes
reescritas de uma vez. Relate explicitamente o que ficou de fora.

## 3.7 Git

Commits diretos na `main` são a convenção deste repositório (o Pages publica de lá). **Não
faça push sem o usuário pedir.**

---

# BLOCO 4 — A ARQUITETURA ALVO

Deliberadamente conservadora: **manter tudo o que o projeto já decidiu bem** — sem bundler,
sem framework, scripts clássicos, núcleo sem DOM — e completar apenas a camada que falta.
**Não introduza React, TypeScript ou build step.**

```
core/          domínio puro, sem DOM  ── JÁ EXISTE E ESTÁ CERTO
  session.js     estado único — passa a ser realmente usado
  bus.js         canal único de eventos

app/           composição — só liga as peças
  contratos.js   FEITO na ETAPA 4 — quem oferece API declara o contrato, e o
                 boot verifica. Substituiu a guarda `if (SimTC.x)`, que
                 escondia módulo faltando em vez de acusar.
  boot.js        (a fazer) substitui script.js; ordem explícita e verificada

modulos/       uma pasta por setor, com fronteira declarada
  sala/  worklist/  protocolos/  aquisicao/  leitor/

ui/            a camada que hoje NÃO existe
  campo · lista · modal · mensagem · formatar (mm, HU, mGy, decimal pt-BR)

infra/
  db.js          IndexedDB com conexão única e migração versionada
```

**A regra que resolve a maior parte dos achados cabe numa frase:**
*nenhum módulo de tela guarda estado de domínio.* Fase do exame, plano, protocolo vigente e
posição da mesa moram em `core/session.js`; a tela lê, despacha comando e escuta o bus.

---

# BLOCO 5 — O PLANO E O CHECKLIST DE PROGRESSO

> **Mantenha este checklist atualizado no mesmo commit do trabalho.** É por aqui que a próxima
> IA descobre onde você parou. Marque `[x]` só com o teste correspondente verde.

## Bloco fechado A — rede de segurança e correções (etapas 1 a 3)

Elimina os quatro achados urgentes e cria a rede que torna a etapa 4 segura.

- [x] **ETAPA 1 — Rede de segurança** *(pequena)* — concluída em 07/09/2026
  - [x] CI rodando as três suítes a cada push — `.github/workflows/testes.yml` + `ferramentas/rodar-testes.mjs` (Playwright/Chromium headless, com servidor estático próprio)
  - [x] Um teste de regressão por P1, escrito **antes** da correção — `testes/regressao.html`, 10 testes, **todos falhando hoje pelo motivo certo**, cada um com a medição e o `arquivo:linha` do defeito na mensagem
- [x] **ETAPA 2 — Corrigir os P1 sem mexer na estrutura** *(média)* — concluída em 07/09/2026
  - [x] P1-02 sinal do tilt — o parser local foi **removido**; `protocolParams()` virou adaptador sobre `Core.model.normalizarProtocolo`. Um só parser.
  - [x] P1-03 DLP único — nova `dosePrevista()`, usada pelo cabeçalho da confirmação e pelo validador. O campo `dose` do protocolo deixou de ser insumo de cálculo.
  - [x] P1-04a cortes do arquivo vindos da série — `totalCortes()` no lugar de `manifest.cortes`
  - [x] P1-04b DLP do arquivo vindo do motor — nova `doseDoExame()`; o estudo passa a guardar também o `ctdivol`
  - [x] P1-01 confirmação exige protocolo — nova `pendenciasParaIniciar()` na tela, que **pergunta ao núcleo**. Para isso, `protocolos.js` passou a chamar `Core.sessao.selecionarProtocolo()` e `sala-exame.js` a chamar `Core.sessao.atualizarMesa()`: os dois primeiros fios reais entre interface e núcleo.
  - [x] P1-08 teclado no dpad — `setHeld()` ganhou `keydown`/`keyup` para Enter e Espaço, ignorando auto-repetição
  - [x] P1-06 abortar exame ao excluir o paciente — a aquisição assina `EVENTOS.EXAME_ENCERRADO`
  - [x] P1-07 protocolo tipado — feito na ETAPA 5
  - [x] P1-09 pitch em sequencial — feito na ETAPA 5
- [x] **ETAPA 3 — Matar o MPR interno** *(média)* — concluída em 07/09/2026
  - [x] P1-05: `buildVolume`/`buildReformat`/`spacing` apagados (−165 linhas em `js/aquisicao.js`); a reformatação passou para `js/motor-imagem.js`, junto da série, lendo o `Int16Array` com `pixelMm` e `incrementoMm` da própria reconstrução
  - [x] Os três consumidores do coronal passaram a concordar: 256 na tela, 256 na `mprApi`, 256 na série (era 261 / 256 / 256)
  - [x] O sagital deixou de sair deitado — nos dois planos o eixo vertical é o crânio-caudal, com a cabeça em cima; os rótulos de orientação acompanharam
  - [x] `mprApi.exportVolume()` perdeu o caminho de reserva que devolvia HU aproximados por inversa da janela declarando `unidadeHU: true`

## Bloco B — estrutura (etapas 4 e 5)

- [x] **ETAPA 4 — Ligar a interface ao núcleo** *(grande)* — concluída em 07/09/2026
  - [x] **Fase** — `Core.sessao.mudarFase()` passa a guardar o estado do ScanRun. O `CustomEvent("ct:phase")` no `document` **sumiu**: agora há um canal só, o barramento do núcleo. `js/shared.js` traduz o vocabulário do domínio para o da tela (`SimTC.aoMudarFase`), e os três consumidores assinam por lá.
  - [x] **Mesa** — `Core.sessao.atualizarMesa()` chamada do passo de física (limitada a 5×/s), com posição, altura, paciente e desvio do isocentro
  - [x] **Protocolo** — já ligado na ETAPA 2
  - [x] **Plano** — `Core.sessao.definirPlano()` ao semear a caixa, ao fim de cada arraste e ao irradiar
  - [x] **Progresso** — `Core.sessao.progresso()` no topograma e no volume
  - [x] **Contratos** — `app/contratos.js`. Quem oferece a API **declara** o contrato, e a declaração confere os métodos na hora. Ao fim do boot, `script.js` chama `verificar()`. Os quatro contratos (`tableDriveApi`, `examSessionApi`, `mprApi`, `consoleUiApi`) foram definidos pelo que é **realmente consumido**, não pelo que existe no objeto.
  - Fora do contrato de propósito: `SimTC.examProtocol`, que é **dado**, não API — e desde a ETAPA 4 o protocolo do exame também vive em `Core.sessao.protocolo`. A ETAPA 5 decide se ele continua existindo.
- [x] **ETAPA 5 — Protocolo tipado de ponta a ponta** *(grande)* — concluída em 07/09/2026
  - [x] **P1-07** — o registro no IndexedDB **é** o modelo tipado: `kv: 120` (número), `fovMm: 450`, `colimacao: {nDetectores, larguraMm, totalMm}`. A tela ganhou camada de apresentação: `fillFields` formata, `doFormulario` lê de volta.
  - [x] **P1-09** — `normalizarProtocolo` registra `aquisicao.pitchIgnorado` quando um pitch é declarado em sequencial. O valor continua fora da física; a incoerência deixou de ser apagada, e `PITCH_EM_SEQUENCIAL` passa a disparar pelo caminho real.
  - [x] **Migração idempotente e versionada** — `esquema: 2` no registro. Sem a versão, um banco convertido por uma build intermediária ficava a meio caminho para sempre.
  - [x] **Campos numéricos com unidade** — `input[type=number]` com faixa; colimação virou dois campos; kernel virou `select`; **o campo de dose saiu do editor** (ela é calculada).
  - [x] **A trava do protocolo de referência funciona** — o crânio nasce e permanece `bloqueado`. Antes, `p.bloqueado = true` estava dentro de um `if (isClinicallyBlank)` falso justamente para ele.
  - [x] **Um só parser** — `paraPlano` removida; gestor do núcleo e tela na mesma forma.
  - Atenção ao editar: `mostrar()` devolve decimal com **ponto**, porque `input[type=number]` rejeita vírgula em silêncio. A vírgula é só para exibir em texto.

## Bloco C — qualidade (etapas 6 a 10)

- [~] **ETAPA 6 — Quebrar os dois monólitos** *(muito grande — EM CURSO)*
      Regra seguida em todas as extrações: **o que se CONSTRÓI sai; o que se COMANDA fica.**
      Geometria e som não guardam estado; fase, física e posicionamento sim.
  - [x] `js/sala/cenario.js` (269 linhas) — piso, paredes, teto, porta, janela, mobília
  - [x] `js/sala/gantry.js` (185) — corpo, bore, anéis, arco de varredura
  - [x] `js/sala/paciente.js` (207) — corpo, avental, membros
  - [x] `js/aquisicao/som.js` (78) — WebAudio, sem relação com a tela
  - [x] `js/aquisicao/painel.js` (123) — painel de etapas e de parâmetros
  - [x] `SimTC.esc` movido para `js/shared.js` — havia duas cópias com coberturas diferentes
  - [ ] **O que falta, e por quê:** `js/sala-exame.js` (1.377) ainda junta física da mesa,
        lasers, controles, UI de decúbito e o laço de render; `js/aquisicao.js` (1.811) ainda
        junta a máquina de fases, o arraste da caixa do topograma, o relatório e a
        confirmação. Essas partes **compartilham estado mutável em closure** (`tableZ`,
        `autoDrive`, `phase`, `boxState`), e separá-las não é recorte: é decidir quem passa a
        ser dono de cada estado. Trabalho da ETAPA 7, quando a camada `ui/` definir as
        fronteiras — não force antes disso.
- [~] **ETAPA 7 — Camada `ui/` e fim das duplicações** *(grande — EM CURSO)*
  - [x] `js/ui/formatar.js` — **como este app escreve número, num lugar só.** Havia 31 `toFixed()` espalhados por três arquivos, e `toFixed` devolve PONTO: o app, que é em português, dizia "CTDIvol 87.0 mGy" ao lado de um painel que dizia "0,6 mm". Agora é uma convenção, com unidade junto e travessão para valor ausente.
  - [x] `js/ui/confirmar.js` — **uma confirmação só para o que não se desfaz.** Irradiar tinha modal próprio; excluir paciente e apagar exame usavam `window.confirm`. As duas ações irreversíveis usavam o mecanismo mais pobre. O novo diálogo diz o que se perde, o foco começa em Cancelar e Esc/clique fora cancelam.
  - [x] `SimTC.esc` — feito na ETAPA 6.
  - [x] **Medidas duplicadas: decidido NÃO unificar.** `dicom-viewer/` é cópia vendorizada de outro repositório (Jonas-oa/Leitor-Dicon), com licença e README próprios, e não referencia nada fora da própria pasta. Unificar exigiria acoplá-lo ao `core/` e impediria ressincronizar com o upstream. A razão está escrita nos dois arquivos, para ninguém "consertar" por engano.
  - [ ] `js/ui/campo.js` e `js/ui/lista.js` — a camada de componente propriamente dita. Campo, lista e item ainda são HTML string montado em cada módulo.
  - [ ] **Shell do leitor** — `app.js` (581) e `app-celular.js` (533) têm 12 funções homônimas, e o do celular não recebeu medidas nem slab. É trabalho DENTRO da pasta vendorizada: `comum.js` já existe para o que é compartilhado, e é para lá que essas funções devem ir.
  - [ ] `window.prompt` em `js/protocolos.js` (nomear cópia, nomear protocolo novo) — precisa de um modal de ENTRADA, que o `confirmar.js` não cobre.
- [x] **ETAPA 8 — Um controlador de layout** *(média — FEITA)*
  - [x] **Um controlador só.** Havia DOIS ligados aos mesmos quatro botões — `initMobileMode`
        em `js/ui-layout.js` e `js/mobile-tabs.js` —, com lógicas diferentes: um persistia a
        escolha, o outro não; um marcava `is-active` em dois botões, o outro nos quatro; e o
        segundo chegava a chamar `mobileToggle.click()` por código. O resultado dependia da
        ordem das tags `<script>`. Agora é `initModoDeLayout()`, e `js/mobile-tabs.js` deixou
        de existir.
  - [x] **O app nunca fica sem navegação** — a invariante da etapa. Abaixo de 901 px o CSS
        escondia a barra de etapas, e nada ligava o modo celular ao redimensionar: ele só era
        decidido na CARGA. Quem estreitava a janela ou girava o tablet caía num app com
        painéis empilhados e NENHUMA navegação (defeito U-02 da auditoria). Hoje o modo se
        reavalia a cada `resize`, a barra de etapas continua visível em tela estreita (rola na
        horizontal), e `isDesktop()` virou `podeUsarConsole()` — deixou de exigir 901 px, que
        era o que deixava o operador sem saída ao sair do modo celular numa tela estreita.
  - [x] **Uma guarda `[hidden]` só.** `[hidden] { display: none !important; }` no topo do
        `css/style.css`, no lugar de seis repetições componente a componente, em quatro
        trechos diferentes do arquivo.
  - [x] **Uma manobra de empréstimo só.** Dois pedaços mudam de pai conforme a etapa (o
        viewport 3D e a barra de comandos da sequência), e a manobra estava escrita duas
        vezes, guardando o endereço de casa como REFERÊNCIA AO IRMÃO SEGUINTE — o que quebra
        com `NotFoundError` no dia em que alguém mexer no container de origem. Agora é
        `emprestar(el, nome)`, com âncora de comentário: invisível, nossa, e não conta em
        `:nth-child`.
  - [x] **E-06 (parar de reparentar o canvas WebGL): medido e MANTIDO como está.** Seis idas e
        voltas entre Sala e Exame, no Chromium: `webglcontextlost: 0`, `isContextLost(): false`,
        canvas reajustado a cada troca (1769×907 ↔ 396×381), cena desenhando. Trocar por um
        canvas fixo rastreando o retângulo de um slot custaria sincronizar posição, rolagem e
        empilhamento à mão — mais superfície de erro do que a de hoje, para consertar algo que
        não está quebrado. A medida está escrita em `js/ui-layout.js`, junto do código.
- [ ] **ETAPA 9 — UX e acessibilidade** *(média — muitos itens independentes)*
      Acrescentar aos itens da auditoria: os mostradores (HUD, display do console, isocentro)
      congelam quando o documento fica oculto, porque `updateReadouts()` mora no
      `requestAnimationFrame` e a física não. Ver o BLOCO 0.
      Achados da ETAPA 8, que são de UX e não de layout: (a) `#viewport-loading` continua no
      DOM depois que a cena carrega — some por `opacity: 0`, não por `hidden` —, de modo que
      um leitor de tela segue anunciando "Inicializando cena 3D…" para sempre; (b) os valores
      iniciais do HUD no `index.html` ainda são "000.0" e "80.0", com PONTO, e só passam a
      respeitar a convenção de `js/ui/formatar.js` no primeiro repaint.
- [ ] **ETAPA 10 — Limpeza** *(pequena)* — código morto, volumes para fora do git, README

## Depois do plano: voltar ao roteiro do produto

Com a base sã, retomar `docs/PROMPT-EVOLUCAO-10-10.md`: fechar a **Fase 8** (reformatação
oblíqua, ROI elíptica/poligonal) e abrir a **Fase 10** (`education/` e `engines/`).

---

# BLOCO 6 — RISCOS E ARMADILHAS CONHECIDAS

| Onde | O que pode dar errado |
|---|---|
| **Cache** | Sua alteração "não faz efeito". Rode `python ferramentas/bump-rev.py` e recarregue. O `index.html` é o elo fraco: por ser o documento de entrada, não pode versionar a si mesmo — no Pages leva até 10 min para atualizar. |
| **Etapa 4** | A ordem de boot em `script.js` é uma dependência oculta, e toda leitura é defensiva (`if (SimTC.x)`) — uma ordem errada não dá erro, some uma funcionalidade em silêncio. |
| **Etapa 5** | Migração de IndexedDB roda em máquinas de alunos. Idempotente, e o importador precisa aceitar os dois formatos. |
| **Etapa 6** | As closures compartilham dezenas de variáveis. Extrair antes da etapa 4 gera passagem de estado por parâmetro sem fim. |
| **Etapa 8** | Três modos de layout e 9 breakpoints ad-hoc. Qualquer mudança de classe no `<body>` tem efeito difuso no CSS. |
| **Fantoma** | Ver 3.5: não remova `js/phantoms.js` antes de P1-01. |
| **Testes lentos** | O volume de tronco tem 37,7 MB (67,2 MB em memória). Considere um volume sintético pequeno para o fluxo completo em CI. |
| **README** | `README.md` ainda anuncia "Aquisição do exame — a grande próxima etapa" (feita nas Fases 4-6) e promete controle de versão via service worker (não existe). Não confie nele para saber o estado; confie neste arquivo e no `git log`. |

---

# BLOCO 7 — O QUE NÃO DEVE SER ALTERADO

Este projeto acertou coisas difíceis. Nenhuma delas deve ser tocada durante a reorganização.

1. **O núcleo sem DOM rodando dentro de um Worker de teste.** É a prova executável de que o
   domínio não depende de tela, e o alicerce do plano inteiro.
2. **O motor de validação e o texto das consequências.** Explicar *por que* pitch alto em
   crânio é ruim, com a consequência quantificada, é a melhor coisa do app. Corrija o que o
   impede de rodar; não o reescreva.
3. **O congelamento do protocolo durante o exame.** Correto e realista.
4. **A seleção explícita do paciente** e o encerrar que arquiva em vez de apagar.
5. **A física da mesa** — limites de curso e altura, bloqueio dos comandos durante a aquisição,
   posicionamento automático antes da varredura. Foi conquistada bug a bug.
6. **O crédito vindo do manifesto do volume.** É conformidade de licença CC BY.
7. **O writer DICOM conformante** e a exportação em ZIP sem dependência.
8. **O processo de revisão de cache** (`ferramentas/bump-rev.py`) — quatro camadas conquistadas
   em cima de falhas reais.
9. **Os comentários que explicam o porquê.** Mantenha a densidade e o estilo no código novo.

---

# BLOCO 8 — VEREDITO DA AUDITORIA

**Reorganização arquitetural dirigida — não reescrita, e mais do que ajustes.**

A arquitetura correta já foi escrita: o núcleo em `core/` é bem desenhado, testado, e resolve
exatamente os problemas que a interface resolve de novo, pior. **Não falta projeto — falta
ligação.** Reescrever jogaria fora 3.758 linhas de domínio correto para reproduzi-lo;
continuar emendando manteria duas verdades sobre o mesmo exame, que é a causa comum de 6 dos
9 P1.

**A pergunta de ouro** — *se um técnico experiente em TC usasse isto agora, acreditaria estar
operando uma plataforma coerente de aquisição?*

**Em parte.** A sala, a mesa, o topograma, o planejamento da faixa, o congelamento do protocolo
e — acima de tudo — a confirmação informada com protocolo válido resistem ao olhar de quem
opera. Ele acreditaria. Mas perderia a confiança em três lugares: ao ver o gantry inclinar para
o lado errado, ao abrir o coronal, e ao comparar os dois DLP na mesma tela. São três defeitos
localizados numa plataforma que, no resto, está coerente.

---

# BLOCO 9 — COMO FECHAR A SUA SESSÃO

Antes de parar — por escolha ou por falta de crédito — deixe o terreno pronto para o próximo:

1. Rode as duas suítes e **cole a saída real** na sua última mensagem.
2. Atualize o checklist do **BLOCO 5** e a data no topo deste arquivo.
3. Commite o que estiver pronto. Se algo ficou pela metade, **diga no corpo do commit
   exatamente onde parou e qual era a próxima ação** — é o que a próxima IA vai ler primeiro.
4. Se houver trabalho não commitável, deixe-o na árvore e descreva-o aqui, no BLOCO 5.
5. Relate explicitamente o que ficou de fora.
