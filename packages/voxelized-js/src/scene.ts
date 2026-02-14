import { createSlots } from './slot'
import { createStore } from './store'
import { culling, localOf, offOf, posOf, PREFETCH, SLOT, scoped, PREBUILD, regionId } from './utils'
import type { Camera } from './camera'
import type { Debug } from './debug'
import type { Mesh } from './mesh'
import type { Region } from './region'

const RANGE = 8

const grid = (range: number, callback: (dx: number, dy: number) => void) => {
        for (let dx = range; dx >= -range; dx--) for (let dy = range; dy >= -range; dy--) callback(dx, dy)
}

export const createScene = (mesh: Mesh, cam: Camera, worker: Worker, debug?: Debug) => {
        const store = createStore(mesh, worker, debug)
        const slots = createSlots(SLOT)
        let regions = new Set<Region>()
        let isLoading = false
        let isFirst = true
        let pt = performance.now()
        const vis = () => {
                const all: { d: number; r: Region }[] = []
                const [i, j] = posOf(cam.pos[0], cam.pos[2])
                grid(RANGE, (dx, dy) => {
                        const [_i, _j] = [i + dx, j + dy]
                        if (!scoped(_i, _j)) return
                        const r = store.ensure(_i, _j)
                        all.push({ d: Math.hypot(dx, dy), r })
                })
                all.sort((a, b) => a.d - b.d)
                const visible = all.filter(({ r }) => culling(cam.MVP, ...offOf(r.i, r.j)))
                regions = new Set(visible.slice(0, SLOT).map((k) => k.r))
                const active = new Set<Region>()
                const activeKeys = new Set<string>()
                regions.forEach((r) => {
                        r.tune('full', 3)
                        active.add(r)
                        activeKeys.add(`${r.i}:${r.j}`)
                        debug?.setState(r.i, r.j, 'visible', r.isError())
                })
                let prebuildCount = 0
                for (const { r } of all) {
                        if (prebuildCount >= PREBUILD) break
                        if (active.has(r)) continue
                        r.tune('full', 2)
                        active.add(r)
                        activeKeys.add(`${r.i}:${r.j}`)
                        debug?.setState(r.i, r.j, 'prebuild', r.isError())
                        prebuildCount++
                }
                let prefetchCount = 0
                for (const { r } of all) {
                        if (prefetchCount >= PREFETCH) break
                        if (active.has(r)) continue
                        r.tune('image', 1)
                        active.add(r)
                        activeKeys.add(`${r.i}:${r.j}`)
                        debug?.setState(r.i, r.j, 'prefetch', r.isError())
                        prefetchCount++
                }
                debug?.setAnchor(i, j)
                debug?.prune(activeKeys)
                store.map.forEach((r) => {
                        if (active.has(r)) return
                        r.tune('none', -1)
                        r.dispose()
                })
                store.prune(active, i, j)
                return regions
        }
        const render = (gl: WebGL2RenderingContext, program: WebGLProgram) => {
                const now = performance.now()
                if (!isLoading && (isFirst || now - pt >= 100)) {
                        isFirst = false
                        vis()
                        mesh.reset()
                        slots.begin(regions)
                        isLoading = true
                        pt = now
                }
                if (isLoading)
                        if (slots.step(gl, program, 6)) {
                                mesh.commit()
                                isLoading = false
                        }
        }
        const pick = (wx = 0, wy = 0, wz = 0) => {
                const [ri, rj] = posOf(wx, wz)
                if (!scoped(ri, rj)) return 0
                const r = store.map.get(regionId(ri, rj))
                if (!r) return 0
                return r.pick(...localOf(wx, wy, wz, ri, rj))
        }
        return { render, pick, vis, slots, map: store.map }
}

export type Scene = ReturnType<typeof createScene>
export type WorkerMode = 'none' | 'image' | 'full' | 'error'

type WorkerMessageImpl = {
        id: number
        i: number
        j: number
        mode: 'image' | 'full'
}
type WorkerAbort = { id: number; abort: true }

export type WorkerMessage = WorkerMessageImpl | WorkerAbort

export type WorkerResponse = {
        id: number
        mode: WorkerMode
        bitmap?: ImageBitmap
        mesh?: { pos: Float32Array; scl: Float32Array; cnt: number }
        occ?: Uint8Array
        error?: string
}

export type WorkerResult = {
        bitmap: ImageBitmap
        mesh?: { pos: Float32Array; scl: Float32Array; cnt: number }
        occ?: Uint8Array
        mode: WorkerMode
        memo?: any
}
