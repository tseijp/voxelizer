import { inRegion, local, offOf, regionId, SCOPE } from './utils'
import type { Debug } from './debug'
import type { Mesh } from './mesh'
import type { Queues, QueueTask } from './queue'
import type { WorkerMode, WorkerResult } from './scene'
import type { WorkerBridge } from './store'

const MAX_RETRY = 3

export const createRegion = (i = SCOPE.x0, j = SCOPE.y0, mesh: Mesh, queues: Queues, worker: WorkerBridge, debug?: Debug) => {
        let isMeshed = false
        let isError = false
        let pending: Promise<WorkerResult | undefined> | undefined
        let queued: QueueTask | undefined
        let result: WorkerResult | undefined
        let memoCache: any | undefined
        let level = 'none' as WorkerMode
        let request = 'none' as WorkerMode
        let retry = 0
        let ticket = 0
        const _done = () => {
                pending = undefined
                queued = undefined
                request = 'none'
        }
        const _markError = (mode: 'image' | 'full') => {
                retry++
                if (retry < MAX_RETRY) {
                        console.warn(`Retrying... ${retry}/${MAX_RETRY}\n└ Failed to load atlas: 17_${i}_${j}`)
                        level = 'none'
                        debug?.taskDone(i, j, mode)
                        _done()
                        return
                }
                console.warn(`Failed permanently: 17_${i}_${j}\n└ Max retries (${MAX_RETRY}) exceeded`)
                isError = true
                level = 'error'
                debug?.setState(i, j, 'error')
                debug?.setCache(i, j, 'empty')
                debug?.taskDone(i, j, mode)
                _done()
        }
        const _fetch = async (promise: Promise<WorkerResult>, _ticket: number, mode: 'image' | 'full') => {
                try {
                        const res = await promise
                        if (_ticket !== ticket) return res
                        if (!res || !res.bitmap) {
                                _markError(mode)
                                return result
                        }
                        retry = 0
                        level = res.mesh ? 'full' : 'image'
                        if (res.memo !== undefined) memoCache = res.memo
                        debug?.setCache(i, j, mode === 'full' ? 'cached' : 'empty')
                        debug?.taskDone(i, j, mode)
                        _done()
                        return (result = res)
                } catch {
                        if (_ticket !== ticket) return result
                        _markError(mode)
                        return result
                }
        }
        const _request = (mode: 'image' | 'full', priority = 0) => {
                if (isError) return Promise.resolve(result)
                if (level === 'full') return Promise.resolve(result)
                if (level === 'image' && mode === 'image') return Promise.resolve(result)
                if (level === 'image' && mode === 'full' && request !== 'full') pending = undefined
                if (pending) queues.tune(queued, priority)
                else {
                        ticket++
                        const { promise, task } = queues.schedule((signal) => worker.run(i, j, mode, signal), priority, mode)
                        queued = task
                        request = mode
                        debug?.setCache(i, j, mode === 'full' ? 'building' : 'fetching')
                        debug?.taskStart(i, j, mode)
                        pending = _fetch(promise, ticket, mode)
                }
                return pending
        }
        const _abort = () => {
                if (request !== 'none') debug?.taskAbort(i, j)
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
                if (isError) return true
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
                if (isError) return
                if (mode === 'image') {
                        if (level === 'full') return
                        if (level === 'image') return
                        if (request === 'full') _abort()
                        if (request === 'image') return queues.tune(queued, priority)
                        _request('image', priority)
                        return
                }
                if (level === 'full') return
                if (request === 'image') _abort()
                if (request === 'full') return queues.tune(queued, priority)
                _request('full', priority)
        }
        const dispose = () => {
                isMeshed = false
                isError = false
                retry = 0
                _abort()
                result = undefined
                memoCache = undefined
                level = 'none'
                debug?.setCache(i, j, 'purged')
                return true
        }
        const reset = () => void (isMeshed = false)
        const fetching = () => {
                if (!pending) return false
                if (!result) return true
                if (result.mode !== 'full') return true
                return false
        }
        const bitmap = () => result?.bitmap
        const occ = () => result?.occ
        const memo = () => memoCache
        const setMemo = (m: any) => {
                memoCache = m
        }
        const getError = () => isError
        const [x, y, z] = offOf(i, j)
        return { id: regionId(i, j), x, y, z, i, j, prefetch, image, build, pick, dispose, fetching, reset, tune, slot: -1, bitmap, occ, memo, setMemo, isError: getError }
}

export type Region = ReturnType<typeof createRegion>
