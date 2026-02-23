import { greedyMesh } from 'voxelized-rs'
import { createWorkerHandler } from 'voxelized-js/src/worker'

self.onmessage = createWorkerHandler(greedyMesh as any)
