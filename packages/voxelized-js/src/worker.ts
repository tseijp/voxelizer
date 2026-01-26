import { greedyMesh } from 'voxelized-rs'
import { atlas2occ, REGION } from './utils'

const controllers = new Map<number, AbortController>()

const loadImage = async (url = '', signal?: AbortSignal) => {
        const res = await fetch(url, { mode: 'cors', signal })
        const blob = await res.blob()
        const bitmap = await createImageBitmap(blob)
        return bitmap
}

const decodeAtlas = (bitmap: ImageBitmap, signal?: AbortSignal) => {
        if (signal?.aborted) return { occ: undefined as unknown as Uint8Array, mesh: undefined as unknown as any }
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
        ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height)
        if (signal?.aborted) return { occ: undefined as unknown as Uint8Array, mesh: undefined as unknown as any }
        const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
        const occ = atlas2occ(data, bitmap.width, bitmap.height)
        if (signal?.aborted) return { occ: undefined as unknown as Uint8Array, mesh: undefined as unknown as any }
        const mesh = greedyMesh(occ, REGION) as any
        return { occ, mesh }
}

self.onmessage = (e: MessageEvent) => {
        const { id, url, mode, abort } = e.data as { id: number; url: string; mode: 'image' | 'full'; abort?: boolean }
        if (abort) {
                const c = controllers.get(id)
                if (c) c.abort()
                controllers.delete(id)
                return
        }
        const controller = new AbortController()
        controllers.set(id, controller)
        const done = () => controllers.delete(id)
        const task = () =>
                loadImage(url, controller.signal).then((bitmap) => {
                        if (controller.signal.aborted) return done()
                        if (mode === 'image') {
                                const transfer = [bitmap]
                                ;(self as unknown as Worker).postMessage({ id, bitmap, mode }, transfer)
                                return done()
                        }
                        const { occ, mesh } = decodeAtlas(bitmap, controller.signal)
                        if (controller.signal.aborted) return done()
                        const transfer = [bitmap, mesh.pos.buffer, mesh.scl.buffer, occ.buffer]
                        ;(self as unknown as Worker).postMessage({ id, bitmap, mesh, occ, mode }, transfer)
                        return done()
                })
        task().catch((err: unknown) => {
                done()
                const error = typeof err === 'object' && err && 'message' in (err as any) ? (err as any).message : 'worker'
                ;(self as unknown as Worker).postMessage({ id, mode: 'error', error })
        })
}
