import { createSlots } from './slot'
import { createStore } from './store'
import { culling, localOf, offOf, posOf, PREFETCH, SLOT, scoped, PREBUILD, regionId, iterGrid, withinRange } from './utils'
import type { Camera } from './camera'
import type { Mesh } from './mesh'
import type { Region } from './region'

export const createScene = (mesh: Mesh, cam: Camera) => {
        const slots = createSlots(SLOT)
        const store = createStore(mesh)
        let regions = new Set<Region>()
        let isLoading = false
        let pt = performance.now()
        const vis = () => {
                const keep: { d: number; r: Region }[] = []
                const prefetch = new Set<Region>()
                const prebuild = new Set<Region>()
                const [i, j] = posOf(cam.pos[0], cam.pos[2])
                iterGrid(PREFETCH, (dx, dy) => {
                        const [_i, _j] = [i + dx, j + dy]
                        if (!scoped(_i, _j)) return
                        const r = store.ensure(_i, _j)
                        if (withinRange(dx, dy, PREFETCH)) prefetch.add(r)
                        if (withinRange(dx, dy, PREBUILD)) prebuild.add(r)
                        if (culling(cam.MVP, ...offOf(_i, _j))) keep.push({ d: Math.hypot(dx, dy), r })
                })
                keep.sort((a, b) => a.d - b.d)
                regions = new Set(keep.slice(0, SLOT).map((k) => k.r))
                const active = new Set<Region>()
                regions.forEach((r) => {
                        r.tune('full', 3)
                        active.add(r)
                })
                prebuild.forEach((r) => {
                        if (active.has(r)) return
                        r.tune('full', 2)
                        active.add(r)
                })
                prefetch.forEach((r) => {
                        if (active.has(r)) return
                        r.tune('image', 1)
                        active.add(r)
                })
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
                if (!isLoading && now - pt >= 100) {
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
export type WorkerRequest = 'none' | 'image' | 'full' | 'error'
export type WorkerResult = { bitmap: ImageBitmap; mesh?: { pos: Float32Array; scl: Float32Array; cnt: number }; occ?: Uint8Array; mode: WorkerRequest }
