# Crânio — procedência, licença e ressalva de privacidade

## Origem

- **Coleção:** CPTAC-AML — *Clinical Proteomic Tumor Analysis Consortium,
  Acute Myeloid Leukemia*
- **Arquivo:** The Cancer Imaging Archive (TCIA), National Cancer Institute
- **Página:** https://www.cancerimagingarchive.net/collection/cptac-aml/
- **Série usada:** `1.3.6.1.4.1.14519.5.2.1.1427.3349.229210653099650723826829987408`
  (descrição original `Head WO 5mm`, 34 cortes — sem contraste)
- **Baixado em:** 2026-09-01, via API REST pública do TCIA (`getImage`, v1)

## Licença

**Creative Commons Attribution 4.0 International (CC BY 4.0)**
https://creativecommons.org/licenses/by/4.0/

Permite uso, redistribuição e **uso comercial**, com atribuição. Sem
NonCommercial e sem ShareAlike. A página da coleção não registra restrição de
acesso controlado para esta série.

Sujeito à *TCIA Data Usage Policy*:
https://www.cancerimagingarchive.net/data-usage-policies-and-restrictions/

## Atribuição exigida

> National Cancer Institute Clinical Proteomic Tumor Analysis Consortium (CPTAC).
> (2019). **The Clinical Proteomic Tumor Analysis Consortium Acute Myeloid
> Leukemia Collection (CPTAC-AML)** (Version 5) [Data set]. The Cancer Imaging
> Archive. https://doi.org/10.7937/tcia.2019.b6foe619

Agradecimento solicitado:

> Os dados usados nesta publicação foram gerados pelo National Cancer Institute
> Clinical Proteomic Tumor Analysis Consortium (CPTAC).

---

## ⚠ Ressalva de privacidade — decisão registrada

**Este volume contém anatomia facial e não foi desfigurado.**

É tecnicamente possível **reconstruir o rosto de uma pessoa a partir de uma TC de
crânio**. Por esse motivo, várias coleções do TCIA colocam imagens de cabeça sob
a *NIH Controlled Data Access Policy*, e a literatura recente demonstra que
técnicas de desfiguração (*defacing*) podem ser revertidas por modelos
generativos de difusão.

O risco foi apresentado ao responsável pelo produto em 2026-09-01, junto com três
alternativas (crânio sintético em HU reais; crânio real com a face removida;
adiar). **A decisão foi usar a série real sem alteração, com revisão jurídica
posterior.**

Consequências a considerar antes de comercializar:

1. A imagem é redistribuída dentro do produto — isso é publicação, não uso interno.
2. A licença CC BY **autoriza** a redistribuição; a ressalva aqui é de privacidade
   e proteção de dados, não de direito autoral. São regimes distintos.
3. A troca é barata: o volume obedece ao mesmo contrato de `manifest.json` que as
   demais regiões. Substituir por um crânio sintético ou desfigurado é trocar dois
   arquivos, sem tocar no restante do simulador.

## Processamento aplicado

1. Cortes ordenados por `ImagePositionPatient` projetada na normal do plano.
2. Verificação de aquisição não oblíqua e espaçamento regular (5,0 mm constante).
3. Conversão para HU com `RescaleSlope` / `RescaleIntercept`.
4. Subamostragem 2× no plano **com o espaçamento corrigido** (0,4883 → 0,9766 mm),
   preservando a extensão física de 250 mm.
5. Gravação como Int16 bruto comprimido + `manifest.json`.

Ferramenta: `ferramentas/dicom_para_volume.py`.

## Limitação conhecida

**Resolução no eixo crânio-caudal é grosseira:** 34 cortes de 5,0 mm. É o melhor
disponível no TCIA sob CC BY — o arquivo é de oncologia e crânio ali é quase todo
ressonância, não tomografia. Reformatações coronal e sagital deste volume ficarão
visivelmente escalonadas. Para MPR de qualidade, o crânio precisará de outra
fonte ou de um fantoma sintético de alta resolução.

## Verificação de anonimização

Nenhum identificador de paciente, instituição ou médico encontrado nos metadados.
A coleção é distribuída já desidentificada pelo TCIA — o que **não** elimina a
ressalva de reconstrução facial acima, que independe de metadados.

## Aviso

Volume de tomografia computadorizada **real**, de paciente anonimizado, usado
exclusivamente para **treinamento de operação de equipamento e posicionamento**.
A plataforma não interpreta exames nem oferece qualquer orientação clínica ou
diagnóstica.
