#!/usr/bin/env python3
"""
ferramentas/mesa.py

Tira a mesa do tomografo (e apoios de cabeca) do volume, deixando so o
paciente.

POR QUE: a plataforma ja desenha a propria mesa e ja modela a posicao dela.
Um volume que carrega a mesa original produz duas mesas na cena, e pior:
infla a largura medida do paciente, que alimenta a validacao de FOV, o
diametro efetivo do SSDE e a modulacao do AEC. Neste volume a mesa levava a
largura de 420 para 454 mm.

COMO: a mesa e uma casca fina de material denso, posterior ao paciente e
separada dele por ar. Percorrendo cada coluna do lado posterior para o
anterior, todo trecho fino (<= limite) seguido de uma folga de ar e mesa; o
primeiro trecho espesso e o paciente, e a varredura para ali. Assim um braco
encostado no tronco nunca e confundido com mesa, porque braco e trecho
espesso.

O limite de espessura e deliberadamente APERTADO (12 mm). Os arcos da mesa tem
3 a 5 mm. Com 30 mm a varredura atravessava a parede toracica posterior, que e
mais fina que isso em algumas colunas, e passava a apagar vasos pulmonares: no
pulmao o parenquima fica abaixo do limiar de ar, entao cada vaso parece um
trecho fino isolado. Frouxo demais, a rotina come anatomia.
"""

import numpy as np

AR = -300          # HU abaixo disso e ar
FINO_MM = 12.0     # trecho mais fino que isto pode ser mesa
FOLGA_MM = 4.0     # ar minimo entre a mesa e o paciente


def _trechos(coluna):
    """Indices [inicio, fim) de cada trecho contiguo de True."""
    d = np.diff(np.concatenate(([0], coluna.view(np.int8), [0])))
    return list(zip(np.where(d == 1)[0], np.where(d == -1)[0]))


def remover(vol, espacamento_y, fino_mm=FINO_MM, folga_mm=FOLGA_MM, ar=AR):
    """
    vol em [z, y, x] com y crescendo para POSTERIOR. Devolve (volume, stats).
    O que for identificado como mesa vira ar (-1000).
    """
    fino = max(1, int(round(fino_mm / espacamento_y)))
    folga = max(1, int(round(folga_mm / espacamento_y)))
    saida = vol.copy()
    removidos = 0
    total = 0

    for k in range(vol.shape[0]):
        tecido = vol[k] > ar
        total += int(tecido.sum())
        for x in range(vol.shape[2]):
            col = tecido[:, x]
            if not col.any():
                continue
            tr = _trechos(col)
            # do posterior (y alto) para o anterior
            for ini, fim in reversed(tr):
                if fim - ini > fino:
                    break                      # paciente: para aqui
                anterior = [t for t in tr if t[1] <= ini]
                if anterior and ini - anterior[-1][1] < folga:
                    break                      # colado no que vem antes: nao e mesa
                saida[k, ini:fim, x] = -1000
                removidos += fim - ini

    return saida, {"removidos": removidos, "total": total,
                   "pct": 100.0 * removidos / max(1, total)}
