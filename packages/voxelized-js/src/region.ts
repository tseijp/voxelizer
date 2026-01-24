import { ATLAS_URL, atlas2occ, createImage, offOf, REGION, regionId, SCOPE } from './utils'
import { buildMeshFromAtlas } from './mesh'
import type { Mesh } from './mesh'
import type { Queues, QueueTask } from './queue'

export const createRegion = (mesh: Mesh, i = SCOPE.x0, j = SCOPE.y0, queues: Queues) => {
        let isDisposed = false
        let isMeshed = false
        let pending: Promise<HTMLImageElement>
        let queued: QueueTask
        let img: HTMLImageElement
        let ctx: CanvasRenderingContext2D
        let occ: Uint8Array
        const prefetch = (priority = 0) => {
                if (isDisposed || img) return Promise.resolve(img)
                if (!pending) {
                        const { promise, task } = queues.schedule(() => createImage(`${ATLAS_URL}/17_${i}_${j}.png`), priority)
                        pending = promise.then((res) => {
                                if (isDisposed) return res
                                return (img = res)
                        })
                        queued = task
                } else queues.bump(queued, priority)
                return pending
        }
        const image = async (priority = 0) => img || (await prefetch(priority))
        const build = (_ctx: CanvasRenderingContext2D, index = 0) => {
                if (isMeshed || isDisposed) return true
                ctx = _ctx
                const data = _ctx.getImageData(0, 0, 4096, 4096).data as Uint8ClampedArray
                const built = buildMeshFromAtlas(data, 4096, 4096)
                const { x, y, z } = offOf(i, j)
                mesh.merge(built, index, x, y, z)
                isMeshed = true
                return true
        }
        const pick = (lx = 0, ly = 0, lz = 0) => {
                if (!occ) {
                        if (!ctx) return 0
                        occ = atlas2occ(ctx.getImageData(0, 0, 4096, 4096).data as Uint8ClampedArray, 4096, 4096)
                }
                if (lx < 0 || lx >= REGION || ly < 0 || ly >= REGION || lz < 0 || lz >= REGION) return 0
                const idx = Math.floor(lx) + (Math.floor(ly) + Math.floor(lz) * REGION) * REGION
                return occ[idx]
        }
        const dispose = () => {
                isDisposed = true
                isMeshed = false
                pending = undefined as unknown as Promise<HTMLImageElement>
                queued = undefined as unknown as QueueTask
                img = undefined as unknown as HTMLImageElement
                ctx = undefined as unknown as CanvasRenderingContext2D
                occ = undefined as unknown as Uint8Array
                return true
        }
        return { id: regionId(i, j), ...offOf(i, j), i, j, image, build, pick, dispose, prefetch, ctx: () => ctx, peek: () => img, fetching: () => !!pending && !img, slot: -1 }
}
