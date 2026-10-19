import {AdditiveBlending, Texture} from 'three';
import type {Node} from 'three/webgpu';
import {attribute, texture, uv} from 'three/tsl';
import {TrailBatch} from 'three.quarks';
import {ParticleTrailNodeMaterial} from './materials/ParticleTrailNodeMaterial';
import {outputToWorkingColorSpace} from './nodes/ParticleNodes';

/**
 * A {@link TrailBatch} that renders with a node material, for three's WebGPURenderer.
 */
export class NodeTrailBatch extends TrailBatch {
    rebuildMaterial() {
        this.layers.mask = this.settings.layers.mask;

        const material = this.settings.material;
        const map: Texture | null = (material as any).map;
        let color: Node = attribute('color', 'vec4');
        if (map) {
            color = color.mul(texture(map, uv()));
        }

        this.material = new ParticleTrailNodeMaterial({
            colorNode: outputToWorkingColorSpace(color),
            fog: false,
            transparent: material.transparent,
            depthWrite: !material.transparent,
            side: material.side,
            blending: material.blending || AdditiveBlending,
            blendDst: material.blendDst,
            blendSrc: material.blendSrc,
            blendEquation: material.blendEquation,
            premultipliedAlpha: material.premultipliedAlpha,
        });
    }

    // Only soft particles read the depth texture, and the node batches do not support them yet.
    applyDepthTexture(): void {}
}
