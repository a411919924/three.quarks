import {Material, Texture} from 'three';
import type {Node} from 'three/webgpu';
import {attribute, vec4} from 'three/tsl';
import {RenderMode, SpriteBatch} from 'three.quarks';
import {ParticleMeshPhysicalNodeMaterial} from './materials/ParticleMeshPhysicalNodeMaterial';
import {ParticleMeshStandardNodeMaterial} from './materials/ParticleMeshStandardNodeMaterial';
import {ParticleSpriteNodeMaterial} from './materials/ParticleSpriteNodeMaterial';
import {outputToWorkingColorSpace, softParticleFade, tileTexture, tileUVContext} from './nodes/ParticleNodes';

/**
 * A {@link SpriteBatch} that renders with a node material, for three's WebGPURenderer.
 */
export class NodeSpriteBatch extends SpriteBatch {
    private depthTexture: Texture | null = null;

    rebuildMaterial() {
        this.layers.mask = this.settings.layers.mask;

        const material = this.settings.material;
        if (
            this.settings.renderMode === RenderMode.Mesh &&
            (material.type === 'MeshStandardMaterial' || material.type === 'MeshPhysicalMaterial')
        ) {
            const litMaterial =
                material.type === 'MeshStandardMaterial'
                    ? new ParticleMeshStandardNodeMaterial()
                    : new ParticleMeshPhysicalNodeMaterial();
            // Takes the material's properties as WebGPURenderer does when it renders a classic material.
            for (const key in material) {
                if (key !== 'uuid') (litMaterial as any)[key] = (material as any)[key];
            }
            litMaterial.vertexColors = true;
            if (this.settings.uTileCount > 1 || this.settings.vTileCount > 1) {
                litMaterial.contextNode = tileUVContext(this.settings.uTileCount, this.settings.vTileCount);
            }
            this.material = litMaterial;
            return;
        }

        const map: Texture | null = (material as any).map;
        let color: Node = attribute('color', 'vec4');
        if (map) {
            color = color.mul(
                tileTexture(map, this.settings.uTileCount, this.settings.vTileCount, this.settings.blendTiles)
            );
        }
        // The WebGL batches fade the color, the swapped alpha included, before writing it.
        let fadedColor = color;
        if (this.settings.softParticles && this.depthTexture) {
            fadedColor = color.mul(
                softParticleFade(this.depthTexture, this.settings.softNearFade, this.settings.softFarFade)
            );
        }
        let colorNode = outputToWorkingColorSpace(fadedColor);
        if (material.defines && material.defines['USE_COLOR_AS_ALPHA'] !== undefined) {
            colorNode = vec4(colorNode.rgb, fadedColor.r);
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

    applyDepthTexture(depthTexture: Texture | null): void {
        if (this.depthTexture === depthTexture) return;
        this.depthTexture = depthTexture;
        // Only the unlit material fades soft particles; the WebGL lit shader has no soft-particle code either.
        if (this.settings.softParticles && this.material instanceof ParticleSpriteNodeMaterial) {
            (this.material as Material).dispose();
            this.rebuildMaterial();
        }
    }
}
