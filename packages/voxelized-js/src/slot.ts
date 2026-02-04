import { createContext, range, timer } from './utils'
import type { Region } from './regions'

const createSlot = (index = 0) => {
        const ctx = createContext() as CanvasRenderingContext2D
        let tex: WebGLTexture
        let atlas: WebGLUniformLocation
        let offset: WebGLUniformLocation
        let region: Region
        let isReady = false
        let pending: HTMLImageElement
        const reset = () => {
                pending = undefined as unknown as HTMLImageElement
                isReady = false
        }
        const assign = (c: WebGL2RenderingContext, pg: WebGLProgram, img: HTMLImageElement) => {
                ctx.clearRect(0, 0, 4096, 4096)
                ctx.drawImage(img, 0, 0, img.width, img.height)
                if (!atlas) atlas = c.getUniformLocation(pg, `iAtlas${index}`) as WebGLUniformLocation
                if (!offset) offset = c.getUniformLocation(pg, `iOffset${index}`) as WebGLUniformLocation
                if (!atlas || !offset || !region) return false
                if (!tex) {
                        tex = c.createTexture()
                        c.activeTexture(c.TEXTURE0 + index)
                        c.bindTexture(c.TEXTURE_2D, tex)
                        c.texParameteri(c.TEXTURE_2D, c.TEXTURE_MIN_FILTER, c.LINEAR)
                        c.texParameteri(c.TEXTURE_2D, c.TEXTURE_MAG_FILTER, c.LINEAR)
                        c.texParameteri(c.TEXTURE_2D, c.TEXTURE_WRAP_S, c.CLAMP_TO_EDGE)
                        c.texParameteri(c.TEXTURE_2D, c.TEXTURE_WRAP_T, c.CLAMP_TO_EDGE)
                } else {
                        c.activeTexture(c.TEXTURE0 + index)
                        c.bindTexture(c.TEXTURE_2D, tex)
                }
                c.texImage2D(c.TEXTURE_2D, 0, c.RGBA, c.RGBA, c.UNSIGNED_BYTE, img) // Do not use ctx.canvas, as some img data will be lost
                c.uniform1i(atlas, index)
                c.uniform3fv(offset, new Float32Array([region.x, region.y, region.z]))
                return (isReady = true)
        }
        const upload = (c: WebGL2RenderingContext, pg: WebGLProgram, budget = 6) => {
                if (!pending) return false
                const checker = timer(budget)
                const ok = assign(c, pg, pending)
                pending = undefined as unknown as HTMLImageElement
                if (!ok || !checker()) return false
                return true
        }
        const ready = (c: WebGL2RenderingContext, pg: WebGLProgram, budget = 6) => {
                if (!region) return true
                if (isReady) return true
                const img = pending || region.peek()
                if (!img) {
                        region.prefetch(2)
                        return false
                }
                pending = img
                return upload(c, pg, budget)
        }
        const set = (r: Region, index = 0) => {
                region = r
                region.slot = index
                reset()
        }
        const release = () => {
                if (!region) return
                region.slot = -1
                region = undefined as unknown as Region
                reset()
        }
        return { ready, release, set, ctx: () => ctx, isReady: () => isReady, region: () => region }
}

export const createSlots = (size = 16) => {
        const owner = range(size).map(createSlot)
        let pending = [] as Region[]
        let cursor = 0
        let keep = new Set<Region>()
        const _assign = (c: WebGL2RenderingContext, pg: WebGLProgram, r: Region, budget = 6) => {
                let index = r.slot
                if (index < 0) {
                        index = owner.findIndex((slot) => !slot.region())
                        if (index < 0) return false
                        const slot = owner[index]
                        slot.set(r, index)
                }
                const slot = owner[index]
                if (slot.region() !== r) return false
                if (!slot.ready(c, pg, budget)) return false
                return r.build(slot.ctx(), index)
        }
        const _release = (keep: Set<Region>) => {
                owner.forEach((slot) => {
                        if (keep.has(slot.region())) return
                        slot.release()
                })
        }
        const begin = (next: Set<Region>) => {
                _release((keep = next))
                cursor = 0
                pending = Array.from(keep)
                pending.forEach((r) => r.resetMesh())
        }
        const step = (c: WebGL2RenderingContext, pg: WebGLProgram, budget = 6) => {
                const start = performance.now()
                const inBudget = timer(budget)
                for (; cursor < pending.length; cursor++) {
                        if (!inBudget()) break
                        const dt = Math.max(0, budget - (performance.now() - start))
                        if (!_assign(c, pg, pending[cursor], dt)) return false
                }
                return cursor >= pending.length
        }
        return { begin, step }
}
