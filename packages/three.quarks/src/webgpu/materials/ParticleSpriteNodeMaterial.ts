import {NodeMaterial} from 'three/webgpu';
import type {Node, NodeBuilder, NodeMaterialParameters} from 'three/webgpu';
import {
    attribute,
    cameraViewMatrix,
    cross,
    modelNormalMatrix,
    modelViewMatrix,
    modelWorldMatrix,
    normalize,
    positionGeometry,
    rotate,
    vec3,
    vec4,
} from 'three/tsl';
import {RenderMode} from 'three.quarks';
import {transformMeshParticle} from '../nodes/ParticleNodes';

export interface ParticleSpriteNodeMaterialParameters extends NodeMaterialParameters {
    renderMode?: RenderMode;
}

/**
 * The unlit node material of sprite particles. In the billboard modes it places each instance of the quad at the
 * particle's `offset`, sized by `size` and turned by `rotation`, facing the camera as the render mode says;
 * `StretchedBillBoard` also reads `velocity` (the velocity scaled by the speed factor, and the length factor in `w`).
 * In `Mesh` mode each instance of the mesh is placed by {@link transformMeshParticle}.
 */
export class ParticleSpriteNodeMaterial extends NodeMaterial {
    static get type() {
        return 'ParticleSpriteNodeMaterial';
    }

    private _renderMode: RenderMode = RenderMode.BillBoard;

    constructor(parameters?: ParticleSpriteNodeMaterialParameters) {
        super();
        this.setValues(parameters);
    }

    /**
     * The render mode, any but `Trail`. Changing it rebuilds the shader.
     * @type {RenderMode}
     */
    get renderMode(): RenderMode {
        return this._renderMode;
    }

    set renderMode(value: RenderMode) {
        if (this._renderMode !== value) {
            this._renderMode = value;
            this.needsUpdate = true;
        }
    }

    copy(source: ParticleSpriteNodeMaterial): this {
        this.renderMode = source.renderMode;
        return super.copy(source);
    }

    // The render mode changes the shader, and three keys numeric properties only as zero or nonzero.
    customProgramCacheKey(): string {
        return `${super.customProgramCacheKey()}:${this.renderMode}`;
    }

    // premultipliedAlpha only selects the premultiplied blend factors, as in the WebGL batches.
    setupPremultipliedAlpha(_builder: NodeBuilder, outputNode: Node): Node {
        return outputNode;
    }

    setupPosition(builder: NodeBuilder): Node {
        const position = super.setupPosition(builder);
        if (this.renderMode === RenderMode.Mesh) {
            transformMeshParticle(builder);
        }
        return position;
    }

    setupPositionView(builder: NodeBuilder): Node {
        if (this.renderMode === RenderMode.Mesh) {
            return super.setupPositionView(builder);
        }

        const offset = attribute('offset', 'vec3');
        const size = attribute('size', 'vec3');

        if (this.renderMode === RenderMode.StretchedBillBoard) {
            const velocity = attribute('velocity', 'vec4');
            const avgSize = size.x.add(size.y).mul(0.5);
            const mvPosition = modelViewMatrix.mul(vec4(offset, 1)).xyz;
            const viewVelocity = cameraViewMatrix.mul(vec4(modelNormalMatrix.mul(velocity.xyz), 0)).xyz;
            const lengthScale = velocity.w.div(viewVelocity.length()).add(1);
            return mvPosition
                .add(normalize(cross(mvPosition, viewVelocity)).mul(positionGeometry.y.mul(avgSize)))
                .sub(viewVelocity.mul(positionGeometry.x.add(0.5).mul(lengthScale).mul(avgSize)));
        }

        const rotated = rotate(positionGeometry.xy.mul(size.xy), attribute('rotation', 'float'));
        switch (this.renderMode) {
            case RenderMode.HorizontalBillBoard: {
                const worldPosition = modelWorldMatrix
                    .mul(vec4(offset, 1))
                    .add(vec4(rotated.x, 0, rotated.y.negate(), 0));
                return cameraViewMatrix.mul(worldPosition).xyz;
            }
            case RenderMode.VerticalBillBoard: {
                const worldPosition = modelWorldMatrix.mul(vec4(offset, 1)).add(vec4(0, rotated.y, 0, 0));
                return cameraViewMatrix.mul(worldPosition).xyz.add(vec3(rotated.x, 0, 0));
            }
            default:
                return modelViewMatrix.mul(vec4(offset, 1)).xyz.add(vec3(rotated, 0));
        }
    }
}
