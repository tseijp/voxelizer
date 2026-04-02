import { range, timer } from './utils'
import type { Region } from './region'

export type SlotUpdate = { at: number; atlas: ImageBitmap; offset: [number, number, number] }

const createSlot = (index = 0) => {
        let region: Region
        let isReady = false
        let pending: ImageBitmap | undefined
        let _update: SlotUpdate | undefined
        const _reset = () => {
                pending = undefined
                isReady = false
                _update = undefined
        }
        const upload = (budget = 6): boolean => {
                if (!pending) return false
                const checker = timer(budget)
                if (!region) return false
                if (!checker()) return false
                _update = { at: index, atlas: pending, offset: [region.x, region.y, region.z] }
                pending = undefined
                return (isReady = true)
        }
        const ready = (budget = 6) => {
                if (!region) return true
                if (region.isError()) return true
                if (isReady) return true
                const img = pending || region.bitmap()
                if (!img) {
                        region.prefetch('full', 2)
                        return false
                }
                pending = img
                return upload(budget)
        }
        const consumeUpdate = () => {
                const u = _update
                _update = undefined
                return u
        }
        const release = () => {
                if (!region) return
                region.slot = -1
                region = undefined as unknown as Region
                _reset()
        }
        const set = (r: Region, idx = 0) => {
                region = r
                region.slot = idx
                _reset()
        }
        return { ready, release, set, isReady: () => isReady, region: () => region, consumeUpdate }
}

export const createSlots = (size = 16) => {
        const owner = range(size).map(createSlot)
        let pending = [] as Region[]
        let keep = new Set<Region>()
        const _assign = (r: Region, budget = 6) => {
                let index = r.slot
                if (index < 0) {
                        index = owner.findIndex((slot) => !slot.region())
                        if (index < 0) return false
                        owner[index].set(r, index)
                }
                const slot = owner[index]
                if (slot.region() !== r) return false
                if (!slot.ready(budget)) return false
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
        const step = (budget = 6) => {
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
                        if (_assign(r, dt)) continue
                        hasPending = true
                }
                return !hasPending
        }
        return { begin, step, updates: (): SlotUpdate[] => owner.map((s) => s.consumeUpdate()).filter((u): u is SlotUpdate => u !== undefined) }
}
