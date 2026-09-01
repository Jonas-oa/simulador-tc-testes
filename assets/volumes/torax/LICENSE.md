# Tórax — procedência e licença

## Origem

- **Coleção:** LIDC-IDRI — *The Lung Image Database Consortium and Image Database
  Resource Initiative*
- **Arquivo:** The Cancer Imaging Archive (TCIA), National Cancer Institute
- **Página:** https://www.cancerimagingarchive.net/collection/lidc-idri/
- **Série usada:** `1.3.6.1.4.1.14519.5.2.1.6279.6001.290410217650314119074833254861`
  (descrição original `1.25 STANDARD`, 261 cortes)
- **Baixado em:** 2026-09-01, via API REST pública do TCIA (`getImage`, v1)

## Licença

**Creative Commons Attribution 3.0 Unported (CC BY 3.0)**
https://creativecommons.org/licenses/by/3.0/

Permite uso, redistribuição e **uso comercial**, com atribuição. Não há cláusula
NonCommercial nem ShareAlike — compatível com o objetivo comercial da plataforma.

O uso também está sujeito à *TCIA Data Usage Policy*:
https://www.cancerimagingarchive.net/data-usage-policies-and-restrictions/

## Atribuição exigida

Citação formal do conjunto de dados:

> Armato III, S. G., McLennan, G., Bidaut, L., McNitt-Gray, M. F., Meyer, C. R.,
> Reeves, A. P., Zhao, B., Aberle, D. R., Henschke, C. I., Hoffman, E. A., et al.
> (2015). **Data From LIDC-IDRI** [Data set]. The Cancer Imaging Archive.
> https://doi.org/10.7937/K9/TCIA.2015.LO9QL9SX

Publicação de referência:

> Armato III, S. G., et al. (2011). The Lung Image Database Consortium (LIDC) and
> Image Database Resource Initiative (IDRI): A completed reference database of lung
> nodules on CT scans. *Medical Physics*, 38(2), 915–931.

Citação do arquivo:

> Clark, K., Vendt, B., Smith, K., Freymann, J., Kirby, J., Koppel, P., Moore, S.,
> Phillips, S., Maffitt, D., Pringle, M., Tarbox, L., & Prior, F. (2013). The Cancer
> Imaging Archive (TCIA): Maintaining and Operating a Public Information Repository.
> *Journal of Digital Imaging*, 26(6), 1045–1057.

Agradecimento solicitado pela coleção:

> Os autores reconhecem o National Cancer Institute e a Foundation for the National
> Institutes of Health, e seu papel decisivo na criação da base LIDC/IDRI, de acesso
> livre e público.

## Processamento aplicado

1. Cortes ordenados por `ImagePositionPatient` projetada na normal do plano.
2. Verificação de aquisição não oblíqua e espaçamento regular.
3. Conversão para HU com `RescaleSlope` / `RescaleIntercept`, limitada a
   −1024…+3071.
4. Subamostragem 2× no plano **com o espaçamento corrigido na mesma proporção**
   (0,9102 → 1,8203 mm), preservando a extensão física de 466 mm.
5. Gravação como Int16 bruto comprimido (`volume.i16.gz`) + `manifest.json`.

Ferramenta: `ferramentas/dicom_para_volume.py`.

## Verificação de anonimização

Nenhum identificador de paciente, instituição ou médico encontrado nos metadados
da série. A coleção é distribuída já desidentificada pelo TCIA.

## Aviso

Volume de tomografia computadorizada **real**, de paciente anonimizado, usado
exclusivamente para **treinamento de operação de equipamento e posicionamento**.
Não se destina a interpretação diagnóstica, e a plataforma não oferece qualquer
orientação clínica.
