import {Camera, CubeTexture, OrthographicCamera, Texture, Vector2} from 'three';
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
    texture,
    transformNormal,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
    vertexStage,
} from 'three/tsl';

// Maps a UV into a tile of the sprite sheet; tiles count row by row from the top left.
function tileUV(uvNode: Node, tileCount: Node, tile: Node): Node {
    return vertexStage(
        uvNode.add(vec2(mod(tile, tileCount.x), tileCount.y.sub(floor(tile.div(tileCount.x))).sub(1))).div(tileCount)
    );
}

/**
 * Samples a sprite sheet at the particle's tile (the `uvTile` attribute). Tiles count row by row from the top left;
 * with `blendTiles`, a fractional tile blends into the next one.
 * @param {Texture} map - The sprite sheet.
 * @param {number} uTileCount - Number of horizontal tiles.
 * @param {number} vTileCount - Number of vertical tiles.
 * @param {boolean} blendTiles - Whether to blend a fractional tile into the next one.
 * @returns {Node} The texel.
 */
export function tileTexture(map: Texture, uTileCount: number, vTileCount: number, blendTiles: boolean): Node {
    if (uTileCount <= 1 && vTileCount <= 1) {
        return texture(map, uv());
    }
    const tileCount = uniform(new Vector2(uTileCount, vTileCount));
    const uvTile = attribute('uvTile', 'float');
    const texel = texture(map, tileUV(uv(), tileCount, floor(uvTile)));
    if (!blendTiles) {
        return texel;
    }
    return mix(texel, texture(map, tileUV(uv(), tileCount, ceil(uvTile))), vertexStage(fract(uvTile)));
}

/**
 * A material context that samples the material's 2D textures at the particle's tile (the `uvTile` attribute rounded
 * down), for lit mesh particles. three applies a texture's own transform after it, and keeps normal maps out of a
 * material's context, so the particle materials hand it to their normals themselves; bump maps stay untiled.
 * @param {number} uTileCount - Number of horizontal tiles.
 * @param {number} vTileCount - Number of vertical tiles.
 * @returns {ContextNode} The context, for `material.contextNode`.
 */
export function tileUVContext(uTileCount: number, vTileCount: number): ContextNode {
    const tileCount = uniform(new Vector2(uTileCount, vTileCount));
    const tile = floor(attribute('uvTile', 'float'));
    // One tiled UV per UV channel, so that textures sharing a channel share a varying.
    const tiledUVs = new Map<number, Node>();
    return context({
        getUV: (textureNode: TextureNode) => {
            const map = textureNode.value as Texture;
            if ((map as CubeTexture).isCubeTexture) return null;
            let tiledUV = tiledUVs.get(map.channel);
            if (!tiledUV) {
                tiledUV = tileUV(uv(map.channel), tileCount, tile);
                tiledUVs.set(map.channel, tiledUV);
            }
            return tiledUV;
        },
    });
}

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
 * How visible a soft particle is where it nears the scene behind it: 0 up to `nearFade` in front of the scene's depth
 * in `depthTexture`, rising to 1 at `farFade`.
 * @param {Texture} depthTexture - The scene's depth, rendered with the same camera.
 * @param {number} nearFade - Distance in front of the scene where the particle starts to show.
 * @param {number} farFade - Distance in front of the scene where the particle is fully visible.
 * @returns {Node} The fade, from 0 to 1.
 */
export function softParticleFade(depthTexture: Texture, nearFade: number, farFade: number): Node {
    const sceneViewZ = Fn((builder: NodeBuilder) => {
        const depth = texture(depthTexture, screenUV);
        if (builder.renderer.logarithmicDepthBuffer) return logarithmicDepthToViewZ(depth, cameraNear, cameraFar);
        // three's NodeBuilder carries the camera being rendered; its type declarations leave it out.
        const camera = (builder as NodeBuilder & {camera: Camera}).camera;
        if ((camera as OrthographicCamera).isOrthographicCamera) {
            return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
        }
        return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
    })();
    const fade = uniform(new Vector2(nearFade, 1 / (farFade - nearFade)));
    return saturate(sceneViewZ.negate().sub(fade.x).add(positionView.z).mul(fade.y));
}
