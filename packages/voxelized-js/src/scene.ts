import { createRegion } from './region'
import { createSlots } from './slot'
import { createQueues } from './queue'
import { CACHE, culling, offOf, posOf, PREFETCH, REGION, ROW, SCOPE, SLOT, scoped } from './utils'
import type { Camera } from './camera'
import type { Mesh } from './mesh'

type Pending = { resolve: (v: WorkerResult) => void }

const createWorkerBridge = () => {
        const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
        let seq = 0
        const pend = new Map<number, Pending>()
        worker.onmessage = (e: MessageEvent) => {
                const { id, ...rest } = e.data as WorkerResult & { id: number }
                const p = pend.get(id)
                if (!p) return
                pend.delete(id)
                p.resolve(rest as WorkerResult)
        }
        const run = (payload: { url: string; mode: 'image' | 'full' }) => {
                const id = seq++
                let resolve = (_: WorkerResult) => {}
                const promise = new Promise<WorkerResult>((r) => (resolve = r))
                pend.set(id, { resolve })
                worker.postMessage({ id, ...payload })
                return promise
        }
        return { run }
}

const createRegionStore = (mesh: Mesh, queues = createQueues(), worker = createWorkerBridge()) => {
        const map = new Map<number, Region>()
        const ensure = (rx = 0, ry = 0) => {
                const id = rx + ROW * ry
                const got = map.get(id)
                if (got) return got
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

export const createScene = (mesh: Mesh, cam: Camera) => {
        const slots = createSlots(SLOT)
        const store = createRegionStore(mesh)
        let visSet = new Set<Region>()
        let isLoading = false
        let last = performance.now()
        const _coord = () => {
                const [si, sj] = posOf(cam.pos[0], cam.pos[2])
                const keep: { d: number; region: Region }[] = []
                const prefetchImg = new Set<Region>()
                const preproc = new Set<Region>()
                const loop = (dx = 0, dy = 0) => {
                        const rx = si + dx
                        const ry = sj + dy
                        if (!scoped(rx, ry)) return
                        const id = rx + ROW * ry
                        const region = store.map.get(id) || store.ensure(rx, ry)
                        const d = Math.hypot(dx, dy)
                        const [x, y, z] = offOf(rx, ry)
                        if (Math.abs(dx) < PREFETCH && Math.abs(dy) < PREFETCH) prefetchImg.add(region)
                        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) preproc.add(region)
                        if (!culling(cam.MVP, x, y, z)) return
                        keep.push({ d, region })
                }
                for (let dx = -PREFETCH; dx <= PREFETCH; dx++) for (let dy = -PREFETCH; dy <= PREFETCH; dy++) loop(dx, dy)
                keep.sort((a, b) => a.d - b.d)
                const keepSet = new Set(keep.slice(0, SLOT).map((k) => k.region))
                keepSet.forEach((r) => prefetchImg.delete(r))
                keepSet.forEach((r) => preproc.add(r))
                prefetchImg.forEach((r) => r.prefetch('image', 0))
                preproc.forEach((r) => r.prefetch('full', r.slot >= 0 ? 1 : 2))
                if (keep[0]) store.prune(new Set([...keepSet, ...prefetchImg, ...preproc]), keep[0].region)
                return keepSet
        }
        const vis = () => (visSet = _coord() || visSet)
        const render = (gl: { gl: WebGL2RenderingContext; program: WebGLProgram }) => {
                const now = performance.now()
                if (!isLoading && now - last >= 100) {
                        vis()
                        mesh.reset()
                        slots.begin(visSet)
                        isLoading = true
                        last = now
                }
                if (isLoading) if (slots.step(gl.gl, gl.program, 6)) {
                        mesh.commit()
                        isLoading = false
                }
        }
        const pick = (wx = 0, wy = 0, wz = 0) => {
                const [rxi, ryj] = posOf(wx, wz)
                if (rxi < SCOPE.x0 || rxi > SCOPE.x1) return 0
                if (ryj < SCOPE.y0 || ryj > SCOPE.y1) return 0
                const r = store.map.get(rxi + ROW * ryj)
                if (!r) return 0
                const [ox, , oz] = offOf(rxi, ryj)
                return r.pick(wx - ox, wy, wz - oz)
        }
        return { render, pick, vis, slots, map: store.map }
}

export type Scene = ReturnType<typeof createScene>
export type Region = ReturnType<typeof createRegion>
export type WorkerResult = { bitmap: ImageBitmap; mesh?: { pos: Float32Array; scl: Float32Array; cnt: number }; occ?: Uint8Array; mode: 'image' | 'full' }
export type WorkerBridge = ReturnType<typeof createWorkerBridge>
