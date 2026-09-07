#!/usr/bin/env python3
"""
ferramentas/bump-rev.py

Troca a revisao de cache de TODOS os assets do projeto.

Existe porque a versao nas URLs era fixa e o navegador servia js/*.js do
cache: uma alteracao no codigo simplesmente nao aparecia, sem nenhum sinal
disso. Custou varias rodadas de diagnostico ate perceber que o que rodava era
a versao antiga. Rode isto depois de qualquer alteracao em js/, core/, css/ ou
dicom-viewer/.

QUATRO CAMADAS, porque o problema reapareceu em cada uma delas:

  1. index.html            os <script src="...?v=">, o <link> do CSS e o
                           src do iframe do leitor.

  2. dicom-viewer/*.html   a pagina do leitor tem os proprios scripts. Sem
                           versiona-los, versionar so o iframe adiantava
                           pouco: a pagina recarregava e trazia o mesmo JS.

  3. os `import` entre     o leitor usa ES modules. O navegador cacheia cada
     modulos do leitor     modulo pela URL do especificador; versionar so o
                           modulo de ENTRADA deixa volume.js, mpr.js e
                           render3d.js presos na versao antiga. Foi
                           exatamente assim que uma alteracao no slab nao
                           apareceu, com a pagina servindo HTML novo e JS
                           velho.

  4. as tags que NUNCA     ate aqui o script so SUBSTITUIA `?v=` onde ele ja
     tiveram `?v=`         existia — nunca acrescentava. Uma tag escrita sem
                           versao ficava permanentemente fora do processo, e
                           nenhum bump a alcancava. Estava acontecendo em
                           dois lugares:

                             dicom-viewer/index.html   -> css/style.css
                             dicom-viewer/celular.html -> js/app-celular.js
                                                          css/celular.css

                           O do celular era o pior: celular.html e para onde
                           a propria pagina do leitor redireciona em toque +
                           tela estreita, e um modulo de ENTRADA sem versao
                           congela toda a arvore de imports abaixo dele — que
                           ja estavam versionados, e por isso mesmo presos na
                           revisao antiga. O leitor no celular ficava inteiro
                           numa versao velha, sem sinal nenhum.

                           Agora o script ACRESCENTA a versao a qualquer
                           src/href local que aponte para .js ou .css. Uma tag
                           nova entra no processo sozinha, sem depender de
                           alguem lembrar.

Excecao: js/vendor/. O three.min.js tem 603 KB, esta pinado em r128 e nao muda
entre revisoes; versiona-lo faria cada bump do dia forcar um download novo. Se
um dia ele for trocado, troque tambem o nome do arquivo.
"""
import datetime
import io
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HTMLS = [
    "index.html",
    os.path.join("dicom-viewer", "index.html"),
    os.path.join("dicom-viewer", "celular.html"),
    # A pagina de testes do leitor importa ../dicom-viewer/js/*.js direto. Sem
    # versao ali, a suite pode rodar sobre um modulo antigo do cache e dar
    # verde sobre codigo que nao e o que esta no disco — o pior resultado
    # possivel num teste. (testes/core.html nao entra na lista: ele ja usa
    # Date.now() como cache-buster do proprio Worker.)
    os.path.join("testes", "leitor.html"),
]
DIRS_MODULOS = [os.path.join("dicom-viewer", "js")]

# Caminhos cujo conteudo NAO leva versao (ver a excecao no cabecalho).
SEM_VERSAO = ("js/vendor/",)

EXTENSOES = (".js", ".css")

# src="..." / href="..." — o valor nao pode conter aspas nem '>', o que ja
# descarta o <link rel="icon" href="data:image/svg+xml,<svg ...>">.
ATRIBUTO = re.compile(
    r"""(?P<pre>\b(?:src|href)\s*=\s*(?P<aspas>["']))(?P<url>[^"'>]+)(?P=aspas)""")

# from './x.js' | import './x.js' | import('./x.js'), com ou sem versao, em
# qualquer profundidade de pasta ('./volume.js' e '../dicom-viewer/js/mpr.js').
IMPORTACAO = re.compile(
    r"""(?P<pre>(?:from|import)\s*\(?\s*(?P<aspas>["']))"""
    r"""(?P<url>\.{1,2}/[^"']+?\.js)(?:\?v=[0-9a-z]+)?(?P=aspas)""")


def ler(caminho):
    return io.open(caminho, encoding="utf-8", newline="").read()


def gravar(caminho, texto):
    io.open(caminho, "w", encoding="utf-8", newline="").write(texto)


def proxima_letra(seq):
    """
    Contador bijetivo base 26: a, b, ... z, aa, ab, ...

    Antes disto, depois do 'z' o sufixo voltava para 'a' e REUSAVA uma revisao
    ja servida naquele mesmo dia — o navegador entao servia do cache a versao
    guardada sob aquela URL, que e exatamente a falha que este script existe
    para evitar. Chegar a 26 bumps num dia de depuracao nao e hipotese remota:
    ja se chegou ao 'j'.
    """
    if not seq:
        return "a"
    letras = list(seq)
    i = len(letras) - 1
    while i >= 0:
        if letras[i] != "z":
            letras[i] = chr(ord(letras[i]) + 1)
            return "".join(letras)
        letras[i] = "a"
        i -= 1
    return "a" + "".join(letras)


def proxima_revisao(textos):
    atual = []
    for t in textos:
        atual += re.findall(r"[?&]v=([0-9a-z]+)", t)
    hoje = datetime.date.today().strftime("%Y%m%d")
    usadas = [v[8:] for v in atual
              if v.startswith(hoje) and re.match(r"^[a-z]+$", v[8:])]
    # Ordem do CONTADOR, nao ordem alfabetica: 'aa' vem depois de 'z', e
    # sorted() puro poria 'aa' antes.
    ultima = max(usadas, key=lambda s: (len(s), s)) if usadas else ""
    return hoje + proxima_letra(ultima), len(atual)


def local(url):
    """URL relativa ao projeto — nao e absoluta, nem data:, nem ancora."""
    return not re.match(r"^(?:[a-z][a-z0-9+.\-]*:|//|#)", url, re.I)


def versionar(texto, nova):
    """
    Poe `nova` em tudo que leva revisao: o que ja tinha `?v=`, os src/href de
    .js e .css que ainda nao tinham, e os especificadores de import.
    """
    texto = re.sub(r"([?&]v=)[0-9a-z]+", r"\g<1>" + nova, texto)
    texto = re.sub(r'window\.__SIMTC_REV__ = "[^"]*"',
                   'window.__SIMTC_REV__ = "%s"' % nova, texto)

    def marcar(m):
        url = m.group("url")
        caminho = url.split("?", 1)[0].split("#", 1)[0]
        if not local(url) or not caminho.lower().endswith(EXTENSOES):
            return m.group(0)
        if any(p in ("./" + caminho) for p in SEM_VERSAO):
            return m.group(0)
        if re.search(r"[?&]v=", url):
            return m.group(0)          # ja versionado na substituicao acima
        sep = "&" if "?" in url else "?"
        return m.group("pre") + url + sep + "v=" + nova + m.group("aspas")

    texto = ATRIBUTO.sub(marcar, texto)
    texto = IMPORTACAO.sub(
        lambda m: m.group("pre") + m.group("url") + "?v=" + nova + m.group("aspas"),
        texto)
    return texto


def main():
    caminhos = [os.path.join(RAIZ, h) for h in HTMLS]
    caminhos = [c for c in caminhos if os.path.exists(c)]
    if not caminhos:
        sys.exit("nenhum HTML encontrado a partir de " + RAIZ)

    for d in DIRS_MODULOS:
        dir_mod = os.path.join(RAIZ, d)
        if not os.path.isdir(dir_mod):
            continue
        for nome in sorted(os.listdir(dir_mod)):
            if nome.endswith(".js"):
                caminhos.append(os.path.join(dir_mod, nome))

    textos = [ler(c) for c in caminhos]
    nova, _ = proxima_revisao(textos)

    total = 0
    reescritos = 0
    for caminho, texto in zip(caminhos, textos):
        novo = versionar(texto, nova)
        if novo != texto:
            gravar(caminho, novo)
            reescritos += 1
        total += len(re.findall(r"[?&]v=" + nova + r"(?![0-9a-z])", novo))

    print("revisao -> %s (%d referencias, %d de %d arquivos reescritos)"
          % (nova, total, reescritos, len(caminhos)))


if __name__ == "__main__":
    main()
