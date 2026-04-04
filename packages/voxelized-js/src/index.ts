import { createSlots } from './slot'
import { createStore } from './store'
import { createCamera } from './camera'
import type { CameraConfig } from './camera'
import { createMesh } from './mesh'
import { culling, localOf, offOf, posOf, PREFETCH, SLOT, scoped, PREBUILD, regionId } from './utils'
import type { Debug } from './debug'
import type { Region } from './region'
import type { SlotUpdate } from './slot'

const RANGE = 8

const grid = (range: number, cb: (dx: number, dy: number) => void) => {
        for (let dx = range; dx >= -range; dx--) for (let dy = range; dy >= -range; dy--) cb(dx, dy)
}

const createVis = (mvp: number[], pos: number[], store: any, debug?: Debug) => {
        let regions = new Set<Region>()
        let active = new Set<Region>()
        let keys = new Set<string>()
        const mark = (r: Region, mode: 'full' | 'image', p: number, s: string) => {
                r.tune(mode, p)
                active.add(r)
                keys.add(`${r.i}:${r.j}`)
                debug?.setState(r.i, r.j, s as any, r.isError())
        }
        const take = (list: { r: Region }[], limit: number, mode: 'full' | 'image', p: number, s: string) => {
                let n = 0
                for (const { r } of list) {
                        if (n >= limit) return
                        if (active.has(r)) continue
                        mark(r, mode, p, s)
                        n++
                }
        }
        const vis = () => {
                const all: { d: number; r: Region }[] = []
                const [i, j] = posOf(pos[0], pos[2])
                active = new Set()
                keys = new Set()
                grid(RANGE, (dx, dy) => {
                        const ri = i + dx,
                                rj = j + dy
                        if (!scoped(ri, rj)) return
                        all.push({ d: Math.hypot(dx, dy), r: store.ensure(ri, rj) })
                })
                all.sort((a, b) => a.d - b.d)
                const visible = all.filter(({ r }) => culling(mvp, ...offOf(r.i, r.j)))
                regions = new Set(visible.slice(0, SLOT).map(({ r }) => r))
                regions.forEach((r) => mark(r, 'full', 3, 'visible'))
                take(all, PREBUILD, 'full', 2, 'prebuild')
                take(all, PREFETCH, 'image', 1, 'prefetch')
                debug?.setAnchor(i, j)
                debug?.prune(keys)
                store.map.forEach((r: Region) => {
                        if (active.has(r)) return
                        r.tune('none', -1)
                        r.dispose()
                })
                store.prune(active, i, j)
        }
        return { vis, regions: () => regions }
}

export const createVoxel = ({ worker, camera: cc, debug, onReady }: { worker: Worker; camera?: CameraConfig; debug?: Debug; onReady?: () => void }) => {
        const cam = createCamera(cc || {})
        const mesh = createMesh()
        const store = createStore(mesh, worker, debug)
        const slots = createSlots(SLOT)
        const { mvp, pos } = cam
        const { vis, regions } = createVis(mvp, pos, store, debug)
        let isLoading = false
        let isFirst = true
        let isReady = false
        let renderPt = performance.now()
        let updated = false
        let ts = performance.now()
        let pt = ts
        const pick = (wx = 0, wy = 0, wz = 0) => {
                const [ri, rj] = posOf(wx, wz)
                if (!scoped(ri, rj)) return 0
                const r = store.map.get(regionId(ri, rj))
                if (!r) return 0
                return r.pick(...localOf(wx, wy, wz, ri, rj))
        }
        const updates = (fn: (u: SlotUpdate) => void) => {
                pt = ts
                ts = performance.now()
                const dt = Math.min((ts - pt) / 1000, 0.03)
                if (isReady) cam.tick(dt, pick)
                cam.update()
                const now = performance.now()
                if (!isLoading && (isFirst || now - renderPt >= 100)) {
                        isFirst = false
                        vis()
                        mesh.reset()
                        slots.begin(regions())
                        isLoading = true
                        renderPt = now
                }
                updated = false
                if (isLoading)
                        if (slots.step(6)) {
                                updated = mesh.commit()
                                if (!isReady && updated) {
                                        isReady = true
                                        onReady?.()
                                }
                                isLoading = false
                        }
                slots.updates().forEach(fn)
        }
        return { cam, updates, updated: () => updated, overflow: mesh.overflow, pos: mesh.pos, scl: mesh.scl, aid: mesh.aid, count: mesh.count, pick, map: store.map }
}

export default createVoxel

export * from './utils'
