import {Camera, CubeTexture, OrthographicCamera, Texture} from 'three';
import {MaterialReferenceNode} from 'three/webgpu';
import type {ContextNode, Node, NodeBuilder, TextureNode} from 'three/webgpu';
import {
    attribute,
    cameraFar,
    cameraNear,
    ceil,
    colorSpaceToWorking,
    context,
    floor,
    fract,
    Fn,
    mat4,
    materialReference,
    mix,
    mod,
    normalLocal,
    logarithmicDepthToViewZ,
    orthographicDepthToViewZ,
    perspectiveDepthToViewZ,
    positionLocal,
    positionView,
    saturate,
    screenUV,
    transformNormal,
    uv,
    vec2,
    vec3,
    vec4,
    vertexStage,
} from 'three/tsl';

// The nodes below read each material's own values through materialReference(), so that materials of one kind share
// one node graph and three builds their shader once.

const uvTile = attribute('uvTile', 'float');
const tileCount = vec2(materialReference('uTileCount', 'float'), materialReference('vTileCount', 'float'));

// Maps a UV into a tile of the sprite sheet; tiles count row by row from the top left.
function tileUV(uvNode: Node, tile: Node): Node {
    return vertexStage(
        uvNode.add(vec2(mod(tile, tileCount.x), tileCount.y.sub(floor(tile.div(tileCount.x))).sub(1))).div(tileCount)
    );
}

// A texture of the material that ignores the texture's own transform, as the WebGL batches sample their maps.
class UntransformedTextureReferenceNode extends MaterialReferenceNode {
    setNodeType(uniformType: string): void {
        super.setNodeType(uniformType);
        (this.node as TextureNode).updateMatrix = false;
    }
}

// A texture of the material, sampled at the given UV.
function materialTextureAt(name: string, uvNode: Node): Node {
    return context(new UntransformedTextureReferenceNode(name, 'texture'), {getUV: () => uvNode});
}

const colorNodes = new Map<string, Node>();

/**
 * The color of a particle: its `color` attribute times its texel of the material's `map`. With tiles, the texel is
 * taken from the particle's tile (the `uvTile` attribute) of a sheet of `uTileCount` by `vTileCount` tiles, counted
 * row by row from the top left; with `blendTiles`, a fractional tile blends into the next one. Materials with the
 * same arguments get the same node.
 * @param {boolean} hasMap - Whether the material has a map.
 * @param {boolean} tiled - Whether the map is a sheet of more than one tile.
 * @param {boolean} blendTiles - Whether to blend a fractional tile into the next one.
 * @returns {Node} The color.
 */
export function particleColor(hasMap: boolean, tiled: boolean, blendTiles: boolean): Node {
    const key = !hasMap ? 'color' : !tiled ? 'map' : blendTiles ? 'blended tiles' : 'tiles';
    let colorNode = colorNodes.get(key);
    if (colorNode === undefined) {
        const color = attribute('color', 'vec4');
        if (!hasMap) {
            colorNode = color;
        } else if (!tiled) {
            colorNode = color.mul(materialTextureAt('map', uv()));
        } else {
            let texel = materialTextureAt('map', tileUV(uv(), floor(uvTile)));
            if (blendTiles) {
                texel = mix(texel, materialTextureAt('map', tileUV(uv(), ceil(uvTile))), vertexStage(fract(uvTile)));
            }
            colorNode = color.mul(texel);
        }
        colorNodes.set(key, colorNode);
    }
    return colorNode;
}

// One tiled UV per UV channel, so that textures sharing a channel share a varying.
const tiledUVs = new Map<number, Node>();

/**
 * A material context that samples the material's 2D textures at the particle's tile (the `uvTile` attribute rounded
 * down, in a sheet of the material's `uTileCount` by `vTileCount` tiles), for lit mesh particles. three applies a
 * texture's own transform after it, and keeps normal maps out of a material's context, so the particle materials hand
 * it to their normals themselves; bump maps stay untiled.
 * @type {ContextNode}
 */
export const tileUVContext: ContextNode = context({
    getUV: (textureNode: TextureNode) => {
        const map = textureNode.value as Texture;
        if ((map as CubeTexture).isCubeTexture) return null;
        let tiledUV = tiledUVs.get(map.channel);
        if (tiledUV === undefined) {
            tiledUV = tileUV(uv(map.channel), floor(uvTile));
            tiledUVs.set(map.channel, tiledUV);
        }
        return tiledUV;
    },
});

/**
 * Converts a color from the renderer's output color space to the working color space. The WebGL batches write their
 * colors without converting them for output; with this conversion an opaque particle shows the same color on
 * WebGPURenderer, which still blends and tone maps in the working color space.
 * @param {Node} color - An RGBA color in the output color space.
 * @returns {Node} The color in the working color space.
 */
export const outputToWorkingColorSpace: (color: Node) => Node = Fn(([color]: [Node], builder: NodeBuilder) =>
    colorSpaceToWorking(color, builder.renderer.outputColorSpace)
);

/**
 * The matrix that places a mesh particle: rotated by its `rotation` quaternion, scaled by `size` and moved to `offset`.
 * @returns {Node} The matrix.
 */
export function meshParticleMatrix(): Node {
    const q = attribute('rotation', 'vec4');
    const size = attribute('size', 'vec3');
    const offset = attribute('offset', 'vec3');
    const x2 = q.x.add(q.x);
    const y2 = q.y.add(q.y);
    const z2 = q.z.add(q.z);
    const xx = q.x.mul(x2);
    const xy = q.x.mul(y2);
    const xz = q.x.mul(z2);
    const yy = q.y.mul(y2);
    const yz = q.y.mul(z2);
    const zz = q.z.mul(z2);
    const wx = q.w.mul(x2);
    const wy = q.w.mul(y2);
    const wz = q.w.mul(z2);
    return mat4(
        vec4(vec3(yy.add(zz).oneMinus(), xy.add(wz), xz.sub(wy)).mul(size.x), 0),
        vec4(vec3(xy.sub(wz), xx.add(zz).oneMinus(), yz.add(wx)).mul(size.y), 0),
        vec4(vec3(xz.add(wy), yz.sub(wx), xx.add(yy).oneMinus()).mul(size.z), 0),
        vec4(offset, 1)
    );
}

/**
 * Moves the vertex of a mesh particle into place, transforming the local position and normal by
 * {@link meshParticleMatrix} as three's InstanceNode does with an instance matrix. Materials call it from
 * `setupPosition()`.
 * @param {NodeBuilder} builder - The current node builder.
 */
export function transformMeshParticle(builder: NodeBuilder): void {
    const matrix = meshParticleMatrix().toVar();
    positionLocal.assign(matrix.mul(positionLocal).xyz);
    if (builder.hasGeometryAttribute('normal')) {
        normalLocal.assign(transformNormal(normalLocal, matrix));
    }
}

/**
 * How visible a soft particle is where it nears the scene behind it: 0 up to the material's `softNearFade` in front of
 * the scene's depth in its `depthTexture`, rising to 1 at its `softFarFade`.
 * @returns {Node} The fade, from 0 to 1.
 */
export function softParticleFade(): Node {
    const sceneViewZ = Fn((builder: NodeBuilder) => {
        const depth = materialTextureAt('depthTexture', screenUV);
        if (builder.renderer.logarithmicDepthBuffer) return logarithmicDepthToViewZ(depth, cameraNear, cameraFar);
        // three's NodeBuilder carries the camera being rendered; its type declarations leave it out.
        const camera = (builder as NodeBuilder & {camera: Camera}).camera;
        if ((camera as OrthographicCamera).isOrthographicCamera) {
            return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
        }
        return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
    })();
    const nearFade = materialReference('softNearFade', 'float');
    const farFade = materialReference('softFarFade', 'float');
    return saturate(sceneViewZ.negate().sub(nearFade).add(positionView.z).div(farFade.sub(nearFade)));
}
