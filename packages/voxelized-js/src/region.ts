import { ATLAS_URL, offOf, REGION, regionId, SCOPE } from './utils'
import type { Mesh } from './mesh'
import type { Queues, QueueTask } from './queue'
import type { WorkerRequest, WorkerResult } from './scene'
import type { WorkerBridge } from './store'

export const createRegion = (mesh: Mesh, i = SCOPE.x0, j = SCOPE.y0, queues: Queues, worker: WorkerBridge) => {
        let isDisposed = false
        let isMeshed = false
        let pending: Promise<WorkerResult> | undefined
        let queued: QueueTask<WorkerResult>
        let data: WorkerResult
        let level = 'none' as WorkerRequest
        let request = 'none' as WorkerRequest
        let ticket = 0
        let failed = 0
        const _request = (mode: WorkerRequest, priority = 0) => {
                if (performance.now() < failed) return Promise.resolve(data)
                if (isDisposed) return Promise.resolve(data)
                if (level === 'full') return Promise.resolve(data)
                if (level === 'image' && mode === 'full') pending = undefined as unknown as Promise<WorkerResult>
                if (!pending) {
                        ticket++
                        const _ticket = ticket
                        const url = `${ATLAS_URL}/17_${i}_${j}.png`
                        request = mode
                        const { promise, task } = queues.schedule((signal) => worker.run({ url, mode }, signal), priority, mode)
                        queued = task
                        pending = promise
                                .then((res) => {
                                        if (isDisposed || _ticket !== ticket) return res
                                        if (!res || !res.bitmap) {
                                                failed = performance.now() + 1500
                                                level = 'none'
                                                return data
                                        }
                                        level = res.mesh ? 'full' : 'image'
                                        return (data = res)
                                })
                                .catch(() => {
                                        failed = performance.now() + 1500
                                        level = 'none'
                                        return data
                                })
                } else {
                        queues.tune(queued, priority)
                }
                return pending
        }
        const _abort = () => {
                ticket++
                queues.abort(queued)
                pending = undefined as unknown as Promise<WorkerResult>
                queued = undefined as unknown as QueueTask<WorkerResult>
                request = 'none'
        }
        const prefetch = async (mode: WorkerRequest, priority = 0) => await _request(mode, priority)
        const image = async (priority = 0) => {
                if (data) return data.bitmap
                const res = await _request('image', priority)
                return res?.bitmap!
        }
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
        const tune = (mode: WorkerRequest, priority = 0) => {
                if (mode === 'none') return _abort()
                if (mode === 'image') {
                        if (level === 'full') return
                        if (request === 'full') _abort()
                        _request('image', priority)
                        return
                }
                if (request === 'image') _abort()
                _request('full', priority)
        }
        const dispose = () => {
                isDisposed = true
                isMeshed = false
                failed = 0
                _abort()
                data = undefined as unknown as WorkerResult
                level = 'none'
                return true
        }
        const reset = () => void (isMeshed = false)
        const fetching = () => {
                if (!pending) return false
                if (!data) return true
                if (data.mode !== 'full') return true
                return false
        }
        const [x, y, z] = offOf(i, j)
        return { id: regionId(i, j), x, y, z, i, j, prefetch, image, build, pick, dispose, fetching, reset, tune, slot: -1, bitmap: () => data?.bitmap }
}

export type Region = ReturnType<typeof createRegion>
