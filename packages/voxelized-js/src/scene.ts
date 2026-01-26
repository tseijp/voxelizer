import { createSlots } from './slot'
import { createStore } from './store'
import { culling, offOf, posOf, PREFETCH, SCOPE, SLOT, scoped, PREBUILD, regionId } from './utils'
import type { Camera } from './camera'
import type { Mesh } from './mesh'
import type { Region } from './region'

export const createScene = (mesh: Mesh, cam: Camera) => {
        const slots = createSlots(SLOT)
        const store = createStore(mesh)
        let regions = new Set<Region>()
        let isLoading = false
        let pt = performance.now()
        const _coord = () => {
                const [si, sj] = posOf(cam.pos[0], cam.pos[2])
                const keep: { d: number; region: Region }[] = []
                const prefetch = new Set<Region>()
                const prebuild = new Set<Region>()
                const loop = (dx = 0, dy = 0) => {
                        const rx = si + dx
                        const ry = sj + dy
                        if (!scoped(rx, ry)) return
                        const id = regionId(rx, ry)
                        const region = store.map.get(id) || store.ensure(rx, ry)
                        const d = Math.hypot(dx, dy)
                        const [x, y, z] = offOf(rx, ry)
                        if (Math.abs(dx) < PREFETCH && Math.abs(dy) < PREFETCH) prefetch.add(region)
                        if (Math.abs(dx) < PREBUILD && Math.abs(dy) < PREBUILD) prebuild.add(region)
                        if (!culling(cam.MVP, x, y, z)) return
                        keep.push({ d, region })
                }
                for (let dx = -PREFETCH; dx <= PREFETCH; dx++) for (let dy = -PREFETCH; dy <= PREFETCH; dy++) loop(dx, dy)
                keep.sort((a, b) => a.d - b.d)
                const keepSet = new Set(keep.slice(0, SLOT).map((k) => k.region))
                keepSet.forEach((r) => prefetch.delete(r))
                keepSet.forEach((r) => prebuild.add(r))
                return { keepSet, prefetch, prebuild, anchor: keep[0]?.region }
        }
        const _want = (keepSet: Set<Region>, prefetch: Set<Region>, prebuild: Set<Region>) => {
                const active = new Set<Region>()
                keepSet.forEach((r) => {
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
                })
                return active
        }
        const vis = () => {
                const res = _coord()
                if (!res) return regions
                const { keepSet, prefetch, prebuild, anchor } = res
                const wanted = _want(keepSet, prefetch, prebuild)
                store.map.forEach((r) => {
                        if (wanted.has(r)) return
                        r.dispose()
                })
                if (anchor) store.prune(wanted, anchor)
                return (regions = keepSet)
        }
        const render = (gl: { gl: WebGL2RenderingContext; program: WebGLProgram }) => {
                const now = performance.now()
                if (!isLoading && now - pt >= 100) {
                        vis()
                        mesh.reset()
                        slots.begin(regions)
                        isLoading = true
                        pt = now
                }
                if (isLoading)
                        if (slots.step(gl.gl, gl.program, 6)) {
                                mesh.commit()
                                isLoading = false
                        }
        }
        const pick = (wx = 0, wy = 0, wz = 0) => {
                const [rxi, ryj] = posOf(wx, wz)
                if (rxi < SCOPE.x0 || rxi > SCOPE.x1) return 0
                if (ryj < SCOPE.y0 || ryj > SCOPE.y1) return 0
                const r = store.map.get(regionId(rxi, ryj))
                if (!r) return 0
                const [ox, , oz] = offOf(rxi, ryj)
                return r.pick(wx - ox, wy, wz - oz)
        }
        return { render, pick, vis, slots, map: store.map }
}

export type Scene = ReturnType<typeof createScene>
export type WorkerRequest = 'none' | 'image' | 'full' | 'error'
export type WorkerResult = { bitmap: ImageBitmap; mesh?: { pos: Float32Array; scl: Float32Array; cnt: number }; occ?: Uint8Array; mode: WorkerRequest }
