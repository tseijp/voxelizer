import { ATLAS_URL, CHUNK, chunkId, createImage, offOf, regionId, SCOPE, timer } from './utils'
import { createChunk } from './chunk'
import type { Chunk } from './chunk'
import type { Mesh } from './mesh'
import type { Queues, QueueTask } from './queue'

export const createRegion = (mesh: Mesh, i = SCOPE.x0, j = SCOPE.y0, queues: Queues) => {
        let isDisposed = false
        let cursor = 0
        let pending: Promise<HTMLImageElement>
        let chunks: Map<number, Chunk>
        let queued: QueueTask
        let queue: Chunk[]
        let img: HTMLImageElement
        let ctx: CanvasRenderingContext2D
        const _ensure = () => {
                if (isDisposed || (chunks && queue)) return
                chunks = new Map<number, Chunk>()
                queue = []
                const tick = (ci = 0, cj = 0, ck = 0) => {
                        const c = createChunk(ci, cj, ck)
                        chunks!.set(c.id, c)
                        queue!.push(c)
                }

                for (let k = 0; k < CHUNK; k++) for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) tick(i, j, k)
        }
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
        const chunk = (_ctx: CanvasRenderingContext2D, i = 0, budget = 6) => {
                _ensure()
                if (!queue || isDisposed) return true
                const checker = timer(budget)
                for (; cursor < queue.length; cursor++) {
                        if (!checker()) return false
                        const c = queue[cursor]
                        c.load((ctx = _ctx))
                        mesh.merge(c, i)
                }
                return true
        }
        const get = (ci = 0, cj = 0, ck = 0) => {
                _ensure()
                return chunks?.get(chunkId(ci, cj, ck))
        }
        const dispose = () => {
                isDisposed = true
                queue?.forEach((c) => c.dispose())
                chunks?.clear()
                queue = undefined as unknown as Chunk[]
                chunks = undefined as unknown as Map<number, Chunk>
                pending = undefined as unknown as Promise<HTMLImageElement>
                queued = undefined as unknown as QueueTask
                img = undefined as unknown as HTMLImageElement
                ctx = undefined as unknown as CanvasRenderingContext2D
                cursor = 0
                return true
        }
        return { id: regionId(i, j), ...offOf(i, j), i, j, image, chunk, get, dispose, prefetch, ctx: () => ctx, cursor: () => (cursor = 0), peek: () => img, fetching: () => !!pending && !img, slot: -1 }
}
