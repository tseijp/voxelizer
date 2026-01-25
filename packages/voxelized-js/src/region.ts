import { ATLAS_URL, offOf, REGION, regionId, SCOPE } from './utils'
import type { Mesh } from './mesh'
import type { Queues, QueueTask } from './queue'
import type { WorkerBridge, WorkerResult } from './scene'

type BuiltCache = { pos: Float32Array; scl: Float32Array; cnt: number }

export const createRegion = (mesh: Mesh, i = SCOPE.x0, j = SCOPE.y0, queues: Queues, worker: WorkerBridge) => {
        let isDisposed = false
        let isMeshed = false
        let pending: Promise<WorkerResult>
        let queued: QueueTask<WorkerResult>
        let level = 'none' as 'none' | 'image' | 'full'
        let data: WorkerResult

        const _request = (mode: 'image' | 'full', priority = 0) => {
                if (isDisposed) return Promise.resolve(data)
                if (level === 'full') return Promise.resolve(data)
                if (mode === 'full' && level === 'image') pending = undefined as unknown as Promise<WorkerResult>
                if (!pending) {
                        const url = `${ATLAS_URL}/17_${i}_${j}.png`
                        const { promise, task } = queues.schedule(() => worker.run({ url, mode }), priority)
                        queued = task
                        pending = promise.then((res) => {
                                if (isDisposed) return res
                                data = res
                                level = res.mesh ? 'full' : 'image'
                                return res
                        })
                } else queues.bump(queued, priority)
                return pending
        }
        const image = async (priority = 0) => (data && data.bitmap) || _request('image', priority).then((r) => r.bitmap)
        const prefetch = (mode: 'image' | 'full', priority = 0) => _request(mode, priority)
        const build = (index = 0) => {
                if (isMeshed || isDisposed) return true
                if (!data || !data.mesh) return false
                mesh.merge({ pos: Array.from(data.mesh.pos), scl: Array.from(data.mesh.scl), cnt: data.mesh.cnt }, index, 0, 0, 0)
                isMeshed = true
                return true
        }
        const pick = (lx = 0, ly = 0, lz = 0) => {
                if (!data || !data.occ) return 0
                if (lx < 0 || lx >= REGION || ly < 0 || ly >= REGION || lz < 0 || lz >= REGION) return 0
                const idx = Math.floor(lx) + (Math.floor(ly) + Math.floor(lz) * REGION) * REGION
                return data.occ[idx]
        }
        const dispose = () => {
                isDisposed = true
                isMeshed = false
                pending = undefined as unknown as Promise<WorkerResult>
                queued = undefined as unknown as QueueTask<WorkerResult>
                data = undefined as unknown as WorkerResult
                level = 'none'
                return true
        }
        const resetMesh = () => void (isMeshed = false)
        const peek = () => data?.bitmap
        const fetching = () => !!pending && (!data || (data && data.mode !== 'full'))
        const [x, y, z] = offOf(i, j)
        return { id: regionId(i, j), x, y, z, i, j, image, build, pick, dispose, prefetch, peek, fetching, slot: -1, resetMesh }
}
