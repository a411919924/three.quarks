import {Texture} from 'three';
import type {Node} from 'three/webgpu';
import {attribute, vec4} from 'three/tsl';
import {RenderMode, SpriteBatch} from 'three.quarks';
import {ParticleSpriteNodeMaterial} from './materials/ParticleSpriteNodeMaterial';
import {outputToWorkingColorSpace, tileTexture} from './nodes/ParticleNodes';

/**
 * A {@link SpriteBatch} that renders with a node material, for three's WebGPURenderer.
 */
export class NodeSpriteBatch extends SpriteBatch {
    rebuildMaterial() {
        this.layers.mask = this.settings.layers.mask;

        if (this.settings.renderMode === RenderMode.Mesh) {
            throw new Error('NodeSpriteBatch: RenderMode.Mesh is not supported yet');
        }
        if (this.settings.softParticles) {
            throw new Error('NodeSpriteBatch: soft particles are not supported yet');
        }

        const material = this.settings.material;
        const map: Texture | null = (material as any).map;
        let color: Node = attribute('color', 'vec4');
        if (map) {
            color = color.mul(
                tileTexture(map, this.settings.uTileCount, this.settings.vTileCount, this.settings.blendTiles)
            );
        }
        let colorNode = outputToWorkingColorSpace(color);
        if (material.defines && material.defines['USE_COLOR_AS_ALPHA'] !== undefined) {
            colorNode = vec4(colorNode.rgb, color.r);
        }

        this.material = new ParticleSpriteNodeMaterial({
            renderMode: this.settings.renderMode,
            colorNode: colorNode,
            // The WebGL batches test the alpha before USE_COLOR_AS_ALPHA swaps it, and discard only below alphaTest.
            maskNode: material.alphaTest > 0 ? color.a.greaterThanEqual(material.alphaTest) : null,
            fog: false,
            transparent: material.transparent,
            depthWrite: !material.transparent,
            blending: material.blending,
            blendDst: material.blendDst,
            blendSrc: material.blendSrc,
            blendEquation: material.blendEquation,
            premultipliedAlpha: material.premultipliedAlpha,
            side: material.side,
            depthTest: material.depthTest,
        });
    }

    // Only soft particles read the depth texture, and the node batches do not support them yet.
    applyDepthTexture(): void {}
}
