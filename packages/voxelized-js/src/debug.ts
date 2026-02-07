export type CellState = 'visible' | 'prebuild' | 'prefetch' | 'idle' | 'error'
export type CellCache = 'empty' | 'fetching' | 'building' | 'cached' | 'purged'

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

export type Debug = ReturnType<typeof createDebug>

export const createDebug = () => {
        const listeners = new Set<(event: DebugEvent) => void>()
        const cells = new Map<string, CellData>()
        let anchor: [number, number] = [0, 0]
        let dirty = false
        let timeout: NodeJS.Timeout
        const key = (i: number, j: number) => `${i}:${j}`
        const ensure = (i: number, j: number): CellData => {
                const k = key(i, j)
                const hit = cells.get(k)
                if (hit) return hit
                const data: CellData = { state: 'idle', cache: 'empty' }
                cells.set(k, data)
                return data
        }
        const _enabled = () => listeners.size > 0
        const _flush = () => {
                const tick = () => {
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
                if (timeout) clearTimeout(timeout)
                timeout = setTimeout(tick, 0.1)
        }
        const onDebug = (handler: (event: DebugEvent) => void) => {
                listeners.add(handler)
                return () => void listeners.delete(handler)
        }
        const setAnchor = (i: number, j: number) => {
                if (!_enabled()) return
                anchor = [i, j]
                dirty = true
                _flush()
        }
        const setState = (i: number, j: number, state: CellState) => {
                if (!_enabled()) return
                const data = ensure(i, j)
                if (data.state === state) return
                data.state = state
                dirty = true
        }
        const setCache = (i: number, j: number, cache: CellCache) => {
                if (!_enabled()) return
                const data = ensure(i, j)
                if (data.cache === cache) return
                data.cache = cache
                dirty = true
                if (cache !== 'fetching' && cache !== 'building') _flush()
        }
        const taskStart = (i: number, j: number, mode: 'image' | 'full') => {
                if (!_enabled()) return
                const data = ensure(i, j)
                if (mode === 'image') data.startImage = performance.now()
                if (mode === 'full') data.startFull = performance.now()
                dirty = true
                _flush()
        }
        const taskDone = (i: number, j: number, mode: 'image' | 'full') => {
                if (!_enabled()) return
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
                _flush()
        }
        const taskAbort = (i: number, j: number) => {
                if (!_enabled()) return
                const data = ensure(i, j)
                data.startImage = undefined
                data.startFull = undefined
                dirty = true
                _flush()
        }
        const prune = (active: Set<string>) => {
                if (!_enabled()) return
                cells.forEach((data, k) => {
                        if (active.has(k)) return
                        data.state = 'idle'
                })
                dirty = true
                _flush()
        }
        return { onDebug, setAnchor, setState, setCache, taskStart, taskDone, taskAbort, prune }
}
