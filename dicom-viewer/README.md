# Motor DICOM incorporado

Esta pasta contém a interface e o motor do repositório
`Jonas-oa/Leitor-Dicon`, incorporados à etapa **MPR / 3D** do Simulador TC.

- Fonte: branch `claude/leitor-dicon-project-dylttz`, commit
  `ec61232e1846cc5a18d15a7ccb63a188a560eb98`.
- Licença original preservada em `LICENSE`.
- Os datasets de demonstração não foram duplicados; o simulador envia sua
  aquisição por `postMessage` same-origin e o leitor continua aceitando séries
  DICOM locais.
- `js/simulator-bridge.js` é a camada de integração específica do simulador.

O simulador envia a **série reconstruída**: `Int16Array` com os HU que a
retroprojeção filtrada produziu, mais o `pixelMm` e o `incrementoMm` que a
própria reconstrução definiu. Séries DICOM locais continuam usando pixels,
geometria e HU dos próprios arquivos.

> Até setembro de 2026 o simulador enviava um volume remontado a partir dos
> PNG já janelados, com HU aproximados pela inversa da janela — e declarava
> `unidadeHU: true` para uma faixa que ia de −160 a +239. Esse caminho foi
> removido; a medida de HU no leitor passou a valer.

## Fronteira de vendor

Esta pasta é **cópia de outro repositório**. As ferramentas de medida daqui
(`js/medidas.js`) e as do simulador (`../js/medidas.js`) calculam distância,
ângulo e ROI de forma parecida, e essa duplicação é **deliberada**: unificá-las
exigiria acoplar este leitor ao `core/` do simulador, quebrando tanto a
possibilidade de rodá-lo sozinho quanto a de ressincronizar com o Leitor-Dicon.
Os dois modelos também diferem de verdade — aqui se mede num volume com
espaçamento por eixo em 3D; lá, numa série reconstruída com `pixelMm` escalar,
no plano axial.
