import {Texture, Vector2} from 'three';
import type {Node, NodeBuilder} from 'three/webgpu';
import {
    attribute,
    ceil,
    colorSpaceToWorking,
    floor,
    fract,
    Fn,
    mix,
    mod,
    texture,
    uniform,
    uv,
    vec2,
    vertexStage,
} from 'three/tsl';

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
    const tileUV = (tile: Node) =>
        vertexStage(
            uv()
                .add(vec2(mod(tile, tileCount.x), tileCount.y.sub(floor(tile.div(tileCount.x))).sub(1)))
                .div(tileCount)
        );
    const texel = texture(map, tileUV(floor(uvTile)));
    if (!blendTiles) {
        return texel;
    }
    return mix(texel, texture(map, tileUV(ceil(uvTile))), vertexStage(fract(uvTile)));
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
