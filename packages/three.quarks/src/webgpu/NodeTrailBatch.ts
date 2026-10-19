import {AdditiveBlending, Texture} from 'three';
import {TrailBatch} from 'three.quarks';
import {ParticleTrailNodeMaterial} from './materials/ParticleTrailNodeMaterial';
import {particleColor} from './nodes/ParticleNodes';

/**
 * A {@link TrailBatch} that renders with a node material, for three's WebGPURenderer.
 */
export class NodeTrailBatch extends TrailBatch {
    rebuildMaterial() {
        this.layers.mask = this.settings.layers.mask;

        const material = this.settings.material;
        const map: Texture | null = (material as any).map ?? null;
        this.material = new ParticleTrailNodeMaterial({
            colorNode: particleColor(map !== null, false, false),
            map: map,
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

    // Trails have no soft particles, in the WebGL batches either.
    applyDepthTexture(): void {}
}
