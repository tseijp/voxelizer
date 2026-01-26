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
        const _settle = (id: number, fn: (p: Pending) => void) => {
                const p = pending.get(id)
                if (!p) return
                pending.delete(id)
                clearTimeout(p.t)
                fn(p)
        }
        worker.onmessage = (e: MessageEvent) => {
                const { id, ...rest } = e.data as WorkerResult & { id: number; error?: string }
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
        }
        const run = (payload: { url: string; mode: WorkerRequest }, signal?: AbortSignal) => {
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
                worker.postMessage({ id, ...payload })
                return promise
        }
        return { run }
}

export const createStore = (mesh: Mesh, queues = createQueues(), worker = createBridge()) => {
        const map = new Map<number, Region>()
        const ensure = (rx = 0, ry = 0) => {
                const id = regionId(rx, ry)
                const existing = map.get(id)
                if (existing) return existing
                const region = createRegion(mesh, rx, ry, queues, worker)
                map.set(id, region)
                return region
        }
        const prune = (active: Set<Region>, { i, j }: { i: number; j: number }) => {
                if (map.size <= CACHE) return
                const dist = (r: Region) => Math.hypot(r.i - i, r.j - j)
                const list = [...map.values()].filter((r) => !active.has(r)).sort((a, b) => dist(b) - dist(a))
                for (const r of list) {
                        if (map.size <= CACHE) break
                        map.delete(r.id)
                        r.dispose()
                }
        }
        return { ensure, prune, map }
}

export type WorkerBridge = ReturnType<typeof createBridge>
