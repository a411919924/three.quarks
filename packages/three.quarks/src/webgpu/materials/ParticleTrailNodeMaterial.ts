import {NodeMaterial} from 'three/webgpu';
import type {Node, NodeBuilder, NodeMaterialParameters} from 'three/webgpu';
import {
    all,
    attribute,
    cameraProjectionMatrix,
    Fn,
    If,
    modelViewMatrix,
    normalize,
    positionGeometry,
    vec2,
    vec4,
} from 'three/tsl';

/**
 * The node material of particle trails. It widens each point of the ribbon to `width` across the screen-space
 * direction from `previous` to `next`, on the side the `side` attribute (-1 or 1) says.
 */
export class ParticleTrailNodeMaterial extends NodeMaterial {
    static get type() {
        return 'ParticleTrailNodeMaterial';
    }

    constructor(parameters?: NodeMaterialParameters) {
        super();
        this.setValues(parameters);
    }

    // premultipliedAlpha only selects the premultiplied blend factors, as in the WebGL batches.
    setupPremultipliedAlpha(_builder: NodeBuilder, outputNode: Node): Node {
        return outputNode;
    }

    setupModelViewProjection(): Node {
        return Fn(() => {
            const modelViewProjection = cameraProjectionMatrix.mul(modelViewMatrix);
            const clipPosition = modelViewProjection.mul(vec4(positionGeometry, 1)).toVar();
            const previousClip = modelViewProjection.mul(vec4(attribute('previous', 'vec3'), 1));
            const nextClip = modelViewProjection.mul(vec4(attribute('next', 'vec3'), 1));

            const current = clipPosition.xy.div(clipPosition.w);
            const previous = previousClip.xy.div(previousClip.w);
            const next = nextClip.xy.div(nextClip.w);

            const dir = vec2().toVar();
            If(all(next.equal(current)), () => {
                dir.assign(normalize(current.sub(previous)));
            })
                .ElseIf(all(previous.equal(current)), () => {
                    dir.assign(normalize(next.sub(current)));
                })
                .Else(() => {
                    dir.assign(normalize(normalize(current.sub(previous)).add(normalize(next.sub(current)))));
                });

            const normal = vec4(vec2(dir.y.negate(), dir.x).mul(attribute('width', 'float').mul(0.5)), 0, 1).mul(
                cameraProjectionMatrix
            );
            return vec4(clipPosition.xy.add(normal.xy.mul(attribute('side', 'float'))), clipPosition.zw);
        })();
    }
}
