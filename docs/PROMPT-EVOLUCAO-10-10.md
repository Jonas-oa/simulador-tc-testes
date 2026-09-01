# Simulador TC Educacional — Prompt de Evolução para 10/10

Documento operacional. Não é documentação do que existe: é o **roteiro de execução**
para transformar a plataforma atual (auditada em 2026-08-29) num simulador de TC
tecnicamente defensável.

**Como usar**

1. Cole o **Bloco A** no início de cada sessão (ou salve como `CLAUDE.md` na raiz).
2. Cole **um bloco de fase por sessão**, na ordem. Não pule fases — as dependências
   são reais.
3. Cada fase só é dada por concluída quando o **critério de aceite** passar. O critério
   é executável, não uma opinião.

---

# BLOCO A — CONTEXTO PERMANENTE

> Cole isto no início de toda sessão de trabalho no simulador.

## A.1 Papel

Você é engenheiro de software sênior **e** especialista em tomografia computadorizada,
trabalhando num simulador educacional de TC para estudantes de Radiologia. Você domina:
arquitetura de software, física de TC, protocolos de aquisição, reconstrução de imagem,
o padrão DICOM, MPR, dosimetria e o fluxo de trabalho de uma sala de TC.

Idioma de trabalho e de interface: **português do Brasil**.

## A.2 Invariantes do produto (nunca violar)

1. **Uso exclusivamente educacional.** A plataforma treina *operação de equipamento e
   posicionamento*. Não interpreta exames, não sugere diagnóstico, não orienta conduta
   clínica. Todo texto de saída preserva esse enquadramento.
2. **Nada de valor físico inventado.** Todo número apresentado como grandeza física tem
   uma de três origens declaradas: (a) fórmula com referência citada, (b) valor de
   referência publicado com fonte, (c) **modelo educacional aproximado** — e neste caso
   a interface diz isso explicitamente.
3. **Não copiar interface proprietária.** Conceitos, parâmetros, terminologia e fluxos de
   Philips, Siemens e Canon podem ser usados; a identidade visual e a nomenclatura de
   marca, não. Onde os fabricantes divergem, a plataforma **explica a divergência** em vez
   de escolher um comportamento único e silenciar o resto.
4. **Sem dados de paciente reais identificáveis.** Só datasets públicos anonimizados com
   licença compatível, com atribuição visível na interface.
5. **Arquitetura correta acima de solução rápida.** Se a estrutura atual impedir a
   implementação correta, diga isso e proponha a refatoração — não faça remendo.

## A.3 Estado medido da plataforma (baseline da auditoria, 2026-08-29)

Estes fatos foram **medidos em execução**, não inferidos. Use-os como ponto de partida;
não gaste sessão redescobrindo.

**O que já é tecnicamente coerente — preservar**

- Sala 3D, gantry (bore Ø 80 cm), mesa (curso 200 cm), isocentro a 80 cm do piso.
- Intertravamento de altura 64–88 cm para entrada no gantry.
- Laser de posicionamento com desligamento automático em 40 s.
- Sincronia real entre avanço da mesa 3D e revelação do topograma
  (medido: 15,0 cm/s vertical; 100 mm/s no scout).
- Aviso de desvio de isocentro > 4 cm com justificativa de magnificação.
- O leitor DICOM em `dicom-viewer/` é sólido: parser DICOM real, volume canônico LPS,
  ordenação por `ImagePositionPatient`, detecção de aquisição oblíqua, janelamento por
  LUT, crosshair, renderização volumétrica 3D.

**O que está quebrado ou é apenas visual — corrigir**

| ID | Achado | Evidência medida |
|----|--------|------------------|
| B-01 | Três módulos mortos: `cadastro-pacientes.js`, `protocolos.js`, `mpr.js` têm a linha `function X() {` duplicada, criando um wrapper vazio. `init()` não executa nada. | `examSessionApi: null`, `#pac-list` e `#proto-list` com 0 filhos, status MPR travado |
| B-02 | Parâmetros inertes: kV, mAs, espessura, kernel, FOV e matriz não afetam nada. | kV 120→80, mAs 300→30, espessura 5,0→0,625 mm, FOV 220→500 mm: imagem **byte-idêntica** |
| B-03 | Não existe reconstrução. "Reconstruir" relê os mesmos PNG. | Faixa 59% (177 mm) e 40% (120 mm) → **60 cortes nas duas** |
| B-04 | Pixel spacing errado por fator 2. Volume subamostrado 512→256 sem corrigir o espaçamento. | Crânio exportado com **110 mm** de largura em vez de 220 mm |
| B-05 | HU falsos declarados verdadeiros. Payload envia `unidadeHU: true`. | Faixa exportada **−160 a +223 HU** (TC real: −1024 a +3071) |
| B-06 | Presets de janela sem dado que os suporte. | Pulmão (C−600/L1500): brilho médio 211,8 (estourado). Osso (C400/L1800): média 57 (esmagado) |
| B-07 | MPR sem anatomia no eixo Z: o fantoma é pilha de cortes quase idênticos. | Coronal/sagital saem como borrão esticado |
| B-08 | Movimento não comandado da mesa: comando manual segurado durante a aquisição fica *latched* e retoma sozinho ao fim do scan. | Mesa arrancou **360 mm em 0,7 s** sem ação do operador |
| B-09 | Corrida no handshake `postMessage` com o iframe do leitor: a mensagem `ready` se perde na primeira carga. | Status fica em "Aguardando o leitor…" até recarregar o iframe |
| B-10 | Sem seleção de paciente: o último cadastrado vira o do exame, silenciosamente. `Stop` **apaga** o registro. | Cadastrar 2º paciente sequestra o exame sem aviso |
| B-11 | Beco sem saída no estado inicial: mesa retraída + protocolo padrão caudo-cranial → topograma não inicia. | "Curso da mesa insuficiente", sem orientação de recuperação |
| B-12 | Tilt de gantry é puramente visual. Não altera geometria de corte. | Confirmado no código e na saída |
| B-13 | XSS armazenado provável: nome do paciente interpolado em `innerHTML` em `buildReport()` e `buildConfirm()`. | Vetor identificado no código; confirmação ao vivo pendente |
| B-14 | Física acoplada ao loop de render: toda a simulação roda em `requestAnimationFrame`. | Aba oculta / canvas sem pintura → aquisição congela |
| B-15 | Campos de protocolo são texto livre sem tipagem nem validação. | `dose: "≈55 mGy (ref.)"` é lido por regex |
| B-16 | `.gitignore` exclui `package.json` e `package-lock.json`. | Configuração do electron-builder fora do versionamento |
| B-17 | Mapeamento de região só cobre Crânio e Tórax. | Abdome, Pelve, Coluna e Membros exibem um **crânio** |
| B-18 | **A anatomia de interesse nunca entra no gantry.** O corpo é modelado com a cabeça em z local +0,76 (lado oposto ao gantry). Com 2,0 m de curso, a cabeça alcançava no máximo z = −0,34, parando **26 cm antes** do isocentro (z = −0,6). O que passava pelo plano de corte num "exame de crânio" era o tórax superior. | Cabeça em z = +1,66 com a mesa recuada; `alcança isocentro = false` |
| B-19 | **Cabeça primeiro / pés primeiro invertidos.** "Entrada" designa a extremidade que entra PRIMEIRO no gantry; o `yaw` estava mapeado ao contrário. | Com "DORSAL / CABEÇA" a cabeça apontava para +Z, afastando-se do gantry |
| B-20 | **Não existe lista de exames realizados.** Terminado o exame, não há como revê-lo nem editá-lo — e o `Stop` ainda apagava o paciente. Falta o repositório de estudos e a tela que o mostra. | Nenhuma persistência de `Study`; só um exame por vez, sem histórico |

> B-18, B-19 e B-20 vieram do **operador** (revisão de 30/08/2026), não da auditoria
> automatizada — são exatamente o tipo de erro que só aparece para quem conhece o
> fluxo real da sala. B-18 e B-19 têm a mesma raiz e foram corrigidos juntos na
> Fase 1. B-20 é entregável da Fase 1.

## A.4 Estilo de trabalho

- Estudar o arquivo antes de editar. Edições cirúrgicas: preservar nomes de função, IDs
  do HTML, chaves de banco e nomes de variáveis existentes.
- Antes de mudança grande, explicar o plano e aguardar confirmação.
- Validar antes de entregar: sintaxe (`node --check`), IDs conferidos no HTML, teste
  automatizado da fase passando.
- Ao final de cada sessão, declarar explicitamente o que **não** foi feito e por quê.
- Não elogiar o sistema. Se algo estiver errado, dizer "ESTÁ ERRADO" e mostrar a medição.

---

# BLOCO B — FASES

Ordem de dependência. A numeração é sequência real, não decoração.

| Fase | Nome | Desbloqueia |
|------|------|-------------|
| 0 | Estabilização | tudo |
| 1 | Núcleo de domínio e relógio determinístico | 2–11 |
| 2 | Acervo de imagens públicas | 3 |
| 3 | Fantoma volumétrico em HU | 4, 5, 8 |
| 4 | Motor de aquisição (projeções + ruído) | 5, 6 |
| 5 | Motor de reconstrução (FBP) | 6, 8, 9 |
| 6 | Dose | 9, 10 |
| 7 | DICOM de saída | 8 |
| 8 | Viewer e MPR completos | 10 |
| 9 | Protocol Manager e biblioteca | 10 |
| 10 | Camada educacional e perfis de fabricante | 11 |
| 11 | Testes, performance, empacotamento | — |

---

## FASE 0 — Estabilização

**Objetivo.** Deixar a plataforma atual íntegra e versionada antes de qualquer evolução.
Nenhuma funcionalidade nova.

**Entregáveis**

1. Corrigir B-01: remover a linha `function X() {` duplicada e a chave `}` extra
   correspondente em `js/cadastro-pacientes.js`, `js/protocolos.js` e `js/mpr.js`.
2. Corrigir B-08: ao iniciar `autoDrive` em `js/sala-exame.js`, zerar
   `moveUp/moveDown/moveIn/moveOut`. Comando manual exige nova pressão após o scan.
3. Corrigir B-09: o iframe passa a anunciar `ready` de forma idempotente — o pai envia
   um `ct-simulator:hello` no `load` e o filho responde; ou o filho reenvia `ready` a
   cada 250 ms até receber confirmação, com teto de 10 tentativas.
4. Corrigir B-13: substituir interpolação em `innerHTML` por construção de nós com
   `textContent` em `buildReport()` e `buildConfirm()`. Adicionar um teste que cadastra
   um paciente com nome `<img src=x onerror=...>` e verifica que nenhum elemento é criado.
5. Corrigir B-11: quando o curso for insuficiente, a mensagem passa a dizer **qual**
   ação recupera ("Avance a mesa para dentro do gantry antes de iniciar um scout
   caudo-cranial") e o botão de comando correspondente ganha realce.
6. Corrigir B-16: remover `package.json` e `package-lock.json` do `.gitignore` e
   versioná-los.
7. Atualizar `README.md`: a seção de estrutura ainda descreve `script.js` como
   "TODO o código JS" e lista pastas inexistentes.
8. Commitar a refatoração modular que hoje está apenas como arquivos não rastreados.

**Critério de aceite**

- Com o app carregado: `SimTC.examSessionApi`, `SimTC.tableDriveApi`, `SimTC.consoleUiApi`
  e `SimTC.mprApi` são todos não-nulos; `#pac-list` e `#proto-list` renderizam.
- O status do MPR sai de "Aguardando o leitor…" na **primeira** carga, sem recarregar.
- Teste do latch: iniciar `tableDriveApi.start()`, segurar `btn-table-in` durante o
  movimento, soltar depois do fim — deslocamento não comandado após o `onDone` = **0 mm**.
- Teste de XSS passa.
- `git status` limpo.

---

## FASE 1 — Núcleo de domínio e relógio determinístico

**Objetivo.** Separar o *domínio* (o que é um exame de TC) da *apresentação* (DOM, Three.js).
Sem isso, nenhum parâmetro consegue ter efeito real.

**Entregáveis**

1. Criar `core/` com módulos sem nenhuma dependência de DOM ou Three.js:

```
core/
  clock.js         relógio de simulação com passo fixo
  bus.js           barramento de eventos tipado
  state.js         store único, imutável por transição
  model/
    patient.js     Patient  { id, nome, prontuario, sexo, idadeAnos, pesoKg, alturaCm, ... }
    study.js       Study    { studyUID, dataHora, indicacao, series[] }
    series.js      Series   { seriesUID, tipo, params, imagens[] }
    protocol.js    Protocol (esquema da secção C.2)
    plan.js        AcquisitionPlan { rangeStartMm, rangeEndMm, fovMm, tiltDeg, direcao }
    scanrun.js     ScanRun  { estado, progresso, eventos[] }
```

2. **Relógio de passo fixo, desacoplado do render** (corrige B-14). Acumulador com
   `dt` fixo de 1/120 s; a fonte do tique é `requestAnimationFrame` **quando a página
   pinta** e um `Worker` com `setInterval` como fallback quando não pinta. A física nunca
   depende de o canvas estar visível.

3. Substituir os ponteiros ad-hoc (`SimTC.tableDriveApi`, `SimTC.examSessionApi`,
   `SimTC.examProtocol`, `SimTC.consoleUiApi`, `SimTC.mprApi`) por eventos no barramento.
   Manter os nomes antigos como *adapters* finos durante a transição, para não quebrar
   o que já funciona.

4. Corrigir B-10: introduzir **worklist**. O paciente do exame é *selecionado*
   explicitamente, nunca inferido por "último cadastrado". `Stop` encerra o exame e
   **preserva** o registro; excluir é ação separada e confirmada.

5. Adicionar ao paciente `pesoKg` e `alturaCm` (necessários para dose na Fase 6).

6. Corrigir B-19 e B-18 (mesma raiz): a "entrada" passa a designar a extremidade
   que entra PRIMEIRO no gantry, e a anatomia de interesse precisa **alcançar o
   isocentro** dentro do curso da mesa. Compensar o espelhamento lateral que o
   giro de 180° introduz — decúbito é propriedade do paciente, não da entrada.

7. Corrigir B-20: repositório de estudos (`core/model/exam.js` já define `Study`
   e `Series`) persistido em IndexedDB, mais a tela **Exames realizados**, com
   reabrir e editar. Encerrar um exame passa a arquivá-lo, não descartá-lo.

**Critério de aceite**

- Teste headless em Node: importar `core/` e rodar um exame completo (paciente →
  protocolo → plano → scan) **sem navegador**. Se `core/` importar `document` ou `THREE`,
  a fase falhou.
- Teste do relógio: com `requestAnimationFrame` inibido, um scan de 10 s de simulação
  completa em 10 s ± 5%.
- Cadastrar dois pacientes não altera o exame em curso.
- Com "cabeça primeiro", a cabeça alcança o isocentro dentro do curso da mesa; com
  "pés primeiro", os pés. Em ambos, o decúbito lateral direito mantém o paciente
  sobre o lado direito.
- Encerrar um exame o mantém recuperável na lista de exames realizados.

---

## FASE 2 — Acervo de imagens públicas

**Objetivo.** Substituir o fantoma procedural por **volumes de TC reais, anonimizados e
licenciados**, que serão a verdade-base sobre a qual o simulador passa a "escanear".

Esta fase vem antes do fantoma volumétrico porque a fonte define o que é possível.

### B.2.1 Critérios de seleção

Um dataset só entra no acervo se atender a **todos**:

1. Licença explícita e compatível com o uso pretendido (ver B.2.3).
2. Anonimização já realizada pela fonte, e **reconferida** por você.
3. Cortes contíguos, espaçamento regular, aquisição não oblíqua.
4. Espessura ≤ 3 mm (para permitir reformatação decente).
5. Metadados presentes: `PixelSpacing`, `SliceThickness`, `ImagePositionPatient`,
   `ImageOrientationPatient`, `RescaleSlope`, `RescaleIntercept`.
6. Anatomia normal ou achado irrelevante para o treino de operação. **O simulador não
   ensina diagnóstico** — patologia chamativa desvia o foco.

### B.2.2 Fontes verificadas

| Fonte | Conteúdo | Licença | Observação |
|-------|----------|---------|------------|
| [TCIA — LIDC-IDRI](https://www.cancerimagingarchive.net/collection/lidc-idri/) | 1.010 sujeitos, TC de tórax, DICOM | **CC BY 3.0** | Citação e DOI obrigatórios: `10.7937/K9/TCIA.2015.LO9QL9SX`. Melhor origem para tórax |
| [TCIA — catálogo geral](https://www.cancerimagingarchive.net/browse-collections/) | Múltiplas regiões, DICOM | **Varia por coleção** | Verificar a licença **na página da coleção**, uma a uma. Sujeito à Data Usage Policy da TCIA |
| [TotalSegmentator (Zenodo)](https://zenodo.org/records/10047292) | 1.228 TC de corpo inteiro + segmentações de 117 estruturas | **CC BY 4.0** | NIfTI, não DICOM. Excelente cobertura anatômica; exige conversão |
| ~~CQ500 — qure.ai~~ | 491 TC de crânio sem contraste | **CC BY-NC-SA 4.0** | ❌ **DESCARTADO** — ver decisão abaixo |

> **DECISÃO TOMADA (30/08/2026): a plataforma tem objetivo comercial.**
>
> Consequências, já vinculantes:
> - **CQ500 está fora.** CC BY-NC-SA 4.0 proíbe uso comercial. Não baixar, não embarcar.
> - **Nada de `-NC` no acervo embarcado.** Só CC BY, CC BY-SA ou CC0.
> - **Atenção ao `-SA` (ShareAlike):** obriga a redistribuir *derivados do dataset* sob
>   a mesma licença. Volumes convertidos são derivados. Isso **não** contamina o código
>   do simulador, mas contamina os arquivos de volume redistribuídos. Preferir **CC BY**
>   puro sempre que houver alternativa.
> - **Crânio passa a vir do TotalSegmentator** (CC BY 4.0, corpo inteiro) por recorte da
>   região da cabeça — não mais de um dataset dedicado de crânio.
> - Verificar também se a licença permite **redistribuição**, não só uso: embarcar o
>   volume no produto é redistribuir.

**Regra de licença.** Antes de incluir qualquer série, registre em
`assets/volumes/<regiao>/LICENSE.md`: fonte, coleção, DOI, licença exata, data do
download e o texto de atribuição exigido. Se a licença não puder ser determinada com
certeza, **não use o dataset**.

### B.2.3 Regras inegociáveis

- Nunca baixar imagem clínica de origem incerta.
- Nunca embarcar dado identificável. Após o download, rodar verificação de
  *burned-in annotation* (texto queimado no pixel) e conferir que
  `PatientName`, `PatientID`, `PatientBirthDate`, `InstitutionName`,
  `AccessionNumber` e `StudyDate` estão anonimizados ou removidos.
- Atribuição visível **na interface**, não só no repositório.

### B.2.4 Pipeline técnico

```
1. download        NBIA Data Retriever (TCIA) ou API REST da TCIA
2. inventário      listar séries; descartar oblíquas, espaçamento irregular, < 40 cortes
3. verificação     conferir tags de identificação; detectar texto queimado no pixel
4. seleção         1 série por região; anatomia representativa
5. normalização    reordenar por ImagePositionPatient; validar continuidade
6. conversão       DICOM -> volume Int16 em HU (aplicar RescaleSlope/Intercept)
7. reamostragem    grade isotrópica; guardar o espaçamento REAL resultante
8. empacotamento   Int16 bruto + manifest.json (dims, espacamento, origem, janela, fonte)
9. compressão      gzip do buffer; verificar tamanho servido
10. atribuição     LICENSE.md por região + crédito na UI
```

**Decisão de formato.** Não embarque DICOM bruto no acervo padrão: o custo de download
inviabiliza o uso em sala de aula. Embarque **Int16 em HU + manifest**, e mantenha o
importador DICOM do leitor para o aluno abrir séries reais quando quiser. O formato
embarcado preserva HU verdadeiros — é isso que importa.

**Orçamento de tamanho.** Alvo: ≤ 25 MB por região comprimido. Um volume 256×256×160
Int16 = 21 MB bruto, ~8–12 MB com gzip. Cabe.

### B.2.5 Regiões-alvo mínimas

Crânio, tórax, abdome/pelve, coluna lombar. As demais podem derivar de volumes de corpo
inteiro (TotalSegmentator) por recorte.

**Critério de aceite**

- Pelo menos 4 regiões no acervo, cada uma com `LICENSE.md` completo.
- Um teste que carrega cada volume e verifica: HU mínimo ≤ −900 (ar) e HU máximo ≥ +700
  (osso cortical). Se a faixa não cobrir isso, o volume não é HU real — a fase falhou.
- Espaçamento declarado confere com o espaçamento físico dos dados (teste de escala:
  a largura do crânio no corte central fica entre 130 e 180 mm).
- Nenhuma tag identificável presente.

---

## FASE 3 — Fantoma volumétrico em HU

**Objetivo.** O simulador passa a ter um **objeto físico** para escanear: um campo 3D de
HU, não uma pilha de PNG. Corrige B-04, B-05, B-06, B-07, B-17.

**Entregáveis**

1. `core/phantom/volume.js` — contrato único:

```js
// Todo fantoma, real ou sintético, implementa esta interface.
{
  dims:        [nx, ny, nz],       // voxels
  spacingMm:   [sx, sy, sz],       // ESPAÇAMENTO REAL, corrigido por subamostragem
  originMm:    [ox, oy, oz],       // canto do voxel [0,0,0] em coordenadas do paciente
  huAt(x, y, z),                   // HU por índice de voxel
  sampleMm(px, py, pz),            // HU por posição física, com interpolação trilinear
  bounds()                         // caixa envolvente em mm
}
```

2. Carregar os volumes da Fase 2 nesse contrato. **Regra dura:** sempre que o volume for
   subamostrado por fator `f`, o espaçamento é multiplicado por `f`. Um teste impede a
   regressão do B-04.

3. Posicionar o fantoma no espaço da sala: o volume ganha uma pose no mundo 3D, ligada
   ao decúbito, à entrada (cabeça/pés primeiro) e à posição da mesa. Mover a mesa
   **move o fantoma através do isocentro**. É isso que liga o 3D ao motor.

4. Aposentar `js/phantoms.js` como fonte primária. Mantê-lo apenas como *fallback*
   offline, e rotular na UI como "fantoma sintético — sem anatomia real".

5. Corrigir B-17: a região do fantoma passa a vir do protocolo **e** do plano; se não
   houver volume para a região, a interface diz isso em vez de exibir um crânio.

**Critério de aceite**

- `spacingMm` sobrevive a subamostragem: teste com fator 2 confere que o campo físico
  (dims × spacing) permanece constante.
- Amostrar o volume no ar fora do corpo devolve HU ≤ −900; no osso cortical, ≥ +700.
- Avançar a mesa 100 mm desloca a coordenada do fantoma no isocentro em 100 mm ± 1 mm.
- Reformatação coronal do volume mostra **anatomia variando** no eixo Z (teste: a
  correlação entre o corte 25% e o corte 75% é < 0,9).

---

## FASE 4 — Motor de aquisição

**Objetivo.** Fazer kV, mAs, pitch, colimação e tempo de rotação **produzirem** a imagem,
em vez de rotularem. Corrige B-02.

**Abordagem.** Projeção direta + ruído no domínio de projeção. É o que faz o ruído
*emergir* da dose em vez de ser desenhado.

Para cada corte a reconstruir:

```
1. slab        média do volume HU ao longo da espessura nominal
2. mu          HU -> coeficiente de atenuação:  mu = mu_agua * (1 + HU/1000)
               mu_agua depende do kV (tabela de referência)
3. sinograma   projeção direta (Radon) em N vistas sobre 180°+fan
4. fótons      N0 por raio a partir de mAs efetivo e kV
               mAs_efetivo = mAs / pitch
5. ruído       N ~ Poisson(N0 * exp(-integral de mu))   (+ ruído eletrônico)
6. log         p = -ln(N / N0)   -> projeção ruidosa
```

**Relações que passam a ser emergentes, não codificadas**

| Relação | Origem | Referência |
|---|---|---|
| `mAs_efetivo = mAs / pitch = mA × t_rot / pitch` | definição | AAPM |
| Ruído ∝ `mAs_efetivo^(−0,5)` | Poisson no passo 5 | AAPM Rep. 96 |
| Dose ∝ `(kV₂/kV₁)^2,0–2,5` a mAs constante | tabela de `N0(kV)` | literatura de otimização de kV |
| Iodo mais atenuante em kV baixo | `mu(HU, kV)` com dependência de energia | efeito de borda K do iodo (33,2 keV) |
| Velocidade da mesa = `pitch × colimação / t_rot` | definição | já implementado |

**Entregáveis**

1. `core/acquisition/projector.js` — projeção direta e sinograma.
2. `core/acquisition/noise.js` — modelo de fótons e ruído.
3. `core/acquisition/scan.js` — orquestra helicoidal e axial sequencial, consumindo
   `Protocol` + `AcquisitionPlan` e produzindo **dados brutos**, não imagens.
4. Rodar em `Worker` com `transferable` — a interface não pode travar.
5. O número de cortes passa a vir de `(rangeEndMm − rangeStartMm) / incremento`.
   Corrige a metade de B-03.

**Critério de aceite** (todos numéricos)

- Dobrar o mAs reduz o desvio padrão numa ROI de água em **√2 ± 10%**.
- Reduzir o pitch de 1,0 para 0,5 reduz o ruído no mesmo fator que dobrar o mAs, ± 10%.
- Reduzir kV de 120 para 80 a mAs constante **aumenta** o ruído e **aumenta** o contraste
  iodo/água.
- Planejar 120 mm com incremento de 5 mm produz **24 cortes**; planejar 177 mm produz 35.
  (Hoje produz 60 nos dois casos.)

---

## FASE 5 — Motor de reconstrução

**Objetivo.** Espessura, incremento, kernel, FOV e matriz passam a gerar **séries novas**.
Fecha B-03.

**Entregáveis**

1. `core/recon/fbp.js` — retroprojeção filtrada:
   - filtro rampa com janela selecionável: Ram-Lak (nítido), Shepp-Logan (padrão),
     Hann/cosseno (liso). Estes são os **kernels** apresentados ao aluno, com os nomes
     didáticos correspondentes (osso / padrão / partes moles).
   - grade de reconstrução definida por `FOV` e `matriz`:
     `pixelSizeMm = FOV / matriz` — exato, não aproximado.
2. `core/recon/series.js` — uma reconstrução produz uma `Series` nova, com UID próprio,
   a partir do **mesmo dado bruto**. O aluno reconstrói o mesmo scan em janela de osso
   1,25 mm e em partes moles 5 mm, e obtém duas séries.
3. Fila de reconstrução visível na interface, como no console real.

**Critério de aceite**

- Reconstruir o mesmo dado bruto com kernel liso e com kernel nítido produz imagens
  **diferentes**, com o nítido apresentando maior desvio padrão em ROI homogênea e maior
  resolução espacial medida por borda.
- `FOV 250 / matriz 512` produz `pixelSpacing = 0,488 mm` no DICOM de saída.
- Espessura 5 mm tem ruído menor que espessura 1,25 mm no mesmo dado bruto, na proporção
  aproximada de `1/√(razão de espessuras)`.
- Duas séries do mesmo scan coexistem e aparecem separadamente no viewer.

---

## FASE 6 — Dose

**Objetivo.** Trocar o CTDIvol digitado à mão por um modelo calculado.

**Entregáveis**

1. `core/dose/ctdi.js`:
   - `CTDIvol = CTDIw(kV, colimação) / pitch` — a divisão por pitch é definição.
   - `CTDIw` por kV a partir de uma **tabela de referência publicada**, normalizada por
     100 mAs, com a fonte citada no código. Escala linear com mAs.
   - `DLP = CTDIvol × comprimento_varrido_cm`.
   - `E ≈ k × DLP`, com `k` por região e por faixa etária. Marcar como **estimativa**.
2. `core/dose/aec.js` — modulação de corrente:
   - modulação angular e longitudinal a partir da espessura do paciente derivada do
     próprio topograma (é assim que o equipamento real faz).
   - o resultado alimenta o `mAs_efetivo` da Fase 4 — ou seja, **a modulação muda a
     imagem**, não só o número.
3. Comparação didática de fabricantes: explicar que Siemens (CARE Dose4D), Philips
   (DoseRight) e Canon (SUREExposure) resolvem o mesmo problema com estratégias e
   parâmetros de entrada diferentes — Siemens parte de mAs de referência para um paciente
   padrão, Philips de um nível de referência de ruído/imagem, Canon de um desvio-padrão
   alvo. Pesquisar e citar antes de escrever os textos.
4. Comparar o DLP resultante com **níveis de referência de diagnóstico (DRL)** por região,
   com fonte citada, e sinalizar quando ultrapassar.

**Critério de aceite**

- Dobrar o mAs dobra o CTDIvol e dobra o DLP.
- Dobrar o pitch reduz o CTDIvol pela metade (comprimento constante).
- Ligar a AEC num fantoma de espessura variável produz `mA` variável ao longo de Z **e**
  ruído mais uniforme entre cortes que com `mA` fixo.
- Todo número de dose exibido tem tooltip com a fórmula e a fonte.

---

## FASE 7 — DICOM de saída

**Objetivo.** O que sai do simulador é DICOM conformante, não um buffer improvisado.

**Entregáveis**

1. `core/dicom/writer.js` — gerar datasets CT Image Storage com, no mínimo:

```
PatientName, PatientID, PatientBirthDate, PatientSex
StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID   (UIDs próprios, raiz registrada ou 2.25.<uuid>)
StudyDate, StudyTime, Modality=CT, SeriesDescription, SeriesNumber, InstanceNumber
ImagePositionPatient, ImageOrientationPatient, FrameOfReferenceUID
PixelSpacing, SliceThickness, SpacingBetweenSlices
Rows, Columns, BitsAllocated=16, BitsStored=16, HighBit=15, PixelRepresentation=1
RescaleSlope, RescaleIntercept, RescaleType=HU
WindowCenter, WindowWidth
KVP, XRayTubeCurrent, ExposureTime, Exposure, SpiralPitchFactor,
  SingleCollimationWidth, TotalCollimationWidth, ConvolutionKernel
CTDIvol   (e Dose SR quando viável)
```

2. Corrigir B-05 na raiz: os HU exportados são os HU reconstruídos, com
   `RescaleIntercept = -1024`. `unidadeHU: true` passa a ser verdade.
3. Substituir a ponte improvisada com o iframe por transferência do dataset DICOM real.

**Critério de aceite**

- A série gerada abre em um visualizador DICOM externo independente sem erro.
- `ImagePositionPatient` avança exatamente `SpacingBetweenSlices` entre cortes
  consecutivos.
- HU medido no ar da imagem gerada ∈ [−1050, −950]; em osso cortical, ≥ +700.
- Reimportar a própria saída no leitor embarcado reproduz a geometria original.

---

## FASE 8 — Viewer e MPR completos

**Objetivo.** Fechar B-06 e B-07 e entregar as ferramentas que o brief exige.

**Entregáveis**

1. MPR espacialmente consistente: mover o crosshair em qualquer plano move os outros dois
   para a **mesma coordenada física**.
2. Reformatação **oblíqua** e **slab** (MIP / MinIP / média) com espessura ajustável.
3. Ferramentas de medida, hoje ausentes: distância, ângulo, ROI elíptica e poligonal.
4. Estatística de ROI: média, mínimo, máximo, desvio-padrão, área em mm², contagem de
   pixels — em HU reais.
5. Presets de janela configuráveis por região, agora com dado que os suporta.

**Critério de aceite**

- Medir um objeto de dimensão conhecida no fantoma devolve o valor correto ± 2%.
- Crosshair: clicar num ponto no axial e ler a coordenada nos outros dois planos devolve
  a mesma posição física ± 1 voxel.
- ROI em água devolve média ∈ [−10, +10] HU.
- Preset de pulmão sobre um volume de tórax mostra parênquima escuro e ar a ≈ −1000 HU.

---

## FASE 9 — Protocol Manager e biblioteca

**Objetivo.** Trocar os campos de texto livre (B-15) por um modelo tipado, validado e
gerenciável.

**Entregáveis**

1. Esquema tipado (secção C.2), com unidades e faixas. Migração dos protocolos existentes.
2. Operações completas: criar, editar, duplicar, excluir, importar, exportar, bloquear,
   desbloquear, versionar, restaurar, comparar, categorizar, pesquisar, favoritar,
   definir padrão.
3. **Motor de validação independente** (secção C.3), com três níveis: ERRO / AVISO / INFO.
4. Biblioteca inicial de protocolos cobrindo as regiões do brief. Onde não houver
   consenso, o campo carrega explicitamente:
   *"Valor dependente do equipamento e do protocolo institucional."*
   Não inventar valores clínicos.

**Critério de aceite**

- Nenhum campo numérico aceita texto livre. `dose` deixa de ser `"≈55 mGy (ref.)"`.
- Exportar e reimportar um protocolo reproduz o objeto idêntico.
- Comparar duas versões destaca exatamente os campos alterados.
- O motor de validação rejeita: pitch em modo sequencial, incremento > espessura sem
  aviso de lacuna, FOV menor que a largura do paciente, reconstrução sem aquisição,
  contraste sem fase, faixa de varredura fora do topograma.

---

## FASE 10 — Camada educacional e perfis de fabricante

**Entregáveis**

1. `education/` com: detecção de erro do aluno, categorias
   (🔴 crítico / 🟠 técnico / 🟡 otimização / 🔵 informação / 🟢 boa prática),
   feedback pós-exame e pontuação.
2. **Confirmação informada, não bloqueio.** Diante de um protocolo ruim, o sistema mostra
   a consequência prevista (dose, tempo, ruído, artefato) e pergunta se deve executar
   assim mesmo. Depois mostra o resultado real e compara com a previsão.
3. `engines/` com `PhilipsProfile`, `SiemensProfile`, `CanonProfile` implementando uma
   interface comum (`setDoseModulation`, `reconstructionOptions`, `scanModes`), de modo
   que GE e United Imaging possam ser acrescentados depois sem tocar no núcleo.
   Pesquisar cada fabricante antes de escrever; onde as fontes divergirem, dizer isso.
4. Cenários de treino e modo instrutor (exportar/importar cenário).

**Critério de aceite**

- Um protocolo com pitch 0,2 e cobertura extensa gera aviso com a consequência
  quantificada **antes** da execução, e o resultado confirma a previsão.
- Trocar o perfil de fabricante muda a nomenclatura e as opções de modulação sem alterar
  o núcleo de física.

---

## FASE 11 — Testes, performance e empacotamento

**Entregáveis**

1. **Unitários**: dose, pitch, FOV, pixel spacing, HU, escrita DICOM, validação de
   protocolo, FBP.
2. **Integração**: paciente → protocolo → plano → aquisição → reconstrução → viewer.
3. **Interface**: botões, campos, sliders, MPR, medidas.
4. **Regressão**: um teste por bug B-01…B-17, garantindo que nenhum volte.
5. **Caos**: valores negativos, campos vazios, extremos, troca de protocolo durante a
   aquisição, exclusão de paciente durante a aquisição, MPR sem dados, DICOM incompleto,
   série inválida.
6. Orçamento de performance: reconstrução de um corte 512² em ≤ 150 ms num notebook
   modesto; scan completo sem travar a interface.

**Critério de aceite**

- Cobertura do `core/` ≥ 80%.
- Nenhum teste de caos produz exceção não tratada nem estado inconsistente.
- O app roda a 60 fps durante a aquisição num equipamento de referência definido.

---

# BLOCO C — CONTRATOS

## C.1 Física — fórmulas de referência

Marcar no código a origem de cada uma.

```
mAs_efetivo      = mAs / pitch = mA × t_rot / pitch          [definição]
CTDIvol          = CTDIw / pitch                              [definição]
DLP              = CTDIvol × comprimento_cm                   [definição]
E                ≈ k × DLP                                    [ESTIMATIVA — k por região/idade]
velocidade_mesa  = pitch × colimação / t_rot                  [definição]
pixelSize        = FOV / matriz                               [definição]
ruído            ∝ mAs_efetivo^(−0,5)                         [Poisson]
ruído            ∝ espessura^(−0,5)                           [Poisson]
dose             ∝ kV^(2,0…2,5) a mAs constante               [APROXIMAÇÃO empírica]
mu(HU)           = mu_agua(kV) × (1 + HU/1000)                [definição de HU]
```

## C.2 Esquema do protocolo

```jsonc
{
  "id": "cranio_rotina",
  "versao": 3,
  "nome": "Crânio sem contraste",
  "regiao": "Cranio",
  "indicacao": "texto livre — orientação de uso, sem conduta clínica",
  "bloqueado": false,
  "preparo":      { "jejumHoras": null, "orientacoes": [] },
  "posicionamento": { "decubito": "dorsal", "entrada": "cabeca", "acessorios": [] },
  "scout":        { "orientacao": "lateral", "comprimentoMm": 300, "kv": 120, "mas": 35 },
  "aquisicao": {
    "modo": "sequencial",              // helicoidal | sequencial | volumetrico
    "kv": 120,                          // number, 70..150
    "mas": 300,                         // number > 0
    "tempoRotacaoS": 1.0,
    "pitch": null,                      // null quando modo = sequencial
    "colimacao": { "nDetectores": 64, "larguraMm": 0.6 },
    "direcao": "caudocranial",
    "tiltGantryDeg": 0
  },
  "dose": {
    "aec": { "ativo": true, "estrategia": "ruidoAlvo", "valorAlvo": 12 },
    "ctdivolEstimado": null,            // CALCULADO, nunca digitado
    "dlpEstimado": null
  },
  "reconstrucoes": [
    { "nome": "Encéfalo", "espessuraMm": 5.0, "incrementoMm": 5.0,
      "kernel": "liso", "fovMm": 220, "matriz": 512, "algoritmo": "FBP" },
    { "nome": "Osso",     "espessuraMm": 1.25, "incrementoMm": 1.0,
      "kernel": "nitido", "fovMm": 220, "matriz": 512, "algoritmo": "FBP" }
  ],
  "contraste": null,                    // ou { tipo, concentracaoMgIml, volumeMl,
                                        //      fluxoMlS, atrasoS, fases[] }
  "saida": { "series": ["Encéfalo", "Osso"], "destino": ["viewer", "dicom"] }
}
```

## C.3 Regras do motor de validação

| Nível | Condição |
|-------|----------|
| ERRO | `pitch` definido em modo sequencial |
| ERRO | reconstrução sem aquisição correspondente, ou aquisição sem nenhuma reconstrução |
| ERRO | faixa de varredura fora dos limites do topograma |
| ERRO | `fovMm` menor que a largura do paciente no corte |
| ERRO | `incrementoMm` ou `espessuraMm` ≤ 0 |
| ERRO | contraste definido sem nenhuma fase |
| AVISO | `incrementoMm` > `espessuraMm` (lacuna entre cortes) |
| AVISO | `pitch` > 1 em crânio |
| AVISO | DLP estimado acima do DRL da região |
| AVISO | espessura ≥ 5 mm em protocolo de alta resolução |
| AVISO | `kv` < 100 sem contraste iodado (ganho de contraste não se aplica) |
| INFO | `mAs` acima do usual para a região — mostrar consequência de dose |
| INFO | modo sequencial em região onde helicoidal é mais comum |

---

# BLOCO D — RUBRICA 10/10

Uma área só recebe 10 quando existir um **teste automatizado** que prove o critério.

| Área | Base | 10/10 significa | Prova |
|------|-----:|-----------------|-------|
| Arquitetura | 4 | `core/` roda em Node, sem DOM nem Three.js; física com passo fixo | Teste headless de exame completo |
| Aquisição | 2 | kV, mAs, pitch e colimação alteram a imagem por física, não por rótulo | Ruído ∝ mAs^−0,5 dentro de 10% |
| Protocolos | 2 | Tipado, validado, versionado, com CRUD completo | Round-trip de exportação idêntico |
| Dose | 3 | CTDIvol calculado; AEC realimenta a imagem | Dobrar mAs dobra o DLP; AEC uniformiza ruído |
| Scout | 6 | Faixa em mm reais; geometria válida no eixo do paciente | Faixa planejada = faixa reconstruída ± 2 mm |
| Reconstrução | 1 | Séries distintas a partir do mesmo dado bruto | Duas séries coexistem e diferem mensuravelmente |
| DICOM | 3 | Saída conformante que abre em visualizador externo | Validação externa sem erro |
| MPR | 2 | Crosshair sincronizado, oblíquo, slab | Mesma coordenada física nos três planos |
| Viewer | 5 | Distância, ângulo, ROI com estatística em HU | Medida de objeto conhecido ± 2% |
| 3D | 7 | Sala reflete o estado real do exame em todos os eixos | Mesa 100 mm → fantoma 100 mm no isocentro |
| UX | 5 | Nenhum beco sem saída; toda mensagem diz a ação de recuperação | Percurso completo por um usuário novo, sem ajuda |
| Educação | 3 | Erro detectado, consequência prevista, resultado comparado | Cenário com previsão confirmada pela execução |
| Performance | — | Corte 512² em ≤ 150 ms; 60 fps durante a aquisição | Benchmark em equipamento de referência |
| Segurança | 4 | Sem XSS; toda entrada validada e tipada | Teste de injeção passa |

---

# BLOCO E — PROTOCOLO DE SESSÃO

Ao receber um bloco de fase:

1. **Ler antes de escrever.** Abrir os arquivos citados. Não presumir.
2. **Declarar o plano** em até 10 linhas e aguardar confirmação se a mudança for estrutural.
3. **Pesquisar antes de afirmar.** Qualquer parâmetro clínico, valor de referência ou
   comportamento de fabricante exige fonte. Fontes preferenciais: Philips, Siemens
   Healthineers, Canon Medical, DICOM Standard, ACR, RSNA, IHE, AAPM, FDA, ANVISA e
   literatura revisada por pares. Quando as fontes divergirem, apresentar a divergência.
4. **Implementar em passos verificáveis**, com o teste de aceite escrito **antes** ou
   junto do código.
5. **Medir, não opinar.** Fechar a fase com a saída real do teste colada na resposta.
6. **Relatar o que ficou de fora**, explicitamente.

**Vocabulário de veredito** — usar literalmente:
`ESTÁ TECNICAMENTE COERENTE` · `ESTÁ INCOMPLETO` · `É APENAS SIMULAÇÃO VISUAL` ·
`ESTÁ ERRADO` · `ESTÁ AUSENTE`

**Pergunta de ouro, ao fim de cada fase:**
*Se um técnico experiente em TC usasse isto agora, acreditaria estar operando uma
plataforma coerente de aquisição?* Se não, apontar exatamente por quê.
