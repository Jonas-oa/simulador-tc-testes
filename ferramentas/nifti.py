#!/usr/bin/env python3
"""
ferramentas/nifti.py

Leitor minimo de NIfTI-1 (.nii / .nii.gz), suficiente para o que a plataforma
precisa: dimensoes, espacamento, orientacao e voxels em HU.

Escrito a mao em vez de usar nibabel porque o cabecalho NIfTI-1 tem 348 bytes
de campos fixos e bem documentados, e uma dependencia a menos e uma
dependencia a menos. O que NAO cobre: NIfTI-2, dados complexos, RGB e
orientacoes obliquas (que a plataforma ja recusa de qualquer forma).
"""

import gzip
import struct

import numpy as np

# datatype NIfTI -> (dtype numpy, bytes por voxel)
TIPOS = {
    2: (np.uint8, 1), 4: (np.int16, 2), 8: (np.int32, 4),
    16: (np.float32, 4), 64: (np.float64, 8),
    256: (np.int8, 1), 512: (np.uint16, 2), 768: (np.uint32, 4),
}


def ler(caminho):
    """
    Devolve dict com:
      dados        ndarray (z, y, x) em HU, int16
      dims         [nx, ny, nz]
      spacing      [sx, sy, sz] em mm
      orientacao   'RAS'/'LPS'... derivada dos sinais da matriz
      afim         matriz 4x4
    """
    abrir = gzip.open if caminho.endswith(".gz") else open
    with abrir(caminho, "rb") as f:
        cru = f.read()

    (tam_hdr,) = struct.unpack("<i", cru[0:4])
    endian = "<"
    if tam_hdr != 348:
        (tam_hdr,) = struct.unpack(">i", cru[0:4])
        endian = ">"
        if tam_hdr != 348:
            raise ValueError("nao e um NIfTI-1 (sizeof_hdr = %d)" % tam_hdr)

    dim = struct.unpack(endian + "8h", cru[40:56])
    datatype = struct.unpack(endian + "h", cru[70:72])[0]
    pixdim = struct.unpack(endian + "8f", cru[76:108])
    vox_offset = int(struct.unpack(endian + "f", cru[108:112])[0])
    scl_slope = struct.unpack(endian + "f", cru[112:116])[0]
    scl_inter = struct.unpack(endian + "f", cru[116:120])[0]
    qform = struct.unpack(endian + "h", cru[252:254])[0]
    sform = struct.unpack(endian + "h", cru[254:256])[0]
    srow_x = struct.unpack(endian + "4f", cru[280:296])
    srow_y = struct.unpack(endian + "4f", cru[296:312])
    srow_z = struct.unpack(endian + "4f", cru[312:328])

    if datatype not in TIPOS:
        raise ValueError("datatype %d nao suportado" % datatype)
    dtype, bpv = TIPOS[datatype]

    nx, ny, nz = int(dim[1]), int(dim[2]), int(dim[3] if dim[0] >= 3 else 1)
    n = nx * ny * nz
    if vox_offset < 348:
        vox_offset = 352
    bruto = np.frombuffer(cru, dtype=np.dtype(dtype).newbyteorder(endian),
                          count=n, offset=vox_offset)

    # NIfTI guarda em ordem x mais rapido; queremos (z, y, x)
    vol = bruto.reshape((nz, ny, nx))

    # scl_slope/inter levam o valor armazenado para a unidade fisica (HU em CT)
    v = vol.astype(np.float32)
    if scl_slope not in (0.0, 1.0) or scl_inter != 0.0:
        v = v * (scl_slope if scl_slope != 0.0 else 1.0) + scl_inter
    np.clip(v, -1024, 3071, out=v)

    afim = np.array([srow_x, srow_y, srow_z, [0, 0, 0, 1]], dtype=float)
    # Sem sform valido, monta a partir de pixdim (assume eixos alinhados)
    if sform == 0:
        afim = np.diag([pixdim[1], pixdim[2], pixdim[3], 1.0])

    eixos = ""
    for col in range(3):
        c = afim[:3, col]
        k = int(np.argmax(np.abs(c)))
        eixos += "LPSRAI"[k if c[k] < 0 else k + 3] if False else "xyz"[k]

    return {
        "dados": v.astype(np.int16),
        "dims": [nx, ny, nz],
        "spacing": [float(pixdim[1]), float(pixdim[2]), float(pixdim[3])],
        "afim": afim,
        "qform": qform, "sform": sform,
        "scl_slope": scl_slope, "scl_inter": scl_inter,
        "datatype": datatype,
        "eixos": eixos,
    }


def resumo(caminho):
    n = ler(caminho)
    d, sp = n["dims"], n["spacing"]
    v = n["dados"]
    return {
        "dims": d,
        "spacing_mm": [round(x, 4) for x in sp],
        "extensao_mm": [round(d[i] * sp[i], 1) for i in range(3)],
        "hu_min": int(v.min()), "hu_max": int(v.max()),
        "datatype": n["datatype"], "sform": n["sform"],
        "mb": round(v.nbytes / 1024 ** 2, 1),
    }


if __name__ == "__main__":
    import json
    import sys
    for c in sys.argv[1:]:
        print(c)
        print(" ", json.dumps(resumo(c), ensure_ascii=False))
