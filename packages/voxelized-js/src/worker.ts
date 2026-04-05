import { loadBitmap, atlas2occ, loadContext } from './utils'

type GreedyMesh = (occ: Uint8Array, size: number) => { pos: Float32Array; scl: Float32Array; cnt: number }

const controllers = new Map<number, AbortController>()

const post = (data: WorkerResponse, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(data, transfer ?? [])

const errorMessage = (err: unknown) => {
        if (typeof err !== 'object') return 'worker'
        if (!err) return 'worker'
        if (!('message' in err)) return 'worker'
        return (err as Error).message
}

export const createWorkerHandler = (greedyMesh: GreedyMesh) => {
        let atlasUrl = 'https://r2.glre.dev/atlas/v1'
        let atlasExt = 'webp'
        const decodeAtlas = (bitmap: ImageBitmap, signal?: AbortSignal) => {
                if (signal?.aborted) return { occ: undefined as unknown as Uint8Array, mesh: undefined as unknown as any }
                const ctx = loadContext(bitmap)
                if (signal?.aborted) return { occ: undefined as unknown as Uint8Array, mesh: undefined as unknown as any }
                const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
                if (signal?.aborted) return { occ: undefined as unknown as Uint8Array, mesh: undefined as unknown as any }
                const occ = atlas2occ(data, bitmap.width, bitmap.height)
                if (signal?.aborted) return { occ: undefined as unknown as Uint8Array, mesh: undefined as unknown as any }
                const mesh = greedyMesh(occ, 256)
                return { occ, mesh }
        }
        return (e: MessageEvent<WorkerMessage>) => {
                const data = e.data
                if ('config' in data) {
                        const c = data.config as { atlasUrl?: string; atlasExt?: string }
                        if (c.atlasUrl) atlasUrl = c.atlasUrl
                        if (c.atlasExt) atlasExt = c.atlasExt
                        return
                }
                if ('abort' in data) {
                        const c = controllers.get(data.id)
                        if (c) c.abort()
                        controllers.delete(data.id)
                        return
                }
                const { id, i, j, mode } = data
                const ctrl = new AbortController()
                controllers.set(id, ctrl)
                const done = () => controllers.delete(id)
                const task = async () => {
                        const bitmap = await loadBitmap(`${atlasUrl}/17_${i}_${j}.${atlasExt}`, ctrl.signal)
                        if (ctrl.signal.aborted) return done()
                        if (mode === 'image') {
                                post({ id, bitmap, mode }, [bitmap])
                                return done()
                        }
                        const { occ, mesh } = decodeAtlas(bitmap, ctrl.signal)
                        if (ctrl.signal.aborted) return done()
                        post({ id, bitmap, mesh, occ, mode }, [bitmap, mesh.pos.buffer, mesh.scl.buffer, occ.buffer])
                        done()
                }
                task().catch((err) => {
                        done()
                        post({ id, mode: 'error', error: errorMessage(err) })
                })
        }
}

export type WorkerMode = 'none' | 'image' | 'full' | 'error'

export type WorkerMessage = { id: number; i: number; j: number; mode: 'image' | 'full' } | { id: number; abort: true } | { config: { atlasUrl?: string; atlasExt?: string } }

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
