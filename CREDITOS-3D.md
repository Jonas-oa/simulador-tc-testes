# Créditos de recursos 3D de terceiros

Este arquivo registra os recursos de terceiros embutidos no modelo da paciente.
As licenças abaixo **exigem** que o crédito permaneça acessível a quem usa o
aplicativo — mantenha este arquivo distribuído junto com o simulador e cite os
autores em alguma tela de créditos ou na documentação visível ao usuário final.

---

## Cabelo — coque baixo

| | |
|---|---|
| **Obra** | *Messy Low Bun Female Hairstyle* |
| **Autor** | CliffUnderside |
| **Origem** | https://sketchfab.com/3d-models/messy-low-bun-female-hairstyle-db7a61ea9f2c45ddb0b7571972f9738f |
| **Licença** | Creative Commons Attribution 4.0 (CC BY 4.0) — https://creativecommons.org/licenses/by/4.0/ |
| **Uso** | Permitido inclusive comercialmente, desde que o crédito seja mantido |

### Modificações aplicadas

A licença CC BY exige indicar que a obra foi alterada. Foram feitas:

- Redimensionamento uniforme em 0,9447 e reposicionamento, para assentar no
  crânio da paciente (ajuste numérico contra a malha do corpo, desvio médio
  final de 9,09 mm entre os dois crânios).
- Conformação de 1.357 vértices da touca à calota, com folga de 2,5 mm, para
  eliminar interpenetração com o couro cabeludo.
- Remoção da cabeça de referência (`geo_Head`) que acompanhava o arquivo
  original; apenas a malha de cabelo (`geo_Hair`) foi aproveitada.
- Recoloração: a textura original é grisalha. Foi inserido um gradiente
  remapeando a luminância para castanho escuro, na faixa (0,013 / 0,005 /
  0,0025) a (0,082 / 0,038 / 0,020), para casar com a paleta da paciente.
- **Reposicionamento do coque de baixo para alto**: o penteado original é um
  coque baixo na nuca. As 6 ilhas de malha que formam o coque (1.157 vértices,
  identificadas por estarem a mais de 25 mm da pele) foram rotacionadas 85° em
  bloco, em torno do eixo transversal que passa pelo centro do crânio, levando o
  coque de Z=1,5105 para Z=1,6975 — a altura da coroa. As mechas do restante do
  penteado acompanham com peso proporcional (máximo de 34%), modulado por quanto
  cada vértice está atrás e abaixo do centro da cabeça, e com variação aleatória
  por ilha de ±20% para que a linha do cabelo na nuca não ficasse reta.
- Reencaixe no esqueleto: vinculado ao osso `DEF-spine.006` com peso 1,0.
- Texturas reduzidas de 4096×4096 para 1024×1024 na exportação web.

### Observação sobre procedência

Durante a busca foi descartado o modelo *High Bun With Bangs*, do usuário
zHairezt, que aparecia no Sketchfab marcado como CC BY. A descrição do próprio
uploader declarava "ALL CREDITS TO ZEPETO", e o nome interno do arquivo
(`IP_SCBE_F_HAIR_4`) confirmava tratar-se de asset extraído da plataforma
comercial ZEPETO, da Naver Z. O uploader não tinha direito de licenciá-lo, e a
etiqueta de licença no Sketchfab é preenchida pelo remetente, sem verificação.
O arquivo foi apagado e não entrou no projeto.

**Ao buscar novos recursos, leia sempre a descrição do autor antes de confiar na
etiqueta de licença.**
