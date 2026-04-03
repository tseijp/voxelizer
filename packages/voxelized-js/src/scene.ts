import { createSlots } from './slot'
import { createStore } from './store'
import { culling, localOf, offOf, posOf, PREFETCH, SLOT, scoped, PREBUILD, regionId } from './utils'
import type { Camera } from './camera'
import type { Debug } from './debug'
import type { Region } from './region'
import type { SlotUpdate } from './slot'

const RANGE = 8

const grid = (range: number, callback: (dx: number, dy: number) => void) => {
        for (let dx = range; dx >= -range; dx--) for (let dy = range; dy >= -range; dy--) callback(dx, dy)
}

const createVis = (cam: Camera, store: any, debug?: Debug) => {
        let regions = new Set<Region>()
        let active = new Set<Region>()
        let keys = new Set<string>()
        const mark = (r: Region, mode: 'full' | 'image', priority: number, state: string) => {
                r.tune(mode, priority)
                active.add(r)
                keys.add(`${r.i}:${r.j}`)
                debug?.setState(r.i, r.j, state as any, r.isError())
        }
        const take = (all: { r: Region }[], limit: number, mode: 'full' | 'image', priority: number, state: string) => {
                let n = 0
                for (const { r } of all) {
                        if (n >= limit) return
                        if (active.has(r)) continue
                        mark(r, mode, priority, state)
                        n++
                }
        }
        const vis = () => {
                const all: { d: number; r: Region }[] = []
                const [i, j] = posOf(cam.pos[0], cam.pos[2])
                active = new Set()
                keys = new Set()
                grid(RANGE, (dx, dy) => {
                        const ri = i + dx,
                                rj = j + dy
                        if (!scoped(ri, rj)) return
                        all.push({ d: Math.hypot(dx, dy), r: store.ensure(ri, rj) })
                })
                all.sort((a, b) => a.d - b.d)
                const visible = all.filter(({ r }) => culling(cam.MVP, ...offOf(r.i, r.j)))
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
const createMesh = () => {
        let count = 1
        let cap = 1
        let pos = new Float32Array([0, 0, 0])
        let scl = new Float32Array([1, 1, 1])
        let aid = new Float32Array([0])
        let _count = 0
        let _cap = 0
        let _pos = new Float32Array(0)
        let _scl = new Float32Array(0)
        let _aid = new Float32Array(0)
        let overflow = false
        const ensure = (n: number) => {
                if (n <= _cap) return
                const c = Math.max(n, _cap * 2) || n
                const p = new Float32Array(c * 3)
                const s = new Float32Array(c * 3)
                const a = new Float32Array(c)
                if (_count) {
                        p.set(_pos.subarray(0, _count * 3))
                        s.set(_scl.subarray(0, _count * 3))
                        a.set(_aid.subarray(0, _count))
                }
                _pos = p
                _scl = s
                _aid = a
                _cap = c
        }
        const merge = (built: { pos: ArrayLike<number>; scl: ArrayLike<number>; cnt: number }, index = 0, ox = 0, oy = 0, oz = 0) => {
                ensure(_count + built.cnt)
                const off = _count * 3
                // prettier-ignore
                for (let i = 0; i < built.cnt; i++) {
                        _pos[off + i * 3    ] = built.pos[i * 3    ] + ox
                        _pos[off + i * 3 + 1] = built.pos[i * 3 + 1] + oy
                        _pos[off + i * 3 + 2] = built.pos[i * 3 + 2] + oz
                        _scl[off + i * 3    ] = built.scl[i * 3    ]
                        _scl[off + i * 3 + 1] = built.scl[i * 3 + 1]
                        _scl[off + i * 3 + 2] = built.scl[i * 3 + 2]
                }
                _aid.fill(index, _count, _count + built.cnt)
                _count += built.cnt
        }
        const reset = () => {
                _count = 0
        }
        const commit = () => {
                if (!_count) return false
                overflow = _count > cap
                if (overflow) {
                        cap = Math.max(_count, cap * 2) || _count
                        pos = new Float32Array(cap * 3)
                        scl = new Float32Array(cap * 3)
                        aid = new Float32Array(cap)
                }
                pos.set(_pos.subarray(0, _count * 3))
                scl.set(_scl.subarray(0, _count * 3))
                aid.set(_aid.subarray(0, _count))
                count = _count
                reset()
                return true
        }
        return {
                merge,
                reset,
                commit,
                pos: () => pos,
                scl: () => scl,
                aid: () => aid,
                count: () => count,
                overflow: () => overflow,
        }
}
export const createScene = (cam: Camera, worker: Worker, debug?: Debug, onReady?: () => void) => {
        const mesh = createMesh()
        const store = createStore(mesh, worker, debug)
        const slots = createSlots(SLOT)
        const { vis, regions } = createVis(cam, store, debug)
        let isLoading = false
        let isFirst = true
        let isReady = false
        let pt = performance.now()
        let updated = false
        const tick = (dt: number) => {
                if (isReady) cam.tick(dt, pick)
        }
        const render = () => {
                const now = performance.now()
                if (!isLoading && (isFirst || now - pt >= 100)) {
                        isFirst = false
                        vis()
                        mesh.reset()
                        slots.begin(regions())
                        isLoading = true
                        pt = now
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
        }
        const pick = (wx = 0, wy = 0, wz = 0) => {
                const [ri, rj] = posOf(wx, wz)
                if (!scoped(ri, rj)) return 0
                const r = store.map.get(regionId(ri, rj))
                if (!r) return 0
                return r.pick(...localOf(wx, wy, wz, ri, rj))
        }
        return {
                tick,
                render,
                pick,
                map: store.map,
                updates: (fn: (u: SlotUpdate) => void) => slots.updates().forEach(fn),
                updated: () => updated,
                pos: mesh.pos,
                scl: mesh.scl,
                aid: mesh.aid,
                count: mesh.count,
                overflow: mesh.overflow,
        }
}

export type Mesh = ReturnType<typeof createMesh>
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
