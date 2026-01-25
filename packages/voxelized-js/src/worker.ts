import { greedyMesh } from 'voxelized-rs'
import { atlas2occ, REGION } from './utils'

const loadImage = async (url = '') => {
        const res = await fetch(url, { mode: 'cors' })
        const blob = await res.blob()
        const bitmap = await createImageBitmap(blob)
        return bitmap
}

const decodeAtlas = (bitmap: ImageBitmap) => {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
        ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height)
        const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
        const occ = atlas2occ(data, bitmap.width, bitmap.height)
        const mesh = greedyMesh(occ, REGION) as any
        return { occ, mesh }
}

self.onmessage = (e: MessageEvent) => {
        const { id, url, mode } = e.data as { id: number; url: string; mode: 'image' | 'full' }
        const task = () => loadImage(url).then((bitmap) => {
                if (mode === 'image') {
                        const transfer = [bitmap]
                        ;(self as unknown as Worker).postMessage({ id, bitmap, mode }, transfer)
                        return
                }
                const { occ, mesh } = decodeAtlas(bitmap)
                const transfer = [bitmap, mesh.pos.buffer, mesh.scl.buffer, occ.buffer]
                ;(self as unknown as Worker).postMessage({ id, bitmap, mesh, occ, mode }, transfer)
        })
        task().catch((err: unknown) => {
                const error = typeof err === 'object' && err && 'message' in (err as any) ? (err as any).message : 'worker'
                ;(self as unknown as Worker).postMessage({ id, mode: 'error', error })
        })
}
