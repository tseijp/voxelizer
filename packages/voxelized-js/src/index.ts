import { createSlots } from './slot'
import { createStore } from './store'
import { createCamera } from './camera'
import { createMesh } from './mesh'
import { culling, localOf, offOf, posOf, scoped, regionId, defaults } from './utils'
import type { CameraConfig } from './camera'
import type { Debug } from './debug'
import type { Region } from './region'
import type { SlotUpdate } from './slot'
import type { VoxelConfig } from './utils'

const RANGE = 8

const grid = (range: number, cb: (dx: number, dy: number) => void) => {
        for (let dx = range; dx >= -range; dx--) for (let dy = range; dy >= -range; dy--) cb(dx, dy)
}

const createVis = (mvp: number[], pos: number[], store: any, c: VoxelConfig, debug?: Debug) => {
        const { x0, x1, y0, y1, slot, prebuild, prefetch } = c
        const w = x1 - x0 + 1
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
                const [i, j] = posOf(pos[0], pos[2], x0, y0)
                active = new Set()
                keys = new Set()
                grid(RANGE, (dx, dy) => {
                        const ri = i + dx,
                                rj = j + dy
                        if (!scoped(ri, rj, x0, x1, y0, y1)) return
                        all.push({ d: Math.hypot(dx, dy), r: store.ensure(ri, rj) })
                })
                all.sort((a, b) => a.d - b.d)
                const visible = all.filter(({ r }) => culling(mvp, ...offOf(r.i, r.j, x0, y0)))
                regions = new Set(visible.slice(0, slot).map(({ r }) => r))
                regions.forEach((r) => mark(r, 'full', 3, 'visible'))
                take(all, prebuild, 'full', 2, 'prebuild')
                take(all, prefetch, 'image', 1, 'prefetch')
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

export const createVoxel = ({ worker, i, j, camera: cc, debug, onReady, ...opts }: { worker: Worker; i?: number; j?: number; camera?: CameraConfig; debug?: Debug; onReady?: () => void } & Partial<VoxelConfig>) => {
        const c = { ...defaults, ...opts }
        const { x0, x1, y0, y1 } = c
        const w = x1 - x0 + 1
        worker.postMessage({ config: { atlasUrl: c.atlasUrl, atlasExt: c.atlasExt } })
        const cx = i !== undefined ? (i - x0 + 0.5) * 256 : cc?.x ?? (w * 256) / 2
        const cz = j !== undefined ? (j - y0 + 0.5) * 256 : cc?.z ?? (w * 256) / 2
        const cam = createCamera({ ...cc, x: cx, z: cz, wrap: w * 256 })
        const mesh = createMesh()
        const store = createStore(mesh, worker, c, debug)
        const slots = createSlots(c.slot)
        const { mvp, pos } = cam
        const { vis, regions } = createVis(mvp, pos, store, c, debug)
        let isLoading = false
        let isFirst = true
        let isReady = false
        let renderPt = performance.now()
        let updated = false
        let ts = performance.now()
        let pt = ts
        const pick = (wx = 0, wy = 0, wz = 0) => {
                const [ri, rj] = posOf(wx, wz, x0, y0)
                if (!scoped(ri, rj, x0, x1, y0, y1)) return 0
                const r = store.map.get(regionId(ri, rj, w))
                if (!r) return 0
                return r.pick(...localOf(wx, wy, wz, ri, rj, x0, y0))
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
        return { cam, center: [cx, cz] as [number, number], updates, updated: () => updated, overflow: mesh.overflow, pos: mesh.pos, scl: mesh.scl, aid: mesh.aid, count: mesh.count, pick, map: store.map }
}

export default createVoxel

export * from './utils'
