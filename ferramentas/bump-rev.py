#!/usr/bin/env python3
"""
ferramentas/bump-rev.py

Troca a revisao de cache de TODOS os assets em index.html.

Existe porque a versao nas URLs era fixa e o navegador servia js/*.js do
cache: uma alteracao no codigo simplesmente nao aparecia, sem nenhum sinal
disso. Custou varias rodadas de diagnostico ate perceber que o que rodava era
a versao antiga. Rode isto depois de qualquer alteracao em js/, core/ ou css/.
"""
import io, re, sys, datetime

alvo = "index.html"
s = io.open(alvo, encoding="utf-8", newline="").read()
atual = re.findall(r'\?v=([0-9a-z]+)', s)
hoje = datetime.date.today().strftime("%Y%m%d")
letras = "abcdefghijklmnopqrstuvwxyz"
usadas = sorted({v[8:] for v in atual if v.startswith(hoje) and len(v) > 8})
prox = letras[letras.index(usadas[-1]) + 1] if usadas and usadas[-1] in letras else "a"
nova = hoje + prox

s = re.sub(r'\?v=[0-9a-z]+', '?v=' + nova, s)
s = re.sub(r'window\.__SIMTC_REV__ = "[^"]*"', 'window.__SIMTC_REV__ = "%s"' % nova, s)
io.open(alvo, "w", encoding="utf-8", newline="").write(s)
print("revisao -> %s (%d referencias)" % (nova, len(atual)))
