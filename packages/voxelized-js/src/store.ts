import { createRegion } from './region'
import { createQueues } from './queue'
import { CACHE, regionId } from './utils'
import type { Mesh } from './mesh'
import type { Region } from './region'
import type { WorkerRequest, WorkerResult } from './scene'

type Pending = { resolve: (v: WorkerResult) => void; reject: (e?: unknown) => void; t: number }
const createBridge = () => {
        const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
        let seq = 0
        const pending = new Map<number, Pending>()
        const settle = (id: number, fn: (p: Pending) => void) => {
                const p = pending.get(id)
                if (!p) return
                pending.delete(id)
                clearTimeout(p.t)
                fn(p)
        }
        worker.onmessage = (e: MessageEvent) => {
                const { id, ...rest } = e.data as WorkerResult & { id: number; error?: string }
                if (rest.mode === 'error')
                        return settle(id, (p) => {
                                console.warn('worker error', rest)
                                p.reject(rest)
                        })
                settle(id, (p) => p.resolve(rest as WorkerResult))
        }
        worker.onerror = (e: ErrorEvent) => {
                console.warn('worker crash', e.message)
                pending.forEach((_p, id) => settle(id, (q) => q.reject(e.message)))
        }
        const run = (payload: { url: string; mode: WorkerRequest }, signal?: AbortSignal) => {
                const id = seq++
                let resolve = (_: WorkerResult) => {}
                let reject = (_?: unknown) => {}
                const promise = new Promise<WorkerResult>((r, j) => {
                        resolve = r
                        reject = j
                })
                const t = window.setTimeout(() => settle(id, (p) => p.reject('timeout')), 8000)
                pending.set(id, { resolve, reject, t })
                if (signal?.aborted) {
                        settle(id, (p) => p.reject('abort'))
                        return promise
                }
                signal?.addEventListener('abort', () => {
                        settle(id, (p) => p.reject('abort'))
                        worker.postMessage({ id, abort: true })
                })
                worker.postMessage({ id, ...payload })
                return promise
        }
        return { run }
}

export const createStore = (mesh: Mesh, queues = createQueues(), worker = createBridge()) => {
        const map = new Map<number, Region>()
        const ensure = (rx = 0, ry = 0) => {
                const id = regionId(rx, ry)
                if (map.has(id)) return map.get(id)!
                const region = createRegion(mesh, rx, ry, queues, worker)
                map.set(id, region)
                return region
        }
        const prune = (active: Set<Region>, origin: { i: number; j: number }) => {
                if (map.size <= CACHE) return
                const inactive = Array.from(map.values()).filter((r) => !active.has(r))
                inactive.sort((a, b) => Math.hypot(b.i - origin.i, b.j - origin.j) - Math.hypot(a.i - origin.i, a.j - origin.j))
                for (const r of inactive) {
                        if (map.size <= CACHE) break
                        map.delete(r.id)
                        r.dispose()
                }
        }
        return { ensure, prune, map }
}

export type WorkerBridge = ReturnType<typeof createBridge>
