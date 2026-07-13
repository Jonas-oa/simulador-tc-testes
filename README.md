# Simulador Educacional de Tomografia Computadorizada (TC)

Simulador web 3D para **treinamento de operação de equipamento e
posicionamento de paciente**, destinado a estudantes de Radiologia.
**Não interpreta exames nem oferece qualquer orientação clínica ou
diagnóstica** — o foco é exclusivamente o aprendizado da operação do
equipamento.

- **Repositório:** github.com/Jonas-oa/simulador-tc-educacional (branch `main`)
- **Site (GitHub Pages):** https://jonas-oa.github.io/simulador-tc-educacional/

## Estrutura do projeto

```
index.html            → interface (viewport 3D, console, status bar, mensagens)
script.js             → TODO o código JS (script clássico, sem módulos/bundler)
manifest.json         → metadados do PWA
css/style.css         → tokens de design, tema claro/escuro, layout, componentes
js/vendor/three.min.js → Three.js r128 (build global/UMD), 100% offline
icons/                → ícones do PWA
assets/ models/ textures/ sounds/ → (reservados para etapas futuras)
```

## Arquitetura (decidida após depuração extensa — não mudar sem motivo forte)

- **SEM ES modules, SEM import maps, SEM bundler.** Só scripts clássicos.
  ES modules falhavam silenciosamente em navegadores/redes reais do
  usuário, sem erro capturável. `script.js` é um único arquivo clássico,
  carregado depois do Three.js vendorizado (`js/vendor/three.min.js`,
  r128, build global `THREE`). Edita e recarrega — sem passo de build.
- **Câmera orbital manual** (arrastar p/ girar, pinça/scroll p/ zoom) —
  não usa o addon OrbitControls (mesma razão).
- **Deploy:** GitHub Pages via Actions. Falhas "Deployment failed, try
  again later" são transitórias do GitHub — basta reter (commit vazio +
  push). Cada sessão nova precisa de um token fine-grained do GitHub
  (escopo só neste repo, Contents: Read/write) para publicar.
- **Cache:** como é site estático, mudanças podem não aparecer por cache
  do navegador. Testar em aba anônima ou limpar cache. (O controle de
  versão automático virá com o service worker, na etapa PWA.)

## Física / parâmetros do equipamento (confirmados com fotos de Siemens real)

- Altura do isocentro: **80 cm** do piso.
- Bore (furo do gantry): **80 cm de diâmetro** (raio 40 cm), passante.
- Altura da mesa: **máxima 88 cm** (dentro e fora do gantry);
  **mínima 50 cm fora** do gantry; **mínima 64 cm dentro** do gantry.
- Entrada no gantry só é permitida com a altura na faixa 64–88 cm
  (intertravamento de segurança, com aviso no painel).
- Curso longitudinal total: **~200 cm**. O limite de inserção leva a
  região anatômica de interesse (abdome/tórax/cabeça) ao isocentro.
- Espessura média do paciente considerada: **24 cm** (meia-espessura
  12 cm) — usada para o alinhamento do centro do corpo ao isocentro.

## Estado atual — implementado

**Cena 3D**
- Sala (piso xadrez, paredes, teto), iluminação com sombras.
- Gantry com furo real (ExtrudeGeometry), anel de acento ciano.
- Suporte da mesa estilo Somatom: base retangular escalonada FIXA no
  piso + coluna-pistão que sobe/desce com a mesa; berço de suporte que
  preenche o vão entre a base e o gantry quando o tampo avança.
- Colchão fino (2.5 cm) sobre o tampo.

**Mesa de exame**
- Botões Mesa +/− (altura) e Entrar/Sair (longitudinal), com
  pressionar-e-segurar via Pointer Events (mouse + touch, com captura
  de ponteiro para não "grudar").
- Limites de altura contextuais (dentro/fora do gantry) e intertravamento
  de entrada.
- HUD e display digital: posição (mm), velocidade (mm/s), altura (cm).

**Laser de posicionamento** (projetado por raycasting — segue a
superfície do paciente, não atravessa o corpo)
- 3 feixes longitudinais (origens 12h / 3h / 9h): linha média sagital no
  topo + laterais sagitais.
- 1 feixe transversal (origem 12h): marca o plano de início do exame.
- Cobertura: ~20 cm para fora + ~50 cm para dentro do gantry.
- **Temporizador de segurança:** desliga sozinho após 40 s.

**Botão Zerar**
- Define a posição atual da mesa como marco zero para a (futura)
  aquisição. Ponto de controle, não obrigatório. A leitura de posição
  passa a ser relativa a esse ponto.

**Posicionamento do paciente** (layout vertical — o horizontal fica p/
etapa futura)
- Paciente inicia **em pé ao lado do aparelho** (estado "aguardando").
- Ao selecionar um decúbito, ele vai para a mesa na posição escolhida.
- 4 decúbitos (dorsal, ventral, lateral D, lateral E) × 2 entradas
  (cabeça primeiro, pés primeiro) = 8 combinações, com rotação 3D real
  em torno do eixo central do corpo (não afunda na mesa).
- Seletor: botão que abre painel expansível com ícones SVG esquemáticos.

**Simulação**
- Iniciar (status vira guia de alinhamento no isocentro:
  SUBIR/DESCER MESA / ISOCENTRO OK), Reiniciar (volta tudo ao início,
  paciente de volta em pé), STOP (parada de emergência).

**Interface geral**
- Tema claro/escuro. Layout mobile (vertical) otimizado; barra de
  status com indicadores dinâmicos; painel de mensagens.

**Correções mobile + sala sempre visível (revisão 2026-07d)**
- Cache-busting versionado (REV) em manifest e assets — corrige o
  topograma aparecendo na vertical por cache antigo do GitHub Pages.
  Bump do REV a cada troca de asset.
- Sala 3D sempre visível na etapa Exame (antes só durante a aquisição):
  no desktop-console e também no celular (aba Exame), o viewport 3D é
  reparentado para o PiP e acompanha a mesa antes/durante/depois do scan.

**Aquisição — orientação correta + foco no exame (revisão 2026-07e)**
- Topograma horizontal CORRIGIDO: inspeção anatômica (dentes/mandíbula)
  mostrou que no original a face está à DIREITA — a rotação certa é a
  ANTI-horária: decúbito dorsal com VÉRTICE à esquerda e base à direita.
  Geometria toda remapeada (zonas-alvo, revelação por direção, MOVER) e
  REV de assets bumpado (recarregar sem cache uma vez).
- Volume: o fluxo estava correto — o defeito era de percepção (varredura
  de ~4 s com primeiros cortes quase pretos e o relatório abrindo por
  cima ao final). Agora o relatório NÃO abre sozinho (botão "Relatório"
  destacado na revisão) e o contador de aquisição ganhou destaque pulsante.
- Quiz removido por ora (pedido do usuário — foco no exame). O código do
  relatório permanece.

**Correções mobile — aquisição (revisão 2026-07d)**
- Cache do topograma quebrado (REV bump): a versão HORIZONTAL passa a
  carregar de fato no celular (o arquivo vertical antigo ficava em cache).
- Sala 3D sempre visível na etapa Exame do celular: faixa 3D fixa no topo
  do quadrante de aquisição (o viewport REAL é reparentado; PiP flutuante
  segue valendo só no desktop). Quadrante de exame ganhou altura explícita
  no mobile para o topograma caber e o fitTopo medir certo.
- Fluxo MOVER→Iniciar mais claro: o botão MOVER recebe destaque quando é
  a próxima ação (faixa válida, mesa fora de posição) e o Iniciar só se
  realça quando a mesa chega à posição inicial.

**Console guiado + avaliação (revisão 2026-07c)**
- Console guiado no desktop (padrão): etapas 1 Sala → 2 Paciente →
  3 Protocolo → 4 Exame em tela cheia, como nos consoles reais
  (Somaris/IACI/ScanLab). Banner persistente (paciente · protocolo ·
  mesa · status) e pontos âmbar de pendência por etapa. Botão ⊞ alterna
  para o modo painel (4 quadrantes com divisórias), tudo persistido.
- PiP da sala 3D: durante topograma/posicionamento/volume no modo
  console, o viewport 3D REAL é reparentado para uma janela flutuante
  arrastável sobre o viewer — o aluno vê a mesa se movendo enquanto a
  imagem cresce (o ResizeObserver do renderer reajusta o canvas).
- Isocentro (topograma lateral): ao iniciar o scout, o desvio vertical
  do eixo do paciente vs. ISO_Y é medido; >4 cm gera aviso didático de
  magnificação/erro de dose (AAPM). Registrado no relatório.
- Relatório didático na revisão: paciente, protocolo/direção, faixa,
  FOV, velocidade da mesa, isocentro e DLP ≈ CTDIvol × comprimento —
  sem validade clínica/dosimétrica. Quiz de fixação (3 questões).
- Roadmap (dependem de novos volumes/insumos clínicos do usuário):
  comandos de respiração sintetizados (tórax/abdome), injetora de
  contraste com delays, novas regiões em assets/volumes/, modo
  instrutor (exportar/importar cenários).

**Aquisição — refinamentos (revisão 2026-07b)**
- Topograma dimensionado por JS (fitTopo) para caber sempre no quadrante,
  em qualquer proporção, com o box das linhas casando com a imagem.
- Botão MOVER (fase de planejamento): leva a mesa 3D à posição inicial da
  faixa planejada (mapa imagem→posição da mesa via referência espacial do
  topograma). Iniciar só libera com faixa válida E mesa em posição; mexer
  nas linhas exige mover de novo. Display mostra "POSICIONANDO MESA".

**Aquisição integrada ao 3D (revisão 2026-07)**
- Física real implementada: no topograma o tubo fica estacionário e a
  MESA 3D translada o paciente pelo gantry — a imagem (agora HORIZONTAL,
  decúbito dorsal, vértice à direita) se revela em sincronia com a
  posição REAL da mesa. No volume helicoidal a mesa avança continuamente
  a v = pitch × colimação ÷ tempo de rotação (1,0 s/volta), com arco
  luminoso girando no bore e som sintetizado da máquina (WebAudio,
  offline). Fontes: AAPM CT Lexicon, Bushberg, Siemens CARE Dose.
- Protocolo ganhou o campo "Direção da varredura": caudo-cranial (mesa
  sai do gantry — laser no queixo) ou crânio-caudal (mesa entra — laser
  no vértice). A direção comanda o sentido da mesa, o lado de revelação
  do topograma e a ordem dos cortes (premissa: axial_000 = mais inferior).
- Pré-requisitos para iniciar: paciente cadastrado E posicionado na mesa.
  Zerar a mesa NÃO é obrigatório. Sem curso suficiente na direção
  programada, a aquisição não inicia (reposicionar a mesa). O Stop físico
  (emergência) e o Stop da workstation abortam a aquisição e param a mesa.
- Fallback: se a cena 3D falhar, a aquisição roda por temporizador como
  antes. Zonas-alvo do planejamento recalibradas para o topograma
  horizontal (didáticas — validação clínica do usuário). Seed do Crânio:
  pitch 1,2 e direção caudo-cranial (protocolos já salvos no IndexedDB
  mantêm os valores antigos até serem editados).

**Layout PC (revisão 2026-07)**
- Quadrantes com divisórias independentes (Opção B — colunas): a divisória
  vertical ajusta a largura das colunas; cada coluna tem a própria divisória
  horizontal (mexer na altura da direita não altera a esquerda). Tudo em
  frações (%): os vizinhos preenchem o espaço liberado em suas proporções,
  inclusive ao redimensionar a janela. Frações persistidas em localStorage;
  duplo clique na divisória volta ao 50/50.
- Seletor rápido de telas (Sala/Paciente/Protocolo/Exame) é exclusivo
  do modo celular — oculto no desktop.
- Quadrante 3D do PC usa o mesmo conceito da tela "Sala" do celular:
  viewport em tela cheia e painel de comandos flutuante semitransparente
  sobre o 3D, com alça de arraste e canto de escala (posição/escala
  persistidas em localStorage; display compacto oculto — o HUD já mostra
  os dados).
- Quadrante Aquisição: a imagem ocupa todo o quadrante (fundo preto de
  workstation); nome do paciente sobreposto no topo com fundo
  transparente; Iniciar/Stop (+ slider e readout do topograma, quando
  existem) sobrepostos na base. Antes do topograma (idle) aparecem só o
  nome do paciente e os comandos.
- Quadrante Protocolos sem barra de rolagem: visão padrão = mapa do
  corpo + lista + botões "Editar" e "+ Novo protocolo" abaixo; Editar
  (ou novo protocolo) abre o editor ocupando o quadrante inteiro, já em
  modo de edição, com Salvar/Cancelar voltando à visão padrão.
- Correção: guarda CSS para `[hidden]` (classes com `display` definido
  faziam o topograma/editor "vazarem" antes da hora).

## Próximas etapas (pendentes)

- **Aquisição do exame** (usa o marco zero do laser transversal) — a
  grande próxima etapa.
- Layout **horizontal** (paisagem): card fixo no canto estilo Siemens.
- Ícones SVG do seletor mais refinados; calibração fina das poses.
- Refinamento visual do gantry (mirar na foto-meta: branco, curvo,
  painéis laterais).
- Física refinada (aceleração/desaceleração suave).
- Configurações + IndexedDB (idioma, tema, velocidade, volume).
- PWA completo (service worker, cache offline, atualização controlada,
  instalação).
- Testes e otimização finais.

## Estilo de trabalho (seguir sempre)

Estudar o arquivo antes de editar; explicar o plano antes de gerar código
quando a mudança for grande; edições cirúrgicas preservando nomes de
função/IDs/variáveis/keys; nunca reescrever sem necessidade; validar
(`node --check`, conferir IDs no HTML) antes de publicar; confirmar no
final que nada foi quebrado; dividir em etapas e aguardar confirmação.
