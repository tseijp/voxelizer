import { createRegion } from './region'
import { createQueues } from './queue'
import { PREPURGE, regionId } from './utils'
import type { Debug } from './debug'
import type { Mesh } from './mesh'
import type { Region } from './region'
import type { WorkerResponse, WorkerResult } from './scene'

type Pending = { resolve: (v: WorkerResult) => void; reject: (e?: unknown) => void; t: number }

export const createBridge = (workerUrl: string | URL) => {
        const spawn = () => new Worker(workerUrl, { type: 'module' })
        let worker = spawn()
        let seq = 0
        const pending = new Map<number, Pending>()
        const _settle = (id: number, fn: (p: Pending) => void) => {
                const p = pending.get(id)
                if (!p) return
                pending.delete(id)
                clearTimeout(p.t)
                fn(p)
        }
        const bind = () => {
                worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
                        const { id, ...rest } = e.data
                        if (rest.mode === 'error')
                                return _settle(id, (p) => {
                                        console.warn('worker error', rest)
                                        p.reject(rest)
                                })
                        _settle(id, (p) => p.resolve(rest as WorkerResult))
                }
                worker.onerror = (e: ErrorEvent) => {
                        console.warn('worker crash', e.message)
                        pending.forEach((_, id) => _settle(id, (q) => q.reject(e.message)))
                        worker.terminate()
                        worker = spawn()
                        bind()
                }
                worker.onmessageerror = () => {
                        pending.forEach((_, id) => _settle(id, (q) => q.reject('message')))
                        worker.terminate()
                        worker = spawn()
                        bind()
                }
        }
        bind()
        const run = (i: number, j: number, mode: 'image' | 'full', signal?: AbortSignal) => {
                const id = seq++
                let resolve = (_: WorkerResult) => {}
                let reject = (_?: unknown) => {}
                const promise = new Promise<WorkerResult>((r, j) => {
                        resolve = r
                        reject = j
                })
                const t = window.setTimeout(() => _settle(id, (p) => p.reject('timeout')), 8000)
                if (signal?.aborted) {
                        clearTimeout(t)
                        reject('abort')
                        return promise
                }
                pending.set(id, { resolve, reject, t })
                signal?.addEventListener('abort', () => {
                        _settle(id, (p) => p.reject('abort'))
                        worker.postMessage({ id, abort: true })
                })
                worker.postMessage({ id, i, j, mode })
                return promise
        }
        return { run }
}

export const createStore = (mesh: Mesh, workerUrl: string | URL, debug?: Debug) => {
        const queues = createQueues()
        const worker = createBridge(workerUrl)
        const map = new Map<number, Region>()
        const ensure = (rx = 0, ry = 0) => {
                const id = regionId(rx, ry)
                const got = map.get(id)
                if (got) return got
                const r = createRegion(rx, ry, mesh, queues, worker, debug)
                map.set(id, r)
                return r
        }
        const prune = (active: Set<Region>, i: number, j: number) => {
                if (map.size <= PREPURGE) return
                const dist = (r: Region) => Math.hypot(r.i - i, r.j - j)
                const list = [...map.values()].filter((r) => !active.has(r)).sort((a, b) => dist(b) - dist(a))
                for (const r of list) {
                        if (map.size <= PREPURGE) break
                        map.delete(r.id)
                        r.dispose()
                }
        }
        return { ensure, prune, map }
}

export type WorkerBridge = ReturnType<typeof createBridge>
