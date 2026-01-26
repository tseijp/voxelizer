import { ATLAS_URL, inRegion, localIdx, offOf, regionId, SCOPE } from './utils'
import type { Mesh } from './mesh'
import type { Queues, QueueTask } from './queue'
import type { WorkerRequest, WorkerResult } from './scene'
import type { WorkerBridge } from './store'

export const createRegion = (mesh: Mesh, i = SCOPE.x0, j = SCOPE.y0, queues: Queues, worker: WorkerBridge) => {
        let isDisposed = false
        let isMeshed = false
        let pending: Promise<WorkerResult> | undefined
        let queued: QueueTask
        let result: WorkerResult
        let level = 'none' as WorkerRequest
        let request = 'none' as WorkerRequest
        let ticket = 0
        let failed = 0
        const _fetch = async (promise: Promise<WorkerResult>, _ticket: number) => {
                try {
                        const res = await promise
                        if (isDisposed || _ticket !== ticket) return res
                        if (!res || !res.bitmap) {
                                failed = performance.now() + 1500
                                level = 'none'
                                return result
                        }
                        level = res.mesh ? 'full' : 'image'
                        return (result = res)
                } catch {
                        failed = performance.now() + 1500
                        level = 'none'
                        return result
                }
        }
        const _request = (mode: WorkerRequest, priority = 0) => {
                if (performance.now() < failed) return Promise.resolve(result)
                if (isDisposed) return Promise.resolve(result)
                if (level === 'full') return Promise.resolve(result)
                if (level === 'image' && mode === 'full') pending = undefined as unknown as Promise<WorkerResult>
                if (!pending) {
                        ticket++
                        const { promise, task } = queues.schedule((signal) => worker.run({ url: `${ATLAS_URL}/17_${i}_${j}.png`, mode }, signal), priority, mode)
                        queued = task
                        request = mode
                        pending = _fetch(promise, ticket)
                } else {
                        queues.tune(queued, priority)
                }
                return pending
        }
        const _abort = () => {
                ticket++
                queues.abort(queued)
                pending = undefined as unknown as Promise<WorkerResult>
                queued = undefined as unknown as QueueTask
                request = 'none'
        }
        const prefetch = async (mode: WorkerRequest, priority = 0) => await _request(mode, priority)
        const image = async (priority = 0) => {
                if (result) return result.bitmap
                const res = await _request('image', priority)
                return res?.bitmap!
        }
        const build = (index = 0) => {
                if (isMeshed || isDisposed) return true
                if (!result || !result.mesh) return false
                mesh.merge({ pos: result.mesh.pos, scl: result.mesh.scl, cnt: result.mesh.cnt }, index, 0, 0, 0)
                isMeshed = true
                return true
        }
        const pick = (lx = 0, ly = 0, lz = 0) => {
                if (!result || !result.occ) return 0
                if (!inRegion(lx, ly, lz)) return 0
                return result.occ[localIdx(lx, ly, lz)]
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
                result = undefined as unknown as WorkerResult
                level = 'none'
                return true
        }
        const reset = () => void (isMeshed = false)
        const fetching = () => {
                if (!pending) return false
                if (!result) return true
                if (result.mode !== 'full') return true
                return false
        }
        const [x, y, z] = offOf(i, j)
        return { id: regionId(i, j), x, y, z, i, j, prefetch, image, build, pick, dispose, fetching, reset, tune, slot: -1, bitmap: () => result?.bitmap }
}

export type Region = ReturnType<typeof createRegion>
