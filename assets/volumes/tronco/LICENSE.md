# Tronco (tórax · abdome · pelve · coluna) — procedência e licença

## Origem

- **Coleção:** TotalSegmentator — *A dataset for anatomical structure
  segmentation in CT images*
- **Arquivo:** Zenodo · DOI [10.5281/zenodo.10047292](https://doi.org/10.5281/zenodo.10047292)
- **Versão:** `Totalsegmentator_dataset_v201`
- **Sujeito:** `s0476`
- **Baixado em:** 2026-09-03, por requisições HTTP Range sobre o ZIP público
  (`ferramentas/zip_remoto.py`)

## Licença

**Creative Commons Attribution 4.0 International (CC BY 4.0)**
https://creativecommons.org/licenses/by/4.0/

Uso comercial permitido, com atribuição. Sem NonCommercial, sem ShareAlike.

## Atribuição exigida

> Wasserthal, J., Breit, H.-C., Meyer, M. T., et al. *TotalSegmentator: Robust
> Segmentation of 104 Anatomic Structures in CT Images.* Radiology: Artificial
> Intelligence, 2023. Dataset em Zenodo, DOI 10.5281/zenodo.10047292.
> Licenciado sob CC BY 4.0.

## Anonimização

Volume já desidentificado pelos autores; o formato NIfTI não carrega os campos
de identificação do DICOM. Sendo tronco, não há face a considerar.

## Dado original

| campo | valor |
|---|---|
| tipo de estudo | `ct neck-thorax-abdomen-pelvis` |
| achado | `no_pathology` |
| idade / sexo | 61 anos · masculino |
| equipamento | Siemens SOMATOM Definition Edge |
| tensão | 120 kVp |

O exame é **com contraste** (aorta e rins realçados), o que serve ao ensino das
fases contrastadas que o simulador modela.

## Por que este sujeito

Foram triados nove candidatos do dataset. Os critérios e o que reprovou cada um:

| sujeito | extensão | metal | pulmão | veredito |
|---|---|---|---|---|
| s1371 | 788 mm | **0,027%** | 178 mm | prótese total de quadril, com estriamento |
| s0913 | 698 mm | **0,059%** | 215 mm | metal |
| **s0476** | **694 mm** | **0,000%** | **232 mm** | **escolhido** |
| s0546 | 687 mm | 0,001% | 231 mm | aprovado; reserva |
| s1012 | 680 mm | 0,001% | 198 mm | pulmão curto |
| s1228 | 603 mm | 0,005% | — | largura de 482 mm |
| s0250 | 452 mm | 0,000% | 32 mm | tórax quase ausente |
| s0227 / s0174 / s0190 | 356–380 mm | 0,000% | — | curtos demais |

O metal foi medido como fração de voxels acima de 2500 HU: osso cortical chega a
cerca de 1800 HU, então o que passa disso é implante ou contraste concentrado.
Rejeitar implantes importa porque a pelve é região de ensino central, e o
artefato de estriamento dominaria toda imagem reconstruída ali.

## Como foi convertido

`ferramentas/nifti_para_volume.py` — mesma cadeia descrita em
`assets/volumes/cranio/LICENSE.md`: NIfTI → orientação RAS→LPS pela matriz afim
→ remoção da mesa → recorte ao corpo com 20 mm de margem → verificação de escala.

Resultado: **1,5 mm isotrópico**, 424 × 404 × 694 mm, HU de −1024 a 3071.

## Limitação conhecida

Em 198 dos 463 cortes (43%) o paciente **encosta na borda lateral** do campo
reconstruído do exame original: o FOV da fonte era de 424 mm e o paciente é mais
largo nos quadris. O tecido cortado chega a 41 pixels de altura numa coluna, num
corte de 269 — visível como uma aresta reta no flanco, nos cortes mais baixos.
Não há como recuperar o que a fonte não reconstruiu, e preencher seria inventar
anatomia. Está declarado aqui e no manifesto (`largura_maxima_mm`).

## Marcos anatômicos medidos

Distâncias a partir da extremidade **inferior** do volume (fêmures proximais):

| marco | posição |
|---|---|
| pico ósseo da bacia (acetábulos) | 75 mm |
| crista ilíaca | 225 mm |
| base pulmonar | 399 mm |
| ápice pulmonar | 652 mm |
| topo do volume (base do pescoço) | 694 mm |

São esses números que alimentam as faixas padrão por região em
`core/phantom/acervo.js`.

## Uso

Exclusivamente educacional, para treinar **operação** de tomógrafo. A plataforma
não interpreta exames nem oferece orientação clínica.
