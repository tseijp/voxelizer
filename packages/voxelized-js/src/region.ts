import { ATLAS_URL, offOf, REGION, regionId, SCOPE } from './utils'
import type { Mesh } from './mesh'
import type { Queues, QueueTask } from './queue'
import type { WorkerBridge, WorkerResult } from './scene'

export const createRegion = (mesh: Mesh, i = SCOPE.x0, j = SCOPE.y0, queues: Queues, worker: WorkerBridge) => {
        let isDisposed = false
        let isMeshed = false
        let pending: Promise<WorkerResult>
        let queued: QueueTask<WorkerResult>
        let level = 'none' as 'none' | 'image' | 'full'
        let data: WorkerResult
        let ticket = 0
        let failUntil = 0
        let request = 'none' as 'none' | 'image' | 'full'

        const _request = (mode: 'image' | 'full', priority = 0) => {
                if (performance.now() < failUntil) return Promise.resolve(data)
                if (isDisposed) return Promise.resolve(data)
                if (level === 'full') return Promise.resolve(data)
                if (mode === 'full' && level === 'image') pending = undefined as unknown as Promise<WorkerResult>
                if (!pending) {
                        ticket++
                        const t = ticket
                        const url = `${ATLAS_URL}/17_${i}_${j}.png`
                        request = mode
                        const { promise, task } = queues.schedule((signal) => worker.run({ url, mode }, signal), priority, mode)
                        queued = task
                        pending = promise
                                .then((res) => {
                                        if (isDisposed || t !== ticket) return res
                                        if (!res || !res.bitmap) {
                                                failUntil = performance.now() + 1500
                                                level = 'none'
                                                return data
                                        }
                                        data = res
                                        level = res.mesh ? 'full' : 'image'
                                        return res
                                })
                                .catch(() => {
                                        failUntil = performance.now() + 1500
                                        level = 'none'
                                        return data
                                })
                } else {
                        queues.tune(queued, priority)
                }
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
        const abort = () => {
                ticket++
                queues.abort(queued)
                pending = undefined as unknown as Promise<WorkerResult>
                queued = undefined as unknown as QueueTask<WorkerResult>
                request = 'none'
        }
        const tune = (mode: 'none' | 'image' | 'full', priority = 0) => {
                if (mode === 'none') {
                        abort()
                        return
                }
                if (mode === 'image') {
                        if (level === 'full') return
                        if (request === 'full') abort()
                        _request('image', priority)
                        return
                }
                if (request === 'image') abort()
                _request('full', priority)
        }
        const dispose = () => {
                isDisposed = true
                isMeshed = false
                failUntil = 0
                abort()
                data = undefined as unknown as WorkerResult
                level = 'none'
                return true
        }
        const resetMesh = () => void (isMeshed = false)
        const peek = () => data?.bitmap
        const fetching = () => !!pending && (!data || (data && data.mode !== 'full'))
        const [x, y, z] = offOf(i, j)
        return { id: regionId(i, j), x, y, z, i, j, image, build, pick, dispose, prefetch, peek, fetching, slot: -1, resetMesh, tune }
}
