#!/usr/bin/env python3
"""
ferramentas/zip_remoto.py

Le o indice de um arquivo ZIP remoto e extrai membros individuais por
requisicoes de faixa de bytes (HTTP Range), sem baixar o arquivo inteiro.

Motivo: o dataset TotalSegmentator e um zip unico de 22 GB no Zenodo, e o
simulador precisa de meia duzia de sujeitos. Baixar 22 GB para usar 0,5% deles
desperdicaria a banda e o disco do usuario. O servidor responde 206 Partial
Content com Accept-Ranges: bytes, entao da para:

  1. ler o fim do arquivo e achar o diretorio central (ZIP64, porque > 4 GB)
  2. baixar so o diretorio central (alguns MB)
  3. pedir, de cada membro desejado, apenas os bytes dele
  4. descomprimir localmente com zlib

Uso:
    python ferramentas/zip_remoto.py indice  <url> [--saida indice.json]
    python ferramentas/zip_remoto.py extrair <url> --indice indice.json \\
           --padrao "s0011/ct.nii.gz" --destino "ARQUIVOS DICON/ts"
"""

import argparse
import io
import json
import os
import struct
import subprocess
import sys
import zlib

# Assinaturas do formato ZIP (APPNOTE 4.3)
SIG_EOCD = b"PK\x05\x06"
SIG_EOCD64 = b"PK\x06\x06"
SIG_LOC64 = b"PK\x06\x07"
SIG_CEN = b"PK\x01\x02"
SIG_LOC = b"PK\x03\x04"

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"


def faixa(url, inicio, fim):
    """Baixa os bytes [inicio, fim] via curl. Devolve bytes."""
    cmd = ["curl", "-s", "-L", "--fail", "--max-time", "600",
           "-A", UA, "-r", "%d-%d" % (inicio, fim), url]
    p = subprocess.run(cmd, stdout=subprocess.PIPE)
    if p.returncode != 0:
        raise RuntimeError("curl falhou (%d) na faixa %d-%d" % (p.returncode, inicio, fim))
    return p.stdout


def tamanho_total(url):
    """Le o Content-Range de um pedido minimo para descobrir o tamanho."""
    cmd = ["curl", "-s", "-o", os.devnull, "-D", "-", "-L",
           "-A", UA, "-r", "0-0", "--max-time", "120", url]
    p = subprocess.run(cmd, stdout=subprocess.PIPE)
    for linha in p.stdout.decode("latin-1").splitlines():
        if linha.lower().startswith("content-range:"):
            return int(linha.split("/")[-1].strip())
    raise RuntimeError("servidor nao informou Content-Range — sem suporte a Range")


def ler_indice(url):
    """
    Devolve a lista de membros: nome, deslocamento do cabecalho local,
    tamanho comprimido, tamanho original e metodo de compressao.
    """
    total = tamanho_total(url)
    sys.stderr.write("tamanho remoto: %.2f GB\n" % (total / 1024**3))

    # 1) fim do arquivo: EOCD (e, se ZIP64, o localizador)
    cauda = min(65557 + 64, total)
    fim = faixa(url, total - cauda, total - 1)
    i = fim.rfind(SIG_EOCD)
    if i < 0:
        raise RuntimeError("EOCD nao encontrado — o arquivo nao parece um ZIP")

    n_ent = struct.unpack("<H", fim[i + 10:i + 12])[0]
    tam_cd = struct.unpack("<I", fim[i + 12:i + 16])[0]
    off_cd = struct.unpack("<I", fim[i + 16:i + 20])[0]

    # Valores 0xFFFFFFFF significam "veja o registro ZIP64".
    if off_cd == 0xFFFFFFFF or tam_cd == 0xFFFFFFFF or n_ent == 0xFFFF:
        j = fim.rfind(SIG_LOC64)
        if j < 0:
            raise RuntimeError("ZIP64 esperado, mas o localizador nao foi encontrado")
        off_eocd64 = struct.unpack("<Q", fim[j + 8:j + 16])[0]
        cab = faixa(url, off_eocd64, off_eocd64 + 55)
        if cab[:4] != SIG_EOCD64:
            raise RuntimeError("registro ZIP64 invalido")
        n_ent = struct.unpack("<Q", cab[32:40])[0]
        tam_cd = struct.unpack("<Q", cab[40:48])[0]
        off_cd = struct.unpack("<Q", cab[48:56])[0]

    sys.stderr.write("membros: %d · diretorio central: %.1f MB\n" % (n_ent, tam_cd / 1024**2))

    # 2) diretorio central inteiro
    cd = faixa(url, off_cd, off_cd + tam_cd - 1)

    # 3) percorre as entradas
    membros, pos = [], 0
    while pos + 46 <= len(cd) and cd[pos:pos + 4] == SIG_CEN:
        metodo = struct.unpack("<H", cd[pos + 10:pos + 12])[0]
        comp = struct.unpack("<I", cd[pos + 20:pos + 24])[0]
        orig = struct.unpack("<I", cd[pos + 24:pos + 28])[0]
        n_nome = struct.unpack("<H", cd[pos + 28:pos + 30])[0]
        n_extra = struct.unpack("<H", cd[pos + 30:pos + 32])[0]
        n_com = struct.unpack("<H", cd[pos + 32:pos + 34])[0]
        off_local = struct.unpack("<I", cd[pos + 42:pos + 46])[0]
        nome = cd[pos + 46:pos + 46 + n_nome].decode("utf-8", "replace")
        extra = cd[pos + 46 + n_nome:pos + 46 + n_nome + n_extra]

        # Campo extra 0x0001: valores de 64 bits, na ordem em que estouraram.
        if 0xFFFFFFFF in (comp, orig, off_local):
            k = 0
            while k + 4 <= len(extra):
                tag, tam = struct.unpack("<HH", extra[k:k + 4])
                if tag == 0x0001:
                    d, q = extra[k + 4:k + 4 + tam], 0
                    if orig == 0xFFFFFFFF and q + 8 <= len(d):
                        orig = struct.unpack("<Q", d[q:q + 8])[0]; q += 8
                    if comp == 0xFFFFFFFF and q + 8 <= len(d):
                        comp = struct.unpack("<Q", d[q:q + 8])[0]; q += 8
                    if off_local == 0xFFFFFFFF and q + 8 <= len(d):
                        off_local = struct.unpack("<Q", d[q:q + 8])[0]; q += 8
                    break
                k += 4 + tam

        if not nome.endswith("/"):
            membros.append({"nome": nome, "off": off_local, "comp": comp,
                            "orig": orig, "metodo": metodo})
        pos += 46 + n_nome + n_extra + n_com

    return {"url": url, "total": total, "membros": membros}


def extrair(url, membro, destino):
    """Baixa e descomprime um membro. Devolve o caminho gravado."""
    # O cabecalho local tem tamanhos de nome/extra proprios; le-se 30 bytes
    # fixos e depois o que eles indicarem.
    cab = faixa(url, membro["off"], membro["off"] + 29)
    if cab[:4] != SIG_LOC:
        raise RuntimeError("cabecalho local invalido em " + membro["nome"])
    n_nome = struct.unpack("<H", cab[26:28])[0]
    n_extra = struct.unpack("<H", cab[28:30])[0]
    ini = membro["off"] + 30 + n_nome + n_extra
    dados = faixa(url, ini, ini + membro["comp"] - 1)

    if membro["metodo"] == 0:
        cru = dados
    elif membro["metodo"] == 8:
        cru = zlib.decompress(dados, -15)
    else:
        raise RuntimeError("metodo de compressao %d nao suportado" % membro["metodo"])

    caminho = os.path.join(destino, membro["nome"].replace("/", os.sep))
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, "wb") as f:
        f.write(cru)
    return caminho, len(cru)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("indice")
    a.add_argument("url")
    a.add_argument("--saida", default="indice.json")

    b = sub.add_parser("extrair")
    b.add_argument("url")
    b.add_argument("--indice", required=True)
    b.add_argument("--padrao", action="append", required=True,
                   help="substring do caminho; pode repetir")
    b.add_argument("--destino", required=True)
    b.add_argument("--limite", type=int, default=0, help="maximo de arquivos")

    args = ap.parse_args()

    if args.cmd == "indice":
        idx = ler_indice(args.url)
        with open(args.saida, "w", encoding="utf-8") as f:
            json.dump(idx, f)
        print("indice gravado em %s (%d membros)" % (args.saida, len(idx["membros"])))
        return

    idx = json.load(open(args.indice, encoding="utf-8"))
    alvos = [m for m in idx["membros"] if any(p in m["nome"] for p in args.padrao)]
    if args.limite:
        alvos = alvos[:args.limite]
    if not alvos:
        sys.exit("nenhum membro casou com os padroes")
    total = sum(m["comp"] for m in alvos)
    print("%d arquivos · %.1f MB comprimidos" % (len(alvos), total / 1024**2))
    baixado = 0
    for i, m in enumerate(alvos, 1):
        caminho, n = extrair(args.url, m, args.destino)
        baixado += n
        print("  [%d/%d] %s  %.1f MB" % (i, len(alvos), m["nome"], n / 1024**2))
    print("total extraido: %.1f MB" % (baixado / 1024**2))


if __name__ == "__main__":
    main()
