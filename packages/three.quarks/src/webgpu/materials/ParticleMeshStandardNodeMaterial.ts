import {MeshStandardNodeMaterial} from 'three/webgpu';
import type {Node, NodeBuilder} from 'three/webgpu';
import {transformMeshParticle} from '../nodes/ParticleNodes';

/**
 * A MeshStandardNodeMaterial for mesh particles: each instance of the mesh is placed by {@link transformMeshParticle}.
 */
export class ParticleMeshStandardNodeMaterial extends MeshStandardNodeMaterial {
    static get type() {
        return 'ParticleMeshStandardNodeMaterial';
    }

    setupPosition(builder: NodeBuilder): Node {
        const position = super.setupPosition(builder);
        transformMeshParticle(builder);
        return position;
    }

    // three builds normals outside the material's context; the tile context (see tileUVContext) applies to them too.
    setupNormal(): Node {
        const normal = super.setupNormal();
        return this.contextNode ? normal.context(this.contextNode.value) : normal;
    }
}
