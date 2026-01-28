import { range, timer } from './utils'
import type { Region } from './region'

const createSlot = (index = 0) => {
        let tex: WebGLTexture
        let atlas: WebGLUniformLocation | null
        let offset: WebGLUniformLocation | null
        let region: Region
        let isReady = false
        let pending: ImageBitmap | undefined
        const _reset = () => {
                pending = undefined
                isReady = false
        }
        const assign = (c: WebGL2RenderingContext, pg: WebGLProgram, img: ImageBitmap) => {
                if (!atlas) atlas = c.getUniformLocation(pg, `iAtlas${index}`)
                if (!offset) offset = c.getUniformLocation(pg, `iOffset${index}`)
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
                c.texImage2D(c.TEXTURE_2D, 0, c.RGBA, c.RGBA, c.UNSIGNED_BYTE, img)
                c.uniform1i(atlas, index)
                c.uniform3fv(offset, new Float32Array([region.x, region.y, region.z]))
                isReady = true
                return true
        }
        const upload = (c: WebGL2RenderingContext, pg: WebGLProgram, budget = 6) => {
                if (!pending) return false
                const checker = timer(budget)
                const ok = assign(c, pg, pending)
                pending = undefined
                if (!ok || !checker()) return false
                return true
        }
        const ready = (c: WebGL2RenderingContext, pg: WebGLProgram, budget = 6) => {
                if (!region) return true
                if (isReady) return true
                const img = pending || region.bitmap()
                if (!img) {
                        region.prefetch('full', 2)
                        return false
                }
                pending = img
                return upload(c, pg, budget)
        }
        const release = () => {
                if (!region) return
                region.slot = -1
                region = undefined as unknown as Region
                _reset()
        }
        const set = (r: Region, index = 0) => {
                region = r
                region.slot = index
                _reset()
        }
        return { ready, release, set, isReady: () => isReady, region: () => region }
}

export const createSlots = (size = 16) => {
        const owner = range(size).map(createSlot)
        let pending = [] as Region[]
        let keep = new Set<Region>()
        const _assign = (c: WebGL2RenderingContext, pg: WebGLProgram, r: Region, budget = 6) => {
                let index = r.slot
                if (index < 0) {
                        index = owner.findIndex((slot) => !slot.region())
                        if (index < 0) return false
                        owner[index].set(r, index)
                }
                const slot = owner[index]
                if (slot.region() !== r) return false
                if (!slot.ready(c, pg, budget)) return false
                return r.build(index)
        }
        const _release = (keep: Set<Region>) => {
                owner.forEach((slot) => {
                        if (keep.has(slot.region())) return
                        slot.release()
                })
        }
        const begin = (next: Set<Region>) => {
                _release((keep = next))
                pending = Array.from(keep)
                pending.forEach((r) => r.reset())
        }
        const step = (c: WebGL2RenderingContext, pg: WebGLProgram, budget = 6) => {
                const start = performance.now()
                const inBudget = timer(budget)
                let hasPending = false
                for (let idx = 0; idx < pending.length; idx++) {
                        if (!inBudget()) return false
                        const r = pending[idx]
                        if (r.fetching()) {
                                hasPending = true
                                continue
                        }
                        const dt = Math.max(0, budget - (performance.now() - start))
                        if (_assign(c, pg, r, dt)) continue
                        hasPending = true
                }
                return !hasPending
        }
        return { begin, step }
}
