#!/usr/bin/env python3
"""
ferramentas/orientacao.py

Leva um volume para a convencao que a plataforma usa, derivando a operacao da
matriz afim em vez de assumir.

A PLATAFORMA usa a mesma convencao do DICOM (LPS), porque foi de DICOM que
vieram os primeiros volumes:

    x cresce -> ESQUERDA do paciente   (coluna 0 exibida = direita do paciente)
    y cresce -> POSTERIOR              (linha 0 exibida  = anterior)
    z cresce -> SUPERIOR               (indice 0 = pes)

O NIfTI do TotalSegmentator usa RAS: x cresce para a DIREITA e y para a
FRENTE. Converter de um para o outro exige espelhar dois eixos. Nao e detalhe
cosmetico: um volume com o eixo y invertido produz topograma de perfil com o
paciente de bruços e escaneia o lado errado quando o operador desloca a mesa.
"""

import numpy as np

# Para cada eixo do array, para onde ele aponta no paciente, em LPS.
# +0 = Esquerda, +1 = Posterior, +2 = Superior
LPS = ("L", "P", "S")


def eixos_do_afim(afim):
    """
    Para cada coluna da afim (eixo i, j, k do array), devolve (eixo_paciente,
    sentido) em LPS. A afim NIfTI e sempre RAS, entao x e y trocam de sinal
    ao virar LPS.
    """
    rot = np.asarray(afim, dtype=float)[:3, :3]
    # RAS -> LPS: nega as duas primeiras linhas
    rot = rot * np.array([[-1.0], [-1.0], [1.0]])
    saida = []
    usados = set()
    for col in range(3):
        c = rot[:, col]
        ordem = np.argsort(-np.abs(c))
        k = next(int(e) for e in ordem if int(e) not in usados)
        usados.add(k)
        saida.append((k, 1 if c[k] >= 0 else -1))
    return saida  # [(eixo_lps, sentido), ...] na ordem i, j, k


def para_lps(vol, afim, espacamento):
    """
    Reordena e espelha `vol` (indexado [k, j, i]) para [z, y, x] em LPS.
    Devolve (volume, espacamento_reordenado, descricao).
    """
    eixos = eixos_do_afim(afim)          # na ordem i, j, k
    # vol esta em [k, j, i]; monta o mapa eixo_array_do_volume -> eixo_lps
    # eixo 0 do vol = k, eixo 1 = j, eixo 2 = i
    por_eixo_vol = [eixos[2], eixos[1], eixos[0]]

    destino = {2: 0, 1: 1, 0: 2}         # LPS S->eixo0(z), P->eixo1(y), L->eixo2(x)
    ordem = [None, None, None]
    sentidos = [1, 1, 1]
    for eixo_vol, (eixo_lps, sentido) in enumerate(por_eixo_vol):
        alvo = destino[eixo_lps]
        ordem[alvo] = eixo_vol
        sentidos[alvo] = sentido

    if any(o is None for o in ordem):
        raise ValueError("matriz afim degenerada: eixos ambiguos")

    saida = np.transpose(vol, ordem)
    esp = [espacamento[o] for o in ordem]
    fatias = tuple(slice(None, None, s) for s in sentidos)
    saida = saida[fatias]

    desc = ", ".join(
        "eixo %d <- %s%s" % (i, "+-"[sentidos[i] < 0], "kji"[ordem[i]])
        for i in range(3)
    )
    return np.ascontiguousarray(saida), esp, desc
