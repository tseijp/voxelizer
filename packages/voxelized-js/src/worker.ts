// @ts-ignore
import initWasm from 'voxelized-rs/voxelized_rs_bg.wasm?init'
import * as wasm from 'voxelized-rs/voxelized_rs_bg.js'
import { loadBitmap, ATLAS_EXT, ATLAS_URL, REGION, atlas2occ, loadContext } from './utils'
import type { WorkerMessage, WorkerResponse } from './scene'

let promise: Promise<void> | null = null

const init = () => {
        if (promise) return promise
        promise = initWasm({ './voxelized_rs_bg.js': wasm }).then((instance: any) => {
                wasm.__wbg_set_wasm(instance.exports)
        })
        return promise
}

const controllers = new Map<number, AbortController>()

const decodeAtlas = (bitmap: ImageBitmap, signal?: AbortSignal) => {
        if (signal?.aborted) return { occ: undefined as unknown as Uint8Array, mesh: undefined as unknown as any }
        const ctx = loadContext(bitmap)
        if (signal?.aborted) return { occ: undefined as unknown as Uint8Array, mesh: undefined as unknown as any }
        const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
        if (signal?.aborted) return { occ: undefined as unknown as Uint8Array, mesh: undefined as unknown as any }
        const occ = atlas2occ(data, bitmap.width, bitmap.height)
        if (signal?.aborted) return { occ: undefined as unknown as Uint8Array, mesh: undefined as unknown as any }
        const mesh = wasm.greedyMesh(occ, REGION) as any
        return { occ, mesh }
}

const post = (data: WorkerResponse, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(data, transfer ?? [])

const errorMessage = (err: unknown) => {
        if (typeof err !== 'object') return 'worker'
        if (!err) return 'worker'
        if (!('message' in err)) return 'worker'
        return (err as Error).message
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const data = e.data
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
                try {
                        await init()
                        const bitmap = await loadBitmap(`${ATLAS_URL}/17_${i}_${j}.${ATLAS_EXT}`, ctrl.signal)
                        if (ctrl.signal.aborted) return done()
                        if (mode === 'image') {
                                post({ id, bitmap, mode }, [bitmap])
                                return done()
                        }
                        const { occ, mesh } = decodeAtlas(bitmap, ctrl.signal)
                        if (ctrl.signal.aborted) return done()
                        post({ id, bitmap, mesh, occ, mode }, [bitmap, mesh.pos.buffer, mesh.scl.buffer, occ.buffer])
                        done()
                } catch (err) {
                        done()
                        post({ id, mode: 'error', error: errorMessage(err) })
                }
        }
        task()
}
