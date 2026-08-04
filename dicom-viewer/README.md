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

Os volumes gerados a partir dos PNGs do simulador possuem HU aproximados pela
inversão da janela de exibição e servem apenas ao treinamento de ferramentas.
Séries DICOM locais continuam usando pixels, geometria e HU dos próprios
arquivos.
