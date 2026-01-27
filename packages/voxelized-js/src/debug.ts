export type CellState = 'visible' | 'prebuild' | 'prefetch' | 'idle'
export type CellCache = 'empty' | 'loading' | 'cached' | 'purged'

export type DebugCell = {
        i: number
        j: number
        state: CellState
        cache: CellCache
        prefetchMs?: number
        prebuildMs?: number
}

export type DebugEvent = {
        ts: number
        anchor: [number, number]
        cells: DebugCell[]
}

type CellData = {
        state: CellState
        cache: CellCache
        startImage?: number
        startFull?: number
        prefetchMs?: number
        prebuildMs?: number
}

const listeners = new Set<(event: DebugEvent) => void>()
const cells = new Map<string, CellData>()
let anchor: [number, number] = [0, 0]
let dirty = false

export const onDebug = (handler: (event: DebugEvent) => void) => {
        listeners.add(handler)
        return () => void listeners.delete(handler)
}

export const debugEnabled = () => listeners.size > 0

const key = (i: number, j: number) => `${i}:${j}`

const ensure = (i: number, j: number): CellData => {
        const k = key(i, j)
        const hit = cells.get(k)
        if (hit) return hit
        const data: CellData = { state: 'idle', cache: 'empty' }
        cells.set(k, data)
        return data
}

export const debugSetAnchor = (i: number, j: number) => {
        anchor = [i, j]
        dirty = true
}

export const debugSetState = (i: number, j: number, state: CellState) => {
        const data = ensure(i, j)
        if (data.state === state) return
        data.state = state
        dirty = true
}

export const debugSetCache = (i: number, j: number, cache: CellCache) => {
        const data = ensure(i, j)
        if (data.cache === cache) return
        data.cache = cache
        dirty = true
}

export const debugTaskStart = (i: number, j: number, mode: 'image' | 'full') => {
        const data = ensure(i, j)
        if (mode === 'image') data.startImage = performance.now()
        if (mode === 'full') data.startFull = performance.now()
        dirty = true
}

export const debugTaskDone = (i: number, j: number, mode: 'image' | 'full') => {
        const data = ensure(i, j)
        const now = performance.now()
        if (mode === 'image' && data.startImage) {
                data.prefetchMs = now - data.startImage
                data.startImage = undefined
        }
        if (mode === 'full' && data.startFull) {
                data.prebuildMs = now - data.startFull
                data.startFull = undefined
        }
        dirty = true
}

export const debugTaskAbort = (i: number, j: number) => {
        const data = ensure(i, j)
        data.startImage = undefined
        data.startFull = undefined
        dirty = true
}

export const debugPrune = (active: Set<string>) => {
        cells.forEach((data, k) => {
                if (active.has(k)) return
                data.state = 'idle'
        })
        dirty = true
}

export const debugFlush = () => {
        if (!dirty) return
        if (listeners.size === 0) return
        dirty = false
        const list: DebugCell[] = []
        cells.forEach((data, k) => {
                const [i, j] = k.split(':').map(Number)
                list.push({
                        i,
                        j,
                        state: data.state,
                        cache: data.cache,
                        prefetchMs: data.prefetchMs,
                        prebuildMs: data.prebuildMs,
                })
        })
        const event: DebugEvent = { ts: performance.now(), anchor, cells: list }
        listeners.forEach((fn) => fn(event))
}
