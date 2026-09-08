# -*- coding: utf-8 -*-
"""
Gera assets/paciente/paciente.glb — uma paciente feminina como MALHA CONTÍNUA.

POR QUE ISTO EXISTE

A figura da sala é feita de primitivas: esferas e cilindros encaixados. Vista de
perto, é o que parece — peças coladas, com emendas visíveis onde um cilindro
entra numa esfera. Não há como consertar isso empilhando mais primitivas.

Uma malha de verdade se faz de outro jeito: um perfil que varia ao longo do
corpo, varrido em anéis, costurado em quadriláteros. É como um modelador faria,
só que aqui as medidas vêm de uma tabela antropométrica em vez de vir do olho.

Isto NÃO substitui o Blender. Substitui o nada: enquanto ninguém modelar uma
paciente de verdade, esta serve — e o dia em que houver uma melhor, é só trocar
o arquivo, porque o app lê qualquer .glb (ver assets/paciente/LEIA-ME.md).

COMO A FORMA É DEFINIDA

O tronco é uma pilha de anéis. Cada anel tem uma posição ao longo do eixo
cabeça-pés e uma SUPERELIPSE de raios (a, b) — largura e espessura —, porque
uma seção de tronco humano não é círculo nem retângulo: é algo entre os dois, e
o expoente da superelipse é exatamente esse "entre".

As medidas seguem uma mulher adulta de 1,65 m: biacromial 36 cm, cintura 72 cm
de circunferência, bi-ilíaca 36 cm, espessura AP do tórax 24 cm. Os membros são
tubos de raio variável seguindo uma linha de centro.

USO

    python ferramentas/gerar-paciente.py
    python ferramentas/gerar-paciente.py caminho/outro.glb

Sem dependências além da biblioteca padrão.
"""

import io
import json
import math
import os
import struct
import sys

# ---------------------------------------------------------------------------
# MEDIDAS — mulher adulta.
#
# Tudo em FRAÇÕES DA ESTATURA, que é como antropometria se mede e a única
# forma de estes números serem conferíveis. A primeira versão deste arquivo
# trazia metros soltos, e o resultado foi uma cintura de 15 cm: sem a fração,
# não havia contra o quê comparar.
#
# As larguras abaixo são as de referência para mulher adulta (biacromial
# 0,215·S, cintura 0,157·S, quadril 0,203·S). A profundidade do tórax sai da
# circunferência: uma elipse de 13,0 × 9,7 cm de semieixos tem perímetro de
# ~71 cm, que é a cintura de referência.
#
# Eixo do corpo: z = 0 na sola, z cresce para a cabeça.
# ---------------------------------------------------------------------------
ALTURA = 1.65

def _e(f):
    """Fração da estatura -> metros."""
    return f * ALTURA

# Marcos verticais, em frações da estatura (do chão).
Z_SOLA, Z_TORNOZELO, Z_JOELHO = 0.000, 0.039, 0.285
Z_VIRILHA, Z_TROCANTER, Z_CRISTA = 0.485, 0.520, 0.575
Z_CINTURA, Z_MAMILAR, Z_OMBRO = 0.600, 0.720, 0.818
Z_QUEIXO, Z_VERTICE = 0.870, 1.000

# (z, meia-largura, meia-espessura, expoente da superelipse)
#
# O expoente diz o quanto a seção é "quadrada": 2,0 é elipse pura (pescoço,
# cabeça, membros), ~2,5 é o tronco, que tem as costas quase planas — e é
# nisso que um corpo deitado numa mesa se apoia.
PERFIL_TRONCO = [
    (_e(Z_VIRILHA - 0.010), _e(0.086), _e(0.062), 2.4),  # raiz das coxas
    (_e(Z_TROCANTER),       _e(0.101), _e(0.066), 2.5),  # quadril mais largo
    (_e(Z_CRISTA),          _e(0.096), _e(0.062), 2.6),  # crista ilíaca
    (_e(0.590),             _e(0.084), _e(0.058), 2.5),
    (_e(Z_CINTURA),         _e(0.078), _e(0.058), 2.4),  # cintura
    (_e(0.640),             _e(0.081), _e(0.061), 2.4),
    (_e(0.680),             _e(0.086), _e(0.065), 2.5),  # rebordo costal
    (_e(Z_MAMILAR - 0.02),  _e(0.089), _e(0.067), 2.5),
    (_e(Z_MAMILAR),         _e(0.090), _e(0.068), 2.5),  # linha mamilar
    (_e(0.760),             _e(0.092), _e(0.064), 2.4),  # tórax alto
    (_e(0.795),             _e(0.100), _e(0.058), 2.3),
    (_e(Z_OMBRO),           _e(0.107), _e(0.052), 2.2),  # biacromial 0,215·S
    (_e(0.836),             _e(0.078), _e(0.046), 2.1),  # base do pescoço
    (_e(0.850),             _e(0.036), _e(0.036), 2.0),
    (_e(Z_QUEIXO - 0.008),  _e(0.031), _e(0.034), 2.0),  # pescoço
    (_e(Z_QUEIXO),          _e(0.034), _e(0.040), 2.0),  # mandíbula
    (_e(0.900),             _e(0.043), _e(0.052), 2.0),  # face
    (_e(0.935),             _e(0.045), _e(0.056), 2.0),  # crânio médio
    (_e(0.968),             _e(0.039), _e(0.048), 2.0),
    (_e(Z_VERTICE),         _e(0.020), _e(0.026), 2.0),  # vértice
]

# O busto entra como um deslocamento local somado à parede anterior do tórax,
# em vez de virar duas bolas grudadas: assim a superfície continua contínua.
BUSTO = {"z": _e(Z_MAMILAR), "sigma_z": _e(0.038),
         "x": _e(0.038), "sigma_x": _e(0.032), "altura": _e(0.024)}

# Membros: (x da linha de centro, z, raio). Os raios vêm de circunferências
# de referência: braço 27 cm, antebraço 24 cm, punho 15 cm, coxa 55 cm,
# panturrilha 34 cm, tornozelo 22 cm.
BRACO = [
    (_e(0.098), _e(0.812), _e(0.032)),   # deltoide
    (_e(0.104), _e(0.775), _e(0.026)),
    (_e(0.106), _e(0.730), _e(0.024)),   # braço
    (_e(0.108), _e(0.672), _e(0.022)),   # cotovelo
    (_e(0.110), _e(0.630), _e(0.022)),
    (_e(0.112), _e(0.575), _e(0.019)),   # antebraço
    (_e(0.113), _e(0.522), _e(0.015)),   # punho
    (_e(0.114), _e(0.495), _e(0.019)),   # mão
    (_e(0.114), _e(0.462), _e(0.015)),
    (_e(0.113), _e(0.442), _e(0.006)),   # dedos
]
PERNA = [
    (_e(0.048), _e(0.495), _e(0.053)),   # raiz da coxa
    (_e(0.049), _e(0.430), _e(0.049)),
    (_e(0.050), _e(0.355), _e(0.042)),   # coxa
    (_e(0.050), _e(Z_JOELHO), _e(0.034)),  # joelho
    (_e(0.049), _e(0.245), _e(0.033)),
    (_e(0.048), _e(0.185), _e(0.033)),   # panturrilha
    (_e(0.046), _e(0.110), _e(0.024)),
    (_e(0.045), _e(Z_TORNOZELO + 0.012), _e(0.019)),  # tornozelo
    (_e(0.044), _e(Z_TORNOZELO - 0.010), _e(0.021)),  # pé
    (_e(0.043), _e(Z_SOLA + 0.006), _e(0.014)),
]

SEGMENTOS = 32   # lados de cada anel

# Materiais: (nome, cor RGB, rugosidade)
MAT_PELE = (0.902, 0.741, 0.612, 0.62)
MAT_AVENTAL = (0.847, 0.886, 0.933, 0.90)
MAT_CABELO = (0.157, 0.125, 0.106, 0.80)
MAT_MEIA = (0.949, 0.949, 0.937, 0.85)

# O avental cobre do ombro ao meio da coxa.
AVENTAL_Z = (_e(0.390), _e(0.828))


def superelipse(a, b, n, seg):
    """Contorno de uma seção: nem círculo, nem retângulo."""
    pts = []
    for i in range(seg):
        th = 2.0 * math.pi * i / seg
        ct, st = math.cos(th), math.sin(th)
        x = a * math.copysign(abs(ct) ** (2.0 / n), ct)
        y = b * math.copysign(abs(st) ** (2.0 / n), st)
        pts.append((x, y))
    return pts


def suavizar(perfil, passos=4):
    """Interpola entre os anéis medidos, para a superfície não facetar."""
    saida = []
    for i in range(len(perfil) - 1):
        z0, a0, b0, n0 = perfil[i]
        z1, a1, b1, n1 = perfil[i + 1]
        for k in range(passos):
            u = k / float(passos)
            # Suavização de Hermite: chega e sai de cada anel medido sem quina.
            s = u * u * (3 - 2 * u)
            saida.append((z0 + (z1 - z0) * u,
                          a0 + (a1 - a0) * s,
                          b0 + (b1 - b0) * s,
                          n0 + (n1 - n0) * s))
    saida.append(perfil[-1])
    return saida


def deslocamento_busto(x, z):
    """Quanto a parede anterior avança, neste ponto, por causa do busto."""
    dz = (z - BUSTO["z"]) / BUSTO["sigma_z"]
    dx = (abs(x) - BUSTO["x"]) / BUSTO["sigma_x"]
    return BUSTO["altura"] * math.exp(-0.5 * (dz * dz + dx * dx))


def malha_tronco():
    aneis = suavizar(PERFIL_TRONCO)
    verts, quads = [], []
    for (z, a, b, n) in aneis:
        base = len(verts)
        for (x, y) in superelipse(a, b, n, SEGMENTOS):
            # y > 0 é a frente (o lado que olha para cima quando deitada).
            if y > 0:
                y += deslocamento_busto(x, z) * (y / b)
            verts.append((x, y, z))
        if base > 0:
            ant = base - SEGMENTOS
            for i in range(SEGMENTOS):
                j = (i + 1) % SEGMENTOS
                quads.append((ant + i, ant + j, base + j, base + i))
    # Tampas: um leque para cada ponta, para o sólido fechar.
    tampas = []
    for (inicio, invertido) in ((0, True), (len(verts) - SEGMENTOS, False)):
        cz = verts[inicio][2]
        centro = len(verts) + len(tampas)
        tampas.append((0.0, 0.0, cz))
        for i in range(SEGMENTOS):
            j = (i + 1) % SEGMENTOS
            if invertido:
                quads.append((centro, inicio + j, inicio + i, None))
            else:
                quads.append((centro, inicio + i, inicio + j, None))
    verts.extend(tampas)
    return verts, quads


def malha_tubo(centro, espelhar_x=False):
    """Tubo de raio variável ao longo de uma linha de centro (x, z)."""
    pts = []
    for i in range(len(centro) - 1):
        for k in range(3):
            u = k / 3.0
            x0, z0, r0 = centro[i]
            x1, z1, r1 = centro[i + 1]
            s = u * u * (3 - 2 * u)
            pts.append((x0 + (x1 - x0) * u, z0 + (z1 - z0) * u, r0 + (r1 - r0) * s))
    pts.append(centro[-1])

    verts, quads = [], []
    for (cx, cz, r) in pts:
        base = len(verts)
        x = -cx if espelhar_x else cx
        for i in range(SEGMENTOS):
            th = 2.0 * math.pi * i / SEGMENTOS
            verts.append((x + r * math.cos(th), r * math.sin(th), cz))
        if base > 0:
            ant = base - SEGMENTOS
            for i in range(SEGMENTOS):
                j = (i + 1) % SEGMENTOS
                quads.append((ant + i, ant + j, base + j, base + i))
    for (inicio, invertido) in ((0, True), (len(verts) - SEGMENTOS, False)):
        cz = verts[inicio][2]
        cx = -pts[0][0] if espelhar_x else pts[0][0]
        if inicio != 0:
            cx = -pts[-1][0] if espelhar_x else pts[-1][0]
            cz = pts[-1][1]
        else:
            cz = pts[0][1]
        centro_idx = len(verts)
        verts.append((cx, 0.0, cz))
        for i in range(SEGMENTOS):
            j = (i + 1) % SEGMENTOS
            if invertido:
                quads.append((centro_idx, inicio + j, inicio + i, None))
            else:
                quads.append((centro_idx, inicio + i, inicio + j, None))
    return verts, quads


def malha_cabelo():
    """Calota + coque, seguindo o crânio do perfil."""
    perfil = [
        (_e(0.878), _e(0.038), _e(0.045), 2.0),
        (_e(0.905), _e(0.046), _e(0.056), 2.0),
        (_e(0.937), _e(0.048), _e(0.060), 2.0),
        (_e(0.970), _e(0.042), _e(0.052), 2.0),
        (_e(1.004), _e(0.023), _e(0.029), 2.0),
    ]
    aneis = suavizar(perfil, 3)
    verts, quads = [], []
    for (z, a, b, n) in aneis:
        base = len(verts)
        for (x, y) in superelipse(a, b, n, SEGMENTOS):
            # O cabelo só existe atrás e dos lados: a frente é rosto.
            if y > 0.35 * b and abs(x) < 0.62 * a:
                y *= 0.90   # recua na testa, sem sumir
            verts.append((x, y, z))
        if base > 0:
            ant = base - SEGMENTOS
            for i in range(SEGMENTOS):
                j = (i + 1) % SEGMENTOS
                quads.append((ant + i, ant + j, base + j, base + i))
    # Coque, atrás e abaixo do vértice.
    cbase = len(verts)
    for i in range(SEGMENTOS):
        for k in range(6):
            fi = math.pi * k / 5.0
            th = 2.0 * math.pi * i / SEGMENTOS
            r = _e(0.026)
            verts.append((r * math.sin(fi) * math.cos(th),
                          -_e(0.052) + r * math.sin(fi) * math.sin(th) * 0.85,
                          _e(0.955) + r * math.cos(fi) * 0.9))
    for i in range(SEGMENTOS):
        j = (i + 1) % SEGMENTOS
        for k in range(5):
            quads.append((cbase + i * 6 + k, cbase + j * 6 + k,
                          cbase + j * 6 + k + 1, cbase + i * 6 + k + 1))
    return verts, quads


def triangular(verts, quads):
    """Quads (e leques com None) viram triângulos."""
    tris = []
    for q in quads:
        if q[3] is None:
            tris.append((q[0], q[1], q[2]))
        else:
            tris.append((q[0], q[1], q[2]))
            tris.append((q[0], q[2], q[3]))
    # Remove triângulos degenerados, que sujam a normal.
    return [t for t in tris if t[0] != t[1] and t[1] != t[2] and t[0] != t[2]]


def normais(verts, tris):
    """Normais por vértice, pela média das faces — é o que suaviza a casca."""
    acc = [[0.0, 0.0, 0.0] for _ in verts]
    for (i0, i1, i2) in tris:
        a, b, c = verts[i0], verts[i1], verts[i2]
        u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
        n = (u[1] * v[2] - u[2] * v[1],
             u[2] * v[0] - u[0] * v[2],
             u[0] * v[1] - u[1] * v[0])
        for i in (i0, i1, i2):
            acc[i][0] += n[0]; acc[i][1] += n[1]; acc[i][2] += n[2]
    out = []
    for n in acc:
        m = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1.0
        out.append((n[0] / m, n[1] / m, n[2] / m))
    return out


def parte(verts, quads, material):
    tris = triangular(verts, quads)
    return {"verts": verts, "tris": tris, "normais": normais(verts, tris), "mat": material}


def dividir_por_material(p):
    """Separa o tronco em pele e avental, pelo z de cada triângulo."""
    z0, z1 = AVENTAL_Z
    pele, avental = [], []
    for t in p["tris"]:
        zm = sum(p["verts"][i][2] for i in t) / 3.0
        (avental if z0 <= zm <= z1 else pele).append(t)
    return pele, avental


def montar():
    partes = []

    tv, tq = malha_tronco()
    tronco = parte(tv, tq, None)
    pele_tris, avental_tris = dividir_por_material(tronco)
    partes.append({"verts": tv, "tris": pele_tris, "normais": tronco["normais"], "mat": 0})
    partes.append({"verts": tv, "tris": avental_tris, "normais": tronco["normais"], "mat": 1})

    for espelho in (False, True):
        bv, bq = malha_tubo(BRACO, espelho)
        partes.append(parte(bv, bq, 0))
        pv, pq = malha_tubo(PERNA, espelho)
        partes.append(parte(pv, pq, 0))

    hv, hq = malha_cabelo()
    partes.append(parte(hv, hq, 2))
    return partes


# ---------------------------------------------------------------------------
# Escrita do GLB
# ---------------------------------------------------------------------------
def escrever_glb(partes, destino):
    bin_bytes = bytearray()
    accessors, bufferViews, meshes_prims = [], [], []

    def bv(dados, alvo):
        while len(bin_bytes) % 4:
            bin_bytes.append(0)
        off = len(bin_bytes)
        bin_bytes.extend(dados)
        bufferViews.append({"buffer": 0, "byteOffset": off,
                            "byteLength": len(dados), "target": alvo})
        return len(bufferViews) - 1

    for p in partes:
        if not p["tris"]:
            continue
        # Reindexa: cada parte usa só os vértices que seus triângulos citam.
        usados, remap = [], {}
        for t in p["tris"]:
            for i in t:
                if i not in remap:
                    remap[i] = len(usados)
                    usados.append(i)
        pos = b"".join(struct.pack("<fff", *p["verts"][i]) for i in usados)
        nor = b"".join(struct.pack("<fff", *p["normais"][i]) for i in usados)
        idx = b"".join(struct.pack("<I", remap[i]) for t in p["tris"] for i in t)

        xs = [p["verts"][i][0] for i in usados]
        ys = [p["verts"][i][1] for i in usados]
        zs = [p["verts"][i][2] for i in usados]

        bvp, bvn, bvi = bv(pos, 34962), bv(nor, 34962), bv(idx, 34963)
        accessors.append({"bufferView": bvp, "componentType": 5126,
                          "count": len(usados), "type": "VEC3",
                          "min": [min(xs), min(ys), min(zs)],
                          "max": [max(xs), max(ys), max(zs)]})
        accessors.append({"bufferView": bvn, "componentType": 5126,
                          "count": len(usados), "type": "VEC3"})
        accessors.append({"bufferView": bvi, "componentType": 5125,
                          "count": len(p["tris"]) * 3, "type": "SCALAR"})
        n = len(accessors)
        meshes_prims.append({
            "attributes": {"POSITION": n - 3, "NORMAL": n - 2},
            "indices": n - 1, "material": p["mat"], "mode": 4})

    def material(nome, cor, rug):
        return {"name": nome,
                "pbrMetallicRoughness": {
                    "baseColorFactor": [cor[0], cor[1], cor[2], 1.0],
                    "metallicFactor": 0.0, "roughnessFactor": rug},
                "doubleSided": False}

    gltf = {
        "asset": {"version": "2.0",
                  "generator": "Simulador TC — ferramentas/gerar-paciente.py"},
        "scene": 0,
        "scenes": [{"nodes": [0], "name": "paciente"}],
        "nodes": [{"mesh": 0, "name": "paciente"}],
        "meshes": [{"name": "paciente", "primitives": meshes_prims}],
        "materials": [
            material("pele", MAT_PELE[:3], MAT_PELE[3]),
            material("avental", MAT_AVENTAL[:3], MAT_AVENTAL[3]),
            material("cabelo", MAT_CABELO[:3], MAT_CABELO[3]),
        ],
        "accessors": accessors,
        "bufferViews": bufferViews,
        "buffers": [{"byteLength": len(bin_bytes)}],
    }

    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(js) % 4:
        js += b" "
    while len(bin_bytes) % 4:
        bin_bytes.append(0)

    corpo = (struct.pack("<II", len(js), 0x4E4F534A) + js +
             struct.pack("<II", len(bin_bytes), 0x004E4942) + bytes(bin_bytes))
    glb = struct.pack("<III", 0x46546C67, 2, 12 + len(corpo)) + corpo

    d = os.path.dirname(destino)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    io.open(destino, "wb").write(glb)
    return glb, gltf


def main():
    destino = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        "assets", "paciente", "paciente.glb")
    partes = montar()
    glb, gltf = escrever_glb(partes, destino)

    nv = sum(len(p["tris"]) * 3 for p in partes if p["tris"])
    nt = sum(len(p["tris"]) for p in partes if p["tris"])
    todos = [v for p in partes for v in p["verts"]]
    xs = [v[0] for v in todos]; ys = [v[1] for v in todos]; zs = [v[2] for v in todos]

    print("%s  %.1f KB" % (destino, len(glb) / 1024.0))
    print("%d triangulos em %d primitivas" % (nt, len(gltf["meshes"][0]["primitives"])))
    print("caixa (cm)  largura %.1f  espessura %.1f  comprimento %.1f"
          % ((max(xs) - min(xs)) * 100, (max(ys) - min(ys)) * 100, (max(zs) - min(zs)) * 100))
    def largura_em(zf):
        """Largura do TRONCO. Medir tudo media os bracos, que a essa altura
        sao o ponto mais lateral do corpo — e a primeira versao deste relatorio
        anunciou uma cintura de 43 cm por causa disso."""
        z = _e(zf); mx = 0.0
        for p in partes[:2]:          # 0 = pele do tronco, 1 = avental
            for t2 in p["tris"]:
                for i in t2:
                    v = p["verts"][i]
                    if abs(v[2] - z) < 0.012:
                        mx = max(mx, abs(v[0]))
        return mx * 200

    print("larguras medidas (cm)  ombro %.1f  busto %.1f  cintura %.1f  quadril %.1f"
          % (largura_em(Z_OMBRO), largura_em(Z_MAMILAR),
             largura_em(Z_CINTURA), largura_em(Z_TROCANTER)))


if __name__ == "__main__":
    main()
