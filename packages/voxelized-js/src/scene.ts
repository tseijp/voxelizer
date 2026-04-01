import { createSlots } from './slot'
import type { SlotUpdate } from './slot'
import { createStore } from './store'
import { culling, localOf, offOf, posOf, PREFETCH, SLOT, scoped, PREBUILD, regionId } from './utils'
import type { Camera } from './camera'
import type { Debug } from './debug'
import type { Region } from './region'

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
<<<<<<< HEAD
        return { vis, regions: () => regions }
}

const createMesh = () => {
        let count = 1
        let pos = [0, 0, 0] as number[]
        let scl = [1, 1, 1] as number[]
        let aid = [0] as number[]
        let _count = 0
        let _pos = [] as number[]
        let _scl = [] as number[]
        let _aid = [] as number[]
        let version = 0
        const merge = (built: { pos: ArrayLike<number>; scl: ArrayLike<number>; cnt: number }, index = 0, ox = 0, oy = 0, oz = 0) => {
                for (let i = 0; i < built.cnt; i++) {
                        _pos.push(built.pos[i * 3] + ox, built.pos[i * 3 + 1] + oy, built.pos[i * 3 + 2] + oz)
                        _scl.push(built.scl[i * 3], built.scl[i * 3 + 1], built.scl[i * 3 + 2])
                        _aid.push(index)
                }
                _count += built.cnt
        }
        const reset = () => {
                _pos.length = _scl.length = _aid.length = _count = 0
        }
        const commit = () => {
                if (!_count) return false
                ;[pos, scl, aid, count, _pos, _scl, _aid, _count] = [_pos, _scl, _aid, _count, pos, scl, aid, count]
                reset()
                version++
                return true
        }
        const getData = () => ({ pos, scl, aid, count, version })
        return { merge, reset, commit, count: () => count, getData }
}

export const createScene = (cam: Camera, worker: Worker, debug?: Debug) => {
        const mesh = createMesh()
        const store = createStore(mesh, worker, debug)
        const slots = createSlots(SLOT)
        const { vis, regions } = createVis(cam, store, debug)
        let isLoading = false
        let isFirst = true
        let pt = performance.now()
        let _v = -1
        const render = () => {
=======
        const render = (..._: any[]) => {
>>>>>>> 0e3b67fec4916a6611f18637e6c51a5bdf10f4fa
                const now = performance.now()
                if (!isLoading && (isFirst || now - pt >= 100)) {
                        isFirst = false
                        vis()
                        mesh.reset()
                        slots.begin(regions())
                        isLoading = true
                        pt = now
                }
                if (isLoading)
                        if (slots.step(6)) {
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
        return {
                render,
                pick,
                updates: (fn: (u: SlotUpdate) => void) => slots.updates().forEach(fn),
                get updated() {
                        const v = mesh.getData().version
                        if (v === _v) return false
                        _v = v
                        return true
                },
                get pos() {
                        return mesh.getData().pos
                },
                get scl() {
                        return mesh.getData().scl
                },
                get aid() {
                        return mesh.getData().aid
                },
                get count() {
                        return mesh.getData().count
                },
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
