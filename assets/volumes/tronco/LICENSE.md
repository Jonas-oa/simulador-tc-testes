# Tronco (tórax · abdome · pelve · coluna lombar) — procedência e licença

## Origem

- **Coleção:** CPTAC-CCRCC — *Clinical Proteomic Tumor Analysis Consortium,
  Clear Cell Renal Cell Carcinoma*
- **Arquivo:** The Cancer Imaging Archive (TCIA), National Cancer Institute
- **Página:** https://www.cancerimagingarchive.net/collection/cptac-ccrcc/
- **Série usada:** `1.3.6.1.4.1.14519.5.2.1.6450.3304.166159322911379491499619152148`
  (descrição original `CHEST ABDOMEN PELVIS`)
- **Baixado em:** 2026-09-01, via API REST pública do TCIA (`getImage`, v1)

## Licença

**Creative Commons Attribution 4.0 International (CC BY 4.0)**
https://creativecommons.org/licenses/by/4.0/

Permite uso, redistribuição e **uso comercial**, com atribuição. Sem cláusula
NonCommercial e sem ShareAlike — compatível com o objetivo comercial da
plataforma.

Sujeito também à *TCIA Data Usage Policy*:
https://www.cancerimagingarchive.net/data-usage-policies-and-restrictions/

## Atribuição exigida

> National Cancer Institute Clinical Proteomic Tumor Analysis Consortium (CPTAC).
> (2018). **The Clinical Proteomic Tumor Analysis Consortium Clear Cell Renal Cell
> Carcinoma Collection (CPTAC-CCRCC)** (Version 14) [Data set]. The Cancer Imaging
> Archive. https://doi.org/10.7937/k9/tcia.2018.oblamn27

Agradecimento solicitado pela coleção:

> Os dados usados nesta publicação foram gerados pelo National Cancer Institute
> Clinical Proteomic Tumor Analysis Consortium (CPTAC).

Citação do arquivo:

> Clark, K., Vendt, B., Smith, K., Freymann, J., Kirby, J., Koppel, P., Moore, S.,
> Phillips, S., Maffitt, D., Pringle, M., Tarbox, L., & Prior, F. (2013). The Cancer
> Imaging Archive (TCIA): Maintaining and Operating a Public Information Repository.
> *Journal of Digital Imaging*, 26(6), 1045–1057.

## Processamento aplicado

1. **Separação de reconstruções.** A série traz duas reconstruções entrelaçadas
   sob o mesmo `SeriesInstanceUID`: 178 cortes de 5,0 mm e 144 de 2,5 mm.
   Misturadas, produzem espaçamento irregular. Foi usada a de **2,5 mm**.
2. Cortes ordenados por `ImagePositionPatient` projetada na normal do plano.
3. Verificação de aquisição não oblíqua e espaçamento regular (2,5 mm constante).
4. Conversão para HU com `RescaleSlope` / `RescaleIntercept`.
5. Subamostragem 2× no plano **com o espaçamento corrigido na mesma proporção**
   (0,7852 → 1,5703 mm), preservando a extensão física de 402 mm.
6. Gravação como Int16 bruto comprimido + `manifest.json`.

Ferramenta: `ferramentas/dicom_para_volume.py`.

## Cobertura anatômica

Volume único de 360 mm no eixo crânio-caudal cobrindo **tórax inferior, abdome,
pelve e coluna lombar**. As regiões do simulador são obtidas por recorte deste
mesmo volume, evitando quatro downloads separados.

## Verificação de anonimização

Nenhum identificador de paciente, instituição ou médico encontrado nos metadados.
A coleção é distribuída já desidentificada pelo TCIA.

## Aviso

Volume de tomografia computadorizada **real**, de paciente anonimizado, usado
exclusivamente para **treinamento de operação de equipamento e posicionamento**.
A coleção é de pacientes oncológicos e o volume pode conter achados; a plataforma
**não** interpreta exames nem oferece qualquer orientação clínica ou diagnóstica.
