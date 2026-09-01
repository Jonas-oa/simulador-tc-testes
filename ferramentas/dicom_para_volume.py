#!/usr/bin/env python3
"""
ferramentas/dicom_para_volume.py

Converte uma serie DICOM de TC num volume Int16 em HU + manifest.json, no
formato que o simulador consome (Fase 2 do roteiro).

Por que nao embarcar o DICOM bruto: uma serie custa 130-200 MB, o que
inviabiliza o uso em sala de aula. O volume convertido cabe em ~10-20 MB e
PRESERVA os HU verdadeiros, que e o que importa — o defeito B-05 da auditoria
era justamente exportar "HU" derivados de PNG ja janelado, cobrindo apenas
-160..+223 em vez de -1024..+3071.

Verificacoes obrigatorias antes de aceitar uma serie:
  * modalidade CT
  * orientacao consistente e NAO obliqua
  * espacamento entre cortes regular
  * RescaleSlope/Intercept presentes (sem eles nao ha HU)
  * ausencia de identificadores do paciente
  * faixa de HU plausivel (ar <= -900, osso >= +700)

E a trava central, licao do B-04: ao subamostrar por um fator f, o espacamento
e multiplicado por f. O script FALHA se a extensao fisica do volume mudar.

Uso:
    python ferramentas/dicom_para_volume.py <dir_dicom> <regiao> [--lado 256]
"""

import argparse
import gzip
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np

try:
    import pydicom
except ImportError:
    sys.exit("pydicom nao encontrado. Instale com: python -m pip install pydicom")


TAGS_IDENTIFICADORAS = [
    "PatientName", "PatientID", "PatientBirthDate", "PatientAddress",
    "PatientTelephoneNumbers", "OtherPatientIDs", "OtherPatientNames",
    "InstitutionName", "InstitutionAddress", "ReferringPhysicianName",
    "PerformingPhysicianName", "AccessionNumber",
]

VALORES_ANONIMOS = {"", "ANONYMOUS", "ANON", "NONE", "SIMULADO", "REMOVED"}


def falhar(msg):
    sys.exit("FALHOU: " + msg)


def ler_series(diretorio, minimo=40):
    arquivos = []
    for raiz, _dirs, nomes in os.walk(diretorio):
        for n in nomes:
            if n.lower().endswith((".dcm", ".dicom")) or "." not in n:
                arquivos.append(os.path.join(raiz, n))
    if not arquivos:
        falhar("nenhum arquivo DICOM em " + diretorio)

    fatias = []
    for caminho in arquivos:
        try:
            ds = pydicom.dcmread(caminho, force=True)
        except Exception:
            continue
        if getattr(ds, "Modality", None) != "CT":
            continue
        if not hasattr(ds, "PixelData"):
            continue
        if not hasattr(ds, "ImagePositionPatient"):
            falhar("corte sem ImagePositionPatient — impossivel ordenar nem medir")
        fatias.append(ds)

    if len(fatias) < minimo:
        falhar("apenas %d cortes de TC utilizaveis (minimo %d)" % (len(fatias), minimo))
    return fatias


def separar_grupos(fatias, espessura_alvo=None):
    """
    Uma "serie" do TCIA frequentemente carrega MAIS DE UMA reconstrucao
    entrelacada — por exemplo 178 cortes de 5,0 mm e 144 de 2,5 mm sob o mesmo
    SeriesInstanceUID. Ordenados juntos, os passos alternam e o volume fica
    geometricamente inconsistente.

    Agrupa por (espessura, matriz) e devolve o grupo escolhido. Sem
    `espessura_alvo`, escolhe o grupo com mais cortes.
    """
    grupos = {}
    for ds in fatias:
        chave = (
            round(float(getattr(ds, "SliceThickness", 0) or 0), 3),
            int(ds.Rows), int(ds.Columns),
        )
        grupos.setdefault(chave, []).append(ds)

    if len(grupos) > 1:
        print("  serie contem %d reconstrucoes distintas:" % len(grupos))
        for (esp, r, c), g in sorted(grupos.items(), key=lambda kv: -len(kv[1])):
            print("     espessura %.2f mm · %dx%d · %d cortes" % (esp, c, r, len(g)))

    if espessura_alvo is not None:
        candidatos = [(k, g) for k, g in grupos.items() if abs(k[0] - espessura_alvo) < 1e-3]
        if not candidatos:
            falhar("nenhuma reconstrucao com espessura %.2f mm" % espessura_alvo)
        chave, escolhido = candidatos[0]
    else:
        chave, escolhido = max(grupos.items(), key=lambda kv: len(kv[1]))

    if len(grupos) > 1:
        print("  usando a de %.2f mm (%d cortes)" % (chave[0], len(escolhido)))
    if len(escolhido) < 20:
        falhar("grupo escolhido tem so %d cortes" % len(escolhido))
    return escolhido


def verificar_anonimizacao(ds):
    problemas = []
    for tag in TAGS_IDENTIFICADORAS:
        v = getattr(ds, tag, None)
        if v is None:
            continue
        s = str(v).strip().upper()
        if s and s not in VALORES_ANONIMOS and not s.startswith("LIDC") \
                and not s.startswith("C3") and not s.startswith("CPTAC"):
            problemas.append("%s = %r" % (tag, str(v)))
    return problemas


def geometria(fatias):
    ref = fatias[0]
    iop = [float(x) for x in ref.ImageOrientationPatient]
    linha = np.array(iop[:3], dtype=float)
    coluna = np.array(iop[3:], dtype=float)
    normal = np.cross(linha, coluna)

    # Obliquidade: os eixos devem estar alinhados com os eixos do paciente.
    for nome, eixo in (("linha", linha), ("coluna", coluna), ("normal", normal)):
        pureza = float(np.max(np.abs(eixo)))
        if pureza < 0.999:
            falhar("aquisicao obliqua (%s com pureza %.4f) — descartada" % (nome, pureza))

    # Orientacao igual em todos os cortes.
    for ds in fatias:
        if np.max(np.abs(np.array([float(x) for x in ds.ImageOrientationPatient]) - np.array(iop))) > 1e-4:
            falhar("orientacao varia entre cortes")

    # Ordena pela projecao da posicao no eixo normal.
    def proj(ds):
        p = np.array([float(x) for x in ds.ImagePositionPatient], dtype=float)
        return float(np.dot(p, normal))

    fatias.sort(key=proj)
    projs = np.array([proj(d) for d in fatias])
    passos = np.diff(projs)
    dz = float(np.median(passos))
    if abs(dz) < 1e-6:
        falhar("espacamento entre cortes nulo")
    desvio = float(np.max(np.abs(passos - dz)))
    if desvio > abs(dz) * 0.02:
        falhar("espacamento irregular: desvio de %.4f mm sobre passo de %.4f mm" % (desvio, dz))

    px = [float(x) for x in ref.PixelSpacing]  # [linha(y), coluna(x)]
    return {
        "normal": normal,
        "dz": abs(dz),
        "spacing_x": px[1],
        "spacing_y": px[0],
        "origem": [float(x) for x in fatias[0].ImagePositionPatient],
        "iop": iop,
    }


def montar_volume(fatias):
    ref = fatias[0]
    linhas, colunas = int(ref.Rows), int(ref.Columns)
    z = len(fatias)
    vol = np.empty((z, linhas, colunas), dtype=np.int16)

    for i, ds in enumerate(fatias):
        if int(ds.Rows) != linhas or int(ds.Columns) != colunas:
            falhar("cortes com matrizes diferentes")
        px = ds.pixel_array.astype(np.float32)
        slope = float(getattr(ds, "RescaleSlope", 1.0))
        inter = float(getattr(ds, "RescaleIntercept", 0.0))
        if not hasattr(ds, "RescaleIntercept"):
            falhar("RescaleIntercept ausente — nao ha como converter para HU")
        hu = px * slope + inter
        np.clip(hu, -1024, 3071, out=hu)
        vol[i] = hu.astype(np.int16)
    return vol


def subamostrar(vol, espacamento, lado_max):
    """
    Reduz a matriz no plano preservando a EXTENSAO FISICA.

    Esta e a trava do B-04: a versao auditada subamostrava 512 -> 256 e mantinha
    o espacamento de 0,43 mm, entregando um cranio de 110 mm de largura em vez
    de 220. Aqui o espacamento e multiplicado pelo fator e a extensao fisica e
    conferida ao final.
    """
    z, h, w = vol.shape
    fator = 1
    while max(h, w) // fator > lado_max:
        fator *= 2
    if fator == 1:
        return vol, espacamento, 1

    ext_antes = (w * espacamento["spacing_x"], h * espacamento["spacing_y"])

    # Media de blocos fator x fator (reduz ruido em vez de so descartar pixels).
    h2, w2 = (h // fator) * fator, (w // fator) * fator
    v = vol[:, :h2, :w2].astype(np.float32)
    v = v.reshape(z, h2 // fator, fator, w2 // fator, fator).mean(axis=(2, 4))
    v = np.clip(v, -1024, 3071).astype(np.int16)

    novo = dict(espacamento)
    novo["spacing_x"] = espacamento["spacing_x"] * fator
    novo["spacing_y"] = espacamento["spacing_y"] * fator

    ext_depois = (v.shape[2] * novo["spacing_x"], v.shape[1] * novo["spacing_y"])
    for a, b, eixo in ((ext_antes[0], ext_depois[0], "x"), (ext_antes[1], ext_depois[1], "y")):
        if abs(a - b) > max(2.0, a * 0.02):
            falhar("extensao fisica em %s mudou: %.1f mm -> %.1f mm (regressao do B-04)" % (eixo, a, b))
    return v, novo, fator


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("diretorio")
    ap.add_argument("regiao")
    ap.add_argument("--lado", type=int, default=256, help="lado maximo no plano (padrao 256)")
    ap.add_argument("--espessura", type=float, default=None,
                    help="escolhe a reconstrucao com esta espessura (mm) quando a serie traz varias")
    ap.add_argument("--min-cortes", type=int, default=40, dest="min_cortes",
                    help="minimo de cortes aceito (padrao 40)")
    ap.add_argument("--saida", default=None)
    args = ap.parse_args()

    print("lendo %s ..." % args.diretorio)
    fatias = ler_series(args.diretorio, args.min_cortes)
    print("  %d cortes de TC" % len(fatias))
    fatias = separar_grupos(fatias, args.espessura)

    problemas = verificar_anonimizacao(fatias[0])
    if problemas:
        print("  ATENCAO — possiveis identificadores presentes:")
        for p in problemas:
            print("     " + p)
    else:
        print("  anonimizacao: nenhum identificador encontrado")

    esp = geometria(fatias)
    print("  espacamento original: %.4f x %.4f x %.4f mm" % (esp["spacing_x"], esp["spacing_y"], esp["dz"]))

    vol = montar_volume(fatias)
    print("  volume: %s (z, y, x)" % (vol.shape,))

    vol, esp, fator = subamostrar(vol, esp, args.lado)
    if fator > 1:
        print("  subamostrado %dx no plano -> %s, espacamento %.4f x %.4f mm"
              % (fator, vol.shape, esp["spacing_x"], esp["spacing_y"]))

    hu_min, hu_max = int(vol.min()), int(vol.max())
    print("  faixa de HU: %d .. %d" % (hu_min, hu_max))
    if hu_min > -900:
        falhar("HU minimo %d — o ar deveria ficar proximo de -1000. Volume nao esta em HU reais." % hu_min)
    if hu_max < 700:
        falhar("HU maximo %d — o osso cortical deveria passar de +700." % hu_max)

    saida = args.saida or os.path.join("assets", "volumes", args.regiao)
    os.makedirs(saida, exist_ok=True)

    bruto = os.path.join(saida, "volume.i16.gz")
    with gzip.open(bruto, "wb", compresslevel=6) as f:
        f.write(vol.tobytes(order="C"))
    mb = os.path.getsize(bruto) / (1024 * 1024)
    print("  gravado %s (%.1f MB)" % (bruto, mb))

    ref = fatias[0]
    manifest = {
        "id": args.regiao,
        "modalidade": "CT",
        "formato": "int16-hu-raw-gz",
        "ordem": "z,y,x",
        "dims": [int(vol.shape[2]), int(vol.shape[1]), int(vol.shape[0])],
        "espacamento_mm": {
            "x": round(esp["spacing_x"], 6),
            "y": round(esp["spacing_y"], 6),
            "z": round(esp["dz"], 6),
        },
        "origem_mm": [round(v, 4) for v in esp["origem"]],
        "orientacao": [round(v, 6) for v in esp["iop"]],
        "hu_min": hu_min,
        "hu_max": hu_max,
        "janela_exibicao": {"wl": 40, "ww": 400},
        "extensao_mm": {
            "x": round(vol.shape[2] * esp["spacing_x"], 1),
            "y": round(vol.shape[1] * esp["spacing_y"], 1),
            "z": round(vol.shape[0] * esp["dz"], 1),
        },
        "aquisicao_original": {
            "kvp": float(getattr(ref, "KVP", 0)) or None,
            "espessura_mm": float(getattr(ref, "SliceThickness", 0)) or None,
            "kernel": str(getattr(ref, "ConvolutionKernel", "")) or None,
            "fabricante": str(getattr(ref, "Manufacturer", "")) or None,
            "modelo": str(getattr(ref, "ManufacturerModelName", "")) or None,
        },
        "convertido_em": datetime.now(timezone.utc).isoformat(),
        "aviso": "Volume de TC real, anonimizado, para treinamento de operacao. "
                 "Sem finalidade diagnostica.",
    }
    cam_manifest = os.path.join(saida, "manifest.json")
    with open(cam_manifest, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print("  gravado %s" % cam_manifest)
    print("  extensao fisica: %.0f x %.0f x %.0f mm"
          % (manifest["extensao_mm"]["x"], manifest["extensao_mm"]["y"], manifest["extensao_mm"]["z"]))
    print("OK")


if __name__ == "__main__":
    main()
