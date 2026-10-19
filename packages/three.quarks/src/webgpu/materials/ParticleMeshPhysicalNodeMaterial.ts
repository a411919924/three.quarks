import {MeshPhysicalNodeMaterial} from 'three/webgpu';
import type {Node, NodeBuilder} from 'three/webgpu';
import {transformMeshParticle} from '../nodes/ParticleNodes';

/**
 * A MeshPhysicalNodeMaterial for mesh particles: each instance of the mesh is placed by {@link transformMeshParticle}.
 */
export class ParticleMeshPhysicalNodeMaterial extends MeshPhysicalNodeMaterial {
    static get type() {
        return 'ParticleMeshPhysicalNodeMaterial';
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

    setupClearcoatNormal(): Node {
        const normal = super.setupClearcoatNormal();
        return this.contextNode ? normal.context(this.contextNode.value) : normal;
    }
}
