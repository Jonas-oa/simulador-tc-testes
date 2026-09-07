# Paciente 3D — como trocar a figura sem tocar em código

Esta pasta é o único lugar que você precisa mexer para pôr um paciente feito em
Blender, MakeHuman, Mixamo, Ready Player Me ou qualquer outra ferramenta dentro
do simulador.

```
assets/paciente/
├── paciente.glb    ← só isto já funciona
├── paciente.json   ← opcional, para corrigir o que a leitura automática errar
└── LEIA-ME.md      ← este arquivo
```

Sem `paciente.glb`, o app usa a figura procedural de sempre (esferas e
cilindros). **Isso não é erro e não gera aviso nenhum.**

---

## O básico

1. Exporte o modelo como **glTF binário (`.glb`)**, com as **texturas
   embutidas**.
2. Salve como `assets/paciente/paciente.glb`.
3. Recarregue o app.

É isso. O app mede o modelo, gira, escala e encosta na mesa sozinho, e diz na
barra de mensagens o que encontrou:

> Paciente 3D importado: 170,0 cm de comprimento, 46,2 cm de largura, 24,8 cm
> de espessura.

### No Blender

`File ▸ Export ▸ glTF 2.0 (.glb/.gltf)` e, no painel da direita:

| Opção | Valor |
|---|---|
| **Format** | `glTF Binary (.glb)` |
| **Include ▸ Selected Objects** | marque, se houver mais coisa na cena |
| **Data ▸ Mesh ▸ Apply Modifiers** | marcado |
| **Data ▸ Material ▸ Images** | `Automatic` (embute as texturas) |
| **Data ▸ Compression** | **desmarcado** — veja "Draco" abaixo |
| **Animation** | pode desmarcar; não é usada |

Não se preocupe com escala, rotação ou onde está a origem do objeto. O app
normaliza tudo.

---

## O que o app ajusta sozinho

Um modelo vindo de fora chega em escala, orientação e origem arbitrárias — o
Blender exporta em metros com Z para cima, o Mixamo em centímetros, e a origem
tanto pode estar nos pés quanto no quadril. Em vez de exigir que você acerte
isso, o app mede a caixa envolvente e normaliza:

| Medida | O que vira |
|---|---|
| eixo **mais longo** | o eixo cabeça-pés |
| eixo **mais curto** | a espessura do corpo (a altura sobre o tampo) |
| eixo do meio | a largura (ombros) |
| comprimento total | **1,70 m** |
| origem | centro em X e Z; a parte mais baixa encosta no plano do tampo |

A espessura medida vira o número que o app usa para ensinar o aluno a **descer
a mesa até centralizar o paciente no isocentro**. Um modelo mais espesso muda a
altura correta da mesa — e é assim que tem de ser.

### A única coisa que a geometria não diz

**Para que lado fica a cabeça.** O app chuta pelo ponto mais largo do corpo —
os ombros ficam mais perto da cabeça do que dos pés — e avisa quando não
consegue decidir. Se o paciente entrar de cabeça para baixo, é uma linha no
`paciente.json`.

---

## `paciente.json` — só se precisar

Todos os campos são opcionais. O arquivo inteiro é opcional.

```json
{
  "cabecaEm": "-z",
  "comprimentoM": 1.62,
  "meiaEspessuraM": 0.14,
  "girarGrausZ": 90,
  "deslocarM": [0, 0.01, 0],
  "credito": "Modelo: Fulano de Tal (CC BY 4.0)"
}
```

| Campo | Para quê |
|---|---|
| `cabecaEm` | `"+z"` ou `"-z"`. Use quando o app deduzir errado o lado da cabeça. |
| `comprimentoM` | Altura real do paciente, em metros. Padrão 1,70. É assim que se faz um paciente pediátrico. |
| `meiaEspessuraM` | Metade da espessura do tórax, em metros. Só use se a caixa envolvente exagerar (um braço levantado, por exemplo, engorda a caixa sem engordar o tórax). |
| `girarGrausZ` | Giro em torno do eixo do corpo, em graus. Para um modelo exportado de bruços ou de lado. |
| `deslocarM` | `[x, y, z]` em metros, somados depois de tudo. Ajuste fino. |
| `credito` | Texto mostrado na barra de mensagens quando o modelo carrega. **Use isto para cumprir a licença do modelo.** |

---

## O que o leitor entende — e o que não entende

O simulador tem um leitor de GLB próprio (`js/sala/glb.js`), pequeno de
propósito: trazer o GLTFLoader oficial significaria embutir 60 KB de código de
terceiros para usar uma fração dele.

**Entende:** malha estática (posições, normais, UV, índices, inclusive buffers
intercalados) · hierarquia de nós · material PBR (cor base, metalicidade,
rugosidade, textura de cor base embutida, dupla face, transparência).

**Não entende:**

- **Esqueleto e animação.** A malha vem na **pose de bind** — a pose em que o
  modelo foi rigado. Para um paciente deitado numa mesa isso costuma ser o que
  se quer, mas se o seu modelo está rigado em T-pose e você esperava vê-lo
  deitado, **aplique a pose antes de exportar** (no Blender: `Pose ▸ Apply ▸
  Apply Pose as Rest Pose`, ou exporte a malha com o modificador Armature
  aplicado).
- **Compressão Draco.** Desmarque `Compression` no exportador. Com ela ligada o
  app avisa e mantém a figura padrão.
- **Morph targets** (shape keys), câmeras e luzes do arquivo.
- **`.gltf` separado** (JSON + `.bin` + imagens soltas). É `.glb`, **um arquivo
  só**, com as texturas dentro.

Encontrando qualquer uma dessas, o app **não falha em silêncio**: mostra o que
encontrou na barra de mensagens e segue com o que conseguiu ler.

---

## Testar sem ter um modelo à mão

O projeto traz um gerador de boneco de teste — caixas, feio de propósito, e
exportado **na convenção errada** (em pé, em centímetros, origem no quadril),
justamente para exercitar a normalização:

```bash
python ferramentas/gerar-paciente-de-teste.py assets/paciente/paciente.glb
```

Recarregue o app: o boneco deve aparecer **deitado**, com 1,70 m, encostado no
tampo e com a cabeça para o lado certo. Apague o arquivo para voltar à figura
procedural.

---

## Ocultar o paciente

O painel de comandos da sala tem um botão **Paciente**. Ele esconde a **figura**
— não o paciente do exame. Quem está na mesa continua na mesa, o posicionamento
vale, o cálculo do isocentro vale e a aquisição não muda. Serve para ver a mesa,
os lasers e o plano do isocentro sem o corpo na frente, e para tirar da cena um
modelo pesado enquanto se posiciona.

A escolha fica lembrada entre sessões.

---

## Se der errado

O app **nunca fica sem paciente**. Se o arquivo não abrir, a figura procedural
continua na mesa e a barra de mensagens diz o motivo. Os casos mais comuns:

| Mensagem | O que fazer |
|---|---|
| *não é um arquivo GLB* | Você exportou `.gltf` em vez de `.glb`. Reexporte como binário. |
| *GLB sem bloco binário* | O exportador separou os dados. Escolha "glTF Binary". |
| *exige extensões que este leitor não tem* | Desmarque `Compression` (Draco) no exportador. |
| *textura em arquivo externo* | Marque `Images: Automatic` (ou `Pack`) para embutir. |
| *a malha vem na pose de bind* | Aplique a pose antes de exportar. |
| paciente de cabeça para baixo | `"cabecaEm": "-z"` no `paciente.json`. |
| paciente de lado ou de bruços | `"girarGrausZ"` no `paciente.json`. |

---

## Uma palavra sobre licença

Se o modelo veio de um banco de modelos, a licença quase sempre exige
atribuição. O campo `credito` do `paciente.json` existe para isso: o texto
aparece na barra de mensagens quando o modelo carrega. Este simulador é
educacional e público — vale a pena acertar isso.
