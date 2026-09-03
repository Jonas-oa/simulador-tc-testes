# Crânio — procedência e licença

## Origem

- **Coleção:** TotalSegmentator — *A dataset for anatomical structure
  segmentation in CT images*
- **Arquivo:** Zenodo · DOI [10.5281/zenodo.10047292](https://doi.org/10.5281/zenodo.10047292)
- **Versão:** `Totalsegmentator_dataset_v201`
- **Sujeito:** `s0187`
- **Baixado em:** 2026-09-03, por requisições HTTP Range sobre o ZIP público
  (ver `ferramentas/zip_remoto.py` — 63 MB em vez dos 22 GB do pacote inteiro)

## Licença

**Creative Commons Attribution 4.0 International (CC BY 4.0)**
https://creativecommons.org/licenses/by/4.0/

Permite uso, redistribuição e **uso comercial**, com atribuição. Não há cláusula
NonCommercial nem ShareAlike — compatível com o objetivo comercial da
plataforma. (Foi por essa razão que o CQ500 foi descartado: é CC BY-NC.)

## Atribuição exigida

> Wasserthal, J., Breit, H.-C., Meyer, M. T., et al. *TotalSegmentator: Robust
> Segmentation of 104 Anatomic Structures in CT Images.* Radiology: Artificial
> Intelligence, 2023. Dataset em Zenodo, DOI 10.5281/zenodo.10047292.
> Licenciado sob CC BY 4.0.

## Anonimização

O TotalSegmentator distribui volumes já desidentificados pelos autores. Os
arquivos NIfTI não carregam cabeçalho DICOM, portanto não há nome, data de
nascimento, identificador de paciente nem número de acesso a remover — esses
campos não existem no formato.

**Risco residual declarado:** o volume é de crânio e não teve a face
desfigurada. Reconstrução tridimensional da superfície pode, em tese, produzir
uma imagem reconhecível. A plataforma não expõe renderização de superfície, mas
o dado bruto está no pacote. Decisão registrada e assumida; revisão jurídica
pendente antes da distribuição comercial.

## Dado original

| campo | valor |
|---|---|
| tipo de estudo | `ct polytrauma head` |
| achado | `no_pathology` |
| idade / sexo | 25 anos · masculino |
| equipamento | Siemens SOMATOM Definition AS+ |
| tensão | 120 kVp |

## Como foi convertido

`ferramentas/nifti_para_volume.py`, que:

1. lê o NIfTI-1 (`ferramentas/nifti.py`, sem dependências externas);
2. leva os eixos de **RAS** (convenção NIfTI) para **LPS** (convenção DICOM, que
   é a da plataforma) a partir da matriz afim — espelhando x e y. Sem isso o
   topograma de perfil sairia com o paciente de bruços;
3. remove a **mesa do tomógrafo**, que vem dentro do volume de origem
   (`ferramentas/mesa.py`). A plataforma desenha a própria mesa, e a mesa
   original inflava a largura medida do paciente — número que alimenta a
   validação de FOV, o diâmetro efetivo do SSDE e a modulação do AEC;
4. recorta ao corpo com 15 mm de margem e confere que a extensão física não
   mudou (trava do B-04).

Resultado: **1,5 mm isotrópico**, 255 × 260 × 188 mm, HU de −1024 a 3071.

O volume anterior tinha cortes de 5,0 mm com pixel de 0,98 mm — anisotropia de
5,1×, que é a causa do aspecto escalonado nas reformatações coronal e sagital.
Agora a razão é 1,0.

## Uso

Exclusivamente educacional, para treinar **operação** de tomógrafo. A plataforma
não interpreta exames nem oferece orientação clínica.
