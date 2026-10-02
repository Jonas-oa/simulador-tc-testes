"""Prepara a paciente rigada para a mesa de TC e exporta um GLB estático.

Uso (o arquivo .blend deve ser aberto pelo Blender antes de executar):

    blender --background paciente.blend --python ferramentas/exportar-paciente-tc.py -- saida.glb

Com ``--test-poses`` como argumento, apenas mede alternativas de rotação dos
controles dos braços. Isso ajuda a escolher uma pose compacta sem salvar nada.
"""

import sys

import bpy
import bmesh
from mathutils import Matrix, Vector


BODY_PREFIX = "bodychan-"
HEEL_OBJECT = "bodychan-high-heels"
ARM_PARTS = (
    "upperarms", "forearms", "hands", "thumb", "index", "mid_",
    "pinky", "ring_",
)
CLOTHING_PARTS = {"bodychan-torso", "bodychan-hips"}

# O arquivo vem em T-pose: X é esquerda-direita e Z é a altura no Blender.
# Estes são os centros dos ombros na pose de bind. Os braços já estão levemente
# para baixo, mas abertos. Girar 30° em torno de Y aproxima punhos e cotovelos
# ao tronco sem cruzá-los na frente do corpo, sem depender dos scripts de
# interface do Rigify.
OMBRO_ESQ = Vector((0.13, 0.012, 1.353))
OMBRO_DIR = Vector((-0.13, 0.012, 1.353))
RODAR_ESQ = Matrix.Rotation(0.5235987755982988, 4, "Y")
RODAR_DIR = Matrix.Rotation(-0.5235987755982988, 4, "Y")


def argumentos():
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def corpo():
    return [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and obj.name.startswith(BODY_PREFIX)
        # O salto é uma malha acessória separada. No arquivo recebido ele
        # deforma o pé esquerdo no export estático, por isso fica de fora.
        and obj.name != HEEL_OBJECT
    ]


def material(nome, cor):
    resultado = bpy.data.materials.get(nome) or bpy.data.materials.new(nome)
    resultado.use_nodes = True
    principled = resultado.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*cor, 1.0)
    principled.inputs["Roughness"].default_value = 0.72
    principled.inputs["Metallic"].default_value = 0.0
    return resultado


def limites(objetos):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    pontos = []
    for obj in objetos:
        avaliado = obj.evaluated_get(depsgraph)
        pontos.extend(avaliado.matrix_world @ Vector(canto) for canto in avaliado.bound_box)
    minimo = Vector(tuple(min(p[i] for p in pontos) for i in range(3)))
    maximo = Vector(tuple(max(p[i] for p in pontos) for i in range(3)))
    return minimo, maximo


def e_parte_do_braco(nome):
    nome = nome.lower()
    return any(parte in nome for parte in ARM_PARTS)


def trazer_braco_ao_corpo(ponto):
    """Gira os dois braços da T-pose para baixo, junto ao tronco."""
    if ponto.x >= 0:
        return OMBRO_ESQ + RODAR_ESQ @ (ponto - OMBRO_ESQ)
    return OMBRO_DIR + RODAR_DIR @ (ponto - OMBRO_DIR)


def medir_pose_compacta():
    depsgraph = bpy.context.evaluated_depsgraph_get()
    pontos = []
    for obj in corpo():
        avaliado = obj.evaluated_get(depsgraph)
        for canto in avaliado.bound_box:
            ponto = avaliado.matrix_world @ Vector(canto)
            pontos.append(trazer_braco_ao_corpo(ponto) if e_parte_do_braco(obj.name) else ponto)
    minimo = Vector(tuple(min(p[i] for p in pontos) for i in range(3)))
    maximo = Vector(tuple(max(p[i] for p in pontos) for i in range(3)))
    tamanho = maximo - minimo
    print(
        "pose compacta: largura %.3f m, profundidade %.3f m, altura %.3f m"
        % (tamanho.x, tamanho.y, tamanho.z)
    )


def colecao_exportacao():
    anterior = bpy.data.collections.get("Paciente TC exportado")
    if anterior:
        bpy.data.collections.remove(anterior, do_unlink=True)
    colecao = bpy.data.collections.new("Paciente TC exportado")
    bpy.context.scene.collection.children.link(colecao)
    return colecao


def recortar_por_lado(malha, matriz_mundo, lado):
    """Mantém somente a metade direita ou esquerda de uma malha bilateral."""
    bm = bmesh.new()
    bm.from_mesh(malha)
    excluir = [
        vertice
        for vertice in bm.verts
        if ((matriz_mundo @ vertice.co).x < 0) != (lado == "R")
    ]
    bmesh.ops.delete(bm, geom=excluir, context="VERTS")
    bm.to_mesh(malha)
    bm.free()
    malha.update()


def grupo_braco(colecao, lado):
    grupo = bpy.data.objects.new("paciente-braco." + lado, None)
    grupo.empty_display_type = "PLAIN_AXES"
    colecao.objects.link(grupo)
    grupo.select_set(True)
    return grupo


def criar_copia(obj, depsgraph, colecao, material_saida, lado=None, pai=None):
    avaliado = obj.evaluated_get(depsgraph)
    malha = bpy.data.meshes.new_from_object(avaliado, depsgraph=depsgraph)
    malha.materials.clear()
    malha.materials.append(material_saida)
    nome = obj.name if lado is None else obj.name + ".arm." + lado
    copia = bpy.data.objects.new(nome, malha)
    copia.matrix_world = obj.matrix_world
    colecao.objects.link(copia)
    if lado is not None:
        recortar_por_lado(malha, copia.matrix_world, lado)
    if pai is not None:
        copia.parent = pai
    if e_parte_do_braco(obj.name):
        inversa = copia.matrix_world.inverted()
        for vertice in malha.vertices:
            mundo = copia.matrix_world @ vertice.co
            vertice.co = inversa @ trazer_braco_ao_corpo(mundo)
        malha.update()
    copia.select_set(True)
    return copia


def criar_malhas_estaticas(destino):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    colecao = colecao_exportacao()
    pele = material("Pele bege", (0.72, 0.48, 0.30))
    roupa = material("Roupa marrom escuro", (0.12, 0.045, 0.02))
    bracos = {"L": grupo_braco(colecao, "L"), "R": grupo_braco(colecao, "R")}
    # Em execução sem interface não há uma área 3D, então o operador
    # ``select_all`` não passa no poll. A seleção direta funciona tanto no
    # Blender aberto quanto no modo ``--background``.
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    for obj in corpo():
        if e_parte_do_braco(obj.name):
            # O asset de entrada economiza nós juntando os dois braços em uma
            # malha. Exportamos cada lado separadamente para a sala poder
            # deslocar apenas o braço dependente no decúbito lateral.
            criar_copia(obj, depsgraph, colecao, pele, "L", bracos["L"])
            criar_copia(obj, depsgraph, colecao, pele, "R", bracos["R"])
        else:
            criar_copia(obj, depsgraph, colecao,
                         roupa if obj.name in CLOTHING_PARTS else pele)
    bpy.context.view_layer.objects.active = next(iter(colecao.objects))
    bpy.ops.export_scene.gltf(
        filepath=destino,
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_apply=True,
    )


def main():
    args = argumentos()
    if not corpo():
        raise RuntimeError("Nenhuma malha de paciente com prefixo '%s' encontrada." % BODY_PREFIX)
    if args == ["--test-poses"]:
        minimo, maximo = limites(corpo())
        tamanho = maximo - minimo
        print(
            "pose original: largura %.3f m, profundidade %.3f m, altura %.3f m"
            % (tamanho.x, tamanho.y, tamanho.z)
        )
        medir_pose_compacta()
        return
    if len(args) != 1:
        raise RuntimeError("Informe apenas o caminho do GLB de saída ou --test-poses.")

    criar_malhas_estaticas(args[0])


if __name__ == "__main__":
    main()
