import { inRegion, local, offOf, regionId, SCOPE } from './utils'
import { debugTaskStart, debugTaskDone, debugTaskAbort, debugSetCache } from './debug'
import type { Mesh } from './mesh'
import type { Queues, QueueTask } from './queue'
import type { WorkerMode, WorkerResult } from './scene'
import type { WorkerBridge } from './store'

export const createRegion = (mesh: Mesh, i = SCOPE.x0, j = SCOPE.y0, queues: Queues, worker: WorkerBridge) => {
        let isMeshed = false
        let pending: Promise<WorkerResult | undefined> | undefined
        let queued: QueueTask | undefined
        let result: WorkerResult | undefined
        let level = 'none' as WorkerMode
        let request = 'none' as WorkerMode
        let ticket = 0
        let failed = 0
        const _done = () => {
                pending = undefined
                queued = undefined
                request = 'none'
        }
        const _fetch = async (promise: Promise<WorkerResult>, _ticket: number, mode: 'image' | 'full') => {
                try {
                        const res = await promise
                        if (_ticket !== ticket) {
                                _done()
                                return res
                        }
                        if (!res || !res.bitmap) {
                                failed = performance.now() + 1500
                                level = 'none'
                                debugTaskDone(i, j, mode)
                                _done()
                                return result
                        }
                        level = res.mesh ? 'full' : 'image'
                        debugSetCache(i, j, mode === 'full' ? 'cached' : 'empty')
                        debugTaskDone(i, j, mode)
                        _done()
                        return (result = res)
                } catch {
                        failed = performance.now() + 1500
                        level = 'none'
                        debugTaskDone(i, j, mode)
                        _done()
                        return result
                }
        }
        const _request = (mode: 'image' | 'full', priority = 0) => {
                if (performance.now() < failed) return Promise.resolve(result)
                if (level === 'full') return Promise.resolve(result)
                if (level === 'image' && mode === 'image') return Promise.resolve(result)
                if (level === 'image' && mode === 'full') pending = undefined
                if (pending) queues.tune(queued, priority)
                else {
                        ticket++
                        const { promise, task } = queues.schedule((signal) => worker.run(i, j, mode, signal), priority, mode)
                        queued = task
                        request = mode
                        debugSetCache(i, j, 'loading')
                        debugTaskStart(i, j, mode)
                        pending = _fetch(promise, ticket, mode)
                }
                return pending
        }
        const _abort = () => {
                if (request !== 'none') debugTaskAbort(i, j)
                ticket++
                queues.abort(queued)
                pending = undefined
                queued = undefined
                request = 'none'
        }
        const prefetch = async (mode: 'image' | 'full', priority = 0) => await _request(mode, priority)
        const image = async (priority = 0) => {
                if (result) return result.bitmap
                const res = await _request('image', priority)
                return res?.bitmap!
        }
        const build = (index = 0) => {
                if (isMeshed) return true
                if (!result || !result.mesh) return false
                mesh.merge({ pos: result.mesh.pos, scl: result.mesh.scl, cnt: result.mesh.cnt }, index, 0, 0, 0)
                isMeshed = true
                return true
        }
        const pick = (lx = 0, ly = 0, lz = 0) => {
                if (!result || !result.occ) return 0
                if (!inRegion(lx, ly, lz)) return 0
                return result.occ[local(lx, ly, lz)]
        }
        const tune = (mode: WorkerMode, priority = 0) => {
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
                isMeshed = false
                failed = 0
                _abort()
                result = undefined
                level = 'none'
                debugSetCache(i, j, 'purged')
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
