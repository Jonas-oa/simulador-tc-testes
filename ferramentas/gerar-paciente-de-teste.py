# -*- coding: utf-8 -*-
"""Gera um GLB de teste: um boneco DE PROPOSITO na convencao errada.

  * eixo longo em Y (modelo em pe), nao em Z
  * unidades em CENTIMETROS, nao metros
  * origem no quadril, nao nos pes
  * ombros perto do topo -> a cabeca deve ser deduzida para aquele lado

Se o app normalizar direito, isso vira 1,70 m ao longo de Z, deitado, com a
base em y=0 e a cabeca em +Z.
"""
import json, struct, sys, io, os

def caixa(cx, cy, cz, sx, sy, sz):
    """36 vertices (12 triangulos) de uma caixa centrada em (cx,cy,cz)."""
    hx, hy, hz = sx / 2.0, sy / 2.0, sz / 2.0
    p = [(cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz),
         (cx + hx, cy + hy, cz - hz), (cx - hx, cy + hy, cz - hz),
         (cx - hx, cy - hy, cz + hz), (cx + hx, cy - hy, cz + hz),
         (cx + hx, cy + hy, cz + hz), (cx - hx, cy + hy, cz + hz)]
    faces = [(0,1,2),(0,2,3),(5,4,7),(5,7,6),(4,0,3),(4,3,7),
             (1,5,6),(1,6,2),(3,2,6),(3,6,7),(4,5,1),(4,1,0)]
    out = []
    for f in faces:
        for i in f:
            out.append(p[i])
    return out

# Boneco em pe, em centimetros, origem no quadril (y=0).
# altura total 170 cm: pes em -90, cabeca em +80
verts = []
verts += caixa(0,  70,  0,  18, 20, 18)    # cabeca
verts += caixa(0,  40,  0,  44, 22, 24)    # ombros/torax  <- a parte MAIS LARGA
verts += caixa(0,  10,  0,  32, 38, 22)    # abdome
verts += caixa(-9, -45, 0,  14, 72, 16)    # perna esquerda
verts += caixa( 9, -45, 0,  14, 72, 16)    # perna direita
verts += caixa(-26, 35, 0, 10, 60, 12)     # braco esquerdo
verts += caixa( 26, 35, 0, 10, 60, 12)     # braco direito

bin_pos = b"".join(struct.pack("<fff", *v) for v in verts)
while len(bin_pos) % 4:
    bin_pos += b"\0"

xs = [v[0] for v in verts]; ys = [v[1] for v in verts]; zs = [v[2] for v in verts]

gltf = {
    "asset": {"version": "2.0", "generator": "teste do simulador TC"},
    "scene": 0,
    "scenes": [{"nodes": [0], "name": "boneco"}],
    "nodes": [{"mesh": 0, "name": "corpo"}],
    "meshes": [{"name": "corpo", "primitives": [
        {"attributes": {"POSITION": 0}, "material": 0, "mode": 4}]}],
    "materials": [{
        "name": "pele",
        "pbrMetallicRoughness": {
            "baseColorFactor": [0.91, 0.75, 0.59, 1.0],
            "metallicFactor": 0.0, "roughnessFactor": 0.7},
        "doubleSided": True}],
    "accessors": [{
        "bufferView": 0, "componentType": 5126, "count": len(verts),
        "type": "VEC3",
        "min": [min(xs), min(ys), min(zs)],
        "max": [max(xs), max(ys), max(zs)]}],
    "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(bin_pos), "target": 34962}],
    "buffers": [{"byteLength": len(bin_pos)}],
}

json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
while len(json_bytes) % 4:
    json_bytes += b" "

corpo = (struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes +
         struct.pack("<II", len(bin_pos), 0x004E4942) + bin_pos)
glb = struct.pack("<III", 0x46546C67, 2, 12 + len(corpo)) + corpo

destino = sys.argv[1] if len(sys.argv) > 1 else "assets/paciente/paciente.glb"
d = os.path.dirname(destino)
if d and not os.path.isdir(d):
    os.makedirs(d)
io.open(destino, "wb").write(glb)
print("%s  %d bytes  %d vertices" % (destino, len(glb), len(verts)))
print("caixa do modelo (cm): x %.0f..%.0f  y %.0f..%.0f  z %.0f..%.0f"
      % (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))
