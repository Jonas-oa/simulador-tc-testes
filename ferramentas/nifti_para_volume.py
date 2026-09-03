#!/usr/bin/env python3
"""
ferramentas/nifti_para_volume.py

Converte um volume NIfTI (TotalSegmentator) no formato que o simulador
consome: Int16 em HU + manifest.json.

Faz o mesmo trabalho de ferramentas/dicom_para_volume.py, com duas diferencas
que vem da fonte:

  * o TotalSegmentator ja entrega volumes REAMOSTRADOS em grade isotropica de
    1,5 mm, entao nao ha espacamento irregular nem aquisicao obliqua a
    verificar — as duas validacoes que mais reprovaram series DICOM;

  * em troca vem em NIfTI, que e RAS, enquanto a plataforma herdou do DICOM a
    convencao LPS. Dois eixos precisam ser espelhados. Isso NAO e cosmetico:
    com o eixo y invertido o topograma de perfil sai com o paciente de bruços;

  * e vem com a MESA do tomografo dentro do volume, que a plataforma ja
    desenha por conta propria e que inflava a largura medida do paciente de
    405 para 454 mm — numero que alimenta validacao de FOV, SSDE e AEC;

  * em compensacao, os volumes cobrem campos enormes (ate 787 mm no eixo
    cranio-caudal, 500 mm no plano) e a maior parte do arquivo e AR em volta
    do paciente. Recortar ate o corpo devolve mais da metade do espaco sem
    perder nada.

A trava do B-04 continua valendo: subamostrar multiplica o espacamento, e a
extensao fisica e conferida no fim.

Uso:
    python ferramentas/nifti_para_volume.py <arquivo.nii.gz> <regiao> \\
        [--z-inicio-mm N] [--z-fim-mm N] [--lado 320] [--margem-mm 20]
"""

import argparse
import gzip
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nifti import ler          # noqa: E402
from orientacao import para_lps  # noqa: E402
from mesa import remover as remover_mesa  # noqa: E402


def falhar(msg):
    sys.exit("FALHOU: " + msg)


def largura_maxima(vol, sx, limiar=-300):
    """Maior largura ocupada por tecido em qualquer corte, em mm."""
    presente = (vol > limiar).any(axis=1)          # (z, x)
    larguras = []
    for k in range(presente.shape[0]):
        xs = np.where(presente[k])[0]
        if len(xs):
            larguras.append((xs.max() - xs.min() + 1) * sx)
    return max(larguras) if larguras else 0.0


def caixa_do_corpo(vol, limiar=-300):
    """Menor caixa no plano que contem o paciente, em indices de voxel."""
    presente = (vol > limiar).any(axis=0)          # projeta em (y, x)
    if not presente.any():
        falhar("nenhum voxel acima de %d HU — volume vazio?" % limiar)
    ys, xs = np.where(presente)
    return int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("arquivo")
    ap.add_argument("regiao")
    ap.add_argument("--z-inicio-mm", type=float, default=None, dest="z0")
    ap.add_argument("--z-fim-mm", type=float, default=None, dest="z1")
    ap.add_argument("--lado", type=int, default=320, help="lado maximo no plano")
    ap.add_argument("--margem-mm", type=float, default=20.0,
                    help="ar mantido em volta do corpo (o FOV precisa conter o paciente)")
    ap.add_argument("--saida", default=None)
    ap.add_argument("--fonte", default="TotalSegmentator")
    ap.add_argument("--sujeito", default=None, help="id do sujeito na fonte")
    ap.add_argument("--wl", type=int, default=40)
    ap.add_argument("--ww", type=int, default=400)
    ap.add_argument("--manter-mesa", action="store_true",
                    help="nao remover a mesa do tomografo (padrao: remover)")
    args = ap.parse_args()

    print("lendo %s ..." % args.arquivo)
    n = ler(args.arquivo)

    # ---- orientacao: RAS do NIfTI -> LPS da plataforma ---------------------
    vol, esp, desc = para_lps(n["dados"], n["afim"], n["spacing"])
    sz, sy, sx = esp                                # vol agora e [z, y, x]
    print("  orientado para LPS: %s" % desc)
    print("  volume: %s  espacamento %.2f x %.2f x %.2f mm" % (vol.shape, sx, sy, sz))
    print("  extensao original: %.0f x %.0f x %.0f mm"
          % (vol.shape[2] * sx, vol.shape[1] * sy, vol.shape[0] * sz))

    # ---- mesa do tomografo -------------------------------------------------
    if not args.manter_mesa:
        largura_antes = largura_maxima(vol, sx)
        vol, st = remover_mesa(vol, sy)
        print("  mesa removida: %.1f%% do tecido; largura maxima %.0f -> %.0f mm"
              % (st["pct"], largura_antes, largura_maxima(vol, sx)))
        if st["pct"] > 12.0:
            falhar("removeu %.1f%% do tecido — alto demais para ser so a mesa" % st["pct"])

    # ---- recorte no eixo cranio-caudal -------------------------------------
    if args.z0 is not None or args.z1 is not None:
        z0 = int(max(0, (args.z0 or 0) / sz))
        z1 = int(min(vol.shape[0], (args.z1 if args.z1 is not None else vol.shape[0] * sz) / sz))
        if z1 - z0 < 10:
            falhar("faixa em z curta demais (%d cortes)" % (z1 - z0))
        vol = vol[z0:z1]
        print("  recorte em z: %.0f a %.0f mm -> %d cortes" % (z0 * sz, z1 * sz, vol.shape[0]))

    # ---- recorte no plano: caixa do corpo + margem -------------------------
    y0, y1, x0, x1 = caixa_do_corpo(vol)
    my = int(round(args.margem_mm / sy))
    mx = int(round(args.margem_mm / sx))
    y0 = max(0, y0 - my); y1 = min(vol.shape[1] - 1, y1 + my)
    x0 = max(0, x0 - mx); x1 = min(vol.shape[2] - 1, x1 + mx)
    antes = (vol.shape[2] * sx, vol.shape[1] * sy)
    vol = vol[:, y0:y1 + 1, x0:x1 + 1]
    print("  recorte no plano: %.0f x %.0f mm -> %.0f x %.0f mm (corpo + %.0f mm de margem)"
          % (antes[0], antes[1], vol.shape[2] * sx, vol.shape[1] * sy, args.margem_mm))

    # ---- subamostragem no plano, CORRIGINDO o espacamento ------------------
    fator = 1
    while max(vol.shape[1], vol.shape[2]) // fator > args.lado:
        fator *= 2
    if fator > 1:
        ext_antes = (vol.shape[2] * sx, vol.shape[1] * sy)
        h = vol.shape[1] // fator * fator
        w = vol.shape[2] // fator * fator
        v = vol[:, :h, :w].astype(np.float32)
        v = v.reshape(vol.shape[0], h // fator, fator, w // fator, fator).mean(axis=(2, 4))
        vol = np.clip(v, -1024, 3071).astype(np.int16)
        sx *= fator; sy *= fator
        ext_depois = (vol.shape[2] * sx, vol.shape[1] * sy)
        for a, b, eixo in ((ext_antes[0], ext_depois[0], "x"), (ext_antes[1], ext_depois[1], "y")):
            if abs(a - b) > max(3.0, a * 0.03):
                falhar("extensao em %s mudou: %.1f -> %.1f mm (regressao do B-04)" % (eixo, a, b))
        print("  subamostrado %dx no plano -> %s, espacamento %.2f mm" % (fator, vol.shape, sx))

    hu_min, hu_max = int(vol.min()), int(vol.max())
    print("  faixa de HU: %d .. %d" % (hu_min, hu_max))
    if hu_min > -900:
        falhar("HU minimo %d — o ar deveria ficar proximo de -1000" % hu_min)
    if hu_max < 700:
        falhar("HU maximo %d — o osso cortical deveria passar de +700" % hu_max)

    saida = args.saida or os.path.join("assets", "volumes", args.regiao)
    os.makedirs(saida, exist_ok=True)
    bruto = os.path.join(saida, "volume.i16.gz")
    with gzip.open(bruto, "wb", compresslevel=6) as f:
        f.write(vol.tobytes(order="C"))
    mb = os.path.getsize(bruto) / (1024 * 1024)
    print("  gravado %s (%.1f MB)" % (bruto, mb))

    manifest = {
        "id": args.regiao,
        "modalidade": "CT",
        "formato": "int16-hu-raw-gz",
        "ordem": "z,y,x",
        "dims": [int(vol.shape[2]), int(vol.shape[1]), int(vol.shape[0])],
        "espacamento_mm": {"x": round(sx, 6), "y": round(sy, 6), "z": round(sz, 6)},
        "origem_mm": [0.0, 0.0, 0.0],
        "orientacao": [1, 0, 0, 0, 1, 0],
        "hu_min": hu_min, "hu_max": hu_max,
        "janela_exibicao": {"wl": args.wl, "ww": args.ww},
        "largura_maxima_mm": round(largura_maxima(vol, sx), 1),
        "extensao_mm": {
            "x": round(vol.shape[2] * sx, 1),
            "y": round(vol.shape[1] * sy, 1),
            "z": round(vol.shape[0] * sz, 1),
        },
        "aquisicao_original": {
            "fonte": args.fonte,
            "sujeito": args.sujeito,
            "arquivo": os.path.basename(args.arquivo),
            "orientacao_origem": "RAS (NIfTI) -> LPS",
            "mesa_removida": not args.manter_mesa,
        },
        "convertido_em": datetime.now(timezone.utc).isoformat(),
        "aviso": "Volume de TC real, anonimizado, para treinamento de operacao. "
                 "Sem finalidade diagnostica.",
    }
    with open(os.path.join(saida, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print("  extensao final: %.0f x %.0f x %.0f mm"
          % (manifest["extensao_mm"]["x"], manifest["extensao_mm"]["y"], manifest["extensao_mm"]["z"]))
    print("OK")


if __name__ == "__main__":
    main()
