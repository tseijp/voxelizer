import { createRegion } from './region'
import { CACHE, culling, offOf, posOf, PREFETCH, regionId, SCOPE, scoped, SLOT } from './utils'
import type { Camera } from './camera'
import type { Mesh } from './mesh'
import type { Queues } from './queue'

export const createRegions = (mesh: Mesh, cam: Camera, queues: Queues) => {
        const regions = new Map<number, Region>()
        const _ensure = (rx = 0, ry = 0) => {
                const id = regionId(rx, ry)
                const got = regions.get(id)
                if (got) return got
                const r = createRegion(mesh, rx, ry, queues)
                regions.set(r.id, r)
                return r
        }
        const _coord = () => {
                const [si, sj] = posOf(cam.pos[0], cam.pos[2])
                const list = [{ i: si, j: sj, d: -1, region: _ensure(si, sj) }]
                const prefetch = new Set<Region>()
                const _tick = (i = 0, j = 0) => {
                        if (i === 0 && j === 0) return
                        i -= PREFETCH
                        j -= PREFETCH
                        const d = Math.hypot(i, j)
                        i += si
                        j += sj
                        const [x, y, z] = offOf(i, j)
                        if (!culling(cam.MVP, x, y, z) && d > SLOT) return
                        if (!scoped(i, j)) return
                        const region = _ensure(i, j)
                        if (d <= SLOT) if (mesh.isReady()) prefetch.add(region)
                        if (!culling(cam.MVP, x, y, z)) return
                        list.push({ i, j, d, region })
                }
                for (let i = 0; i < PREFETCH * 2; i++) for (let j = 0; j < PREFETCH * 2; j++) _tick(i, j)
                list.sort((a, b) => a.d - b.d)
                const keep = list.filter((e) => scoped(e.i, e.j)).slice(0, SLOT)
                keep.forEach((e) => prefetch.delete(e.region))
                return { keep, prefetch }
        }
        const _prune = (active: Set<Region>, origin: { i: number; j: number }) => {
                if (regions.size <= CACHE) return
                const inactive = Array.from(regions.values()).filter((r) => !active.has(r))
                inactive.sort((a, b) => {
                        const da = Math.hypot(a.i - origin.i, a.j - origin.j)
                        const db = Math.hypot(b.i - origin.i, b.j - origin.j)
                        return db - da
                })
                for (const r of inactive) {
                        if (regions.size <= CACHE) break
                        regions.delete(r.id)
                        r.dispose()
                }
        }
        const vis = () => {
                const { keep, prefetch } = _coord()
                const keepSet = new Set(keep.map((c) => c.region))
                const active = new Set<Region>(keepSet)
                keepSet.forEach((r) => r.prefetch(2))
                prefetch.forEach((r) => {
                        active.add(r)
                        if (r.fetching()) return
                        r.prefetch(0)
                })
                if (keep[0]) _prune(active, keep[0])
                return keepSet
        }
        const pick = (wx = 0, wy = 0, wz = 0) => {
                const [rxi, ryj] = posOf(wx, wz)
                if (rxi < SCOPE.x0 || rxi > SCOPE.x1) return 0
                if (ryj < SCOPE.y0 || ryj > SCOPE.y1) return 0
                const r = regions.get(regionId(rxi, ryj))
                if (!r) return 0
                const [ox, , oz] = offOf(rxi, ryj)
                return r.pick(wx - ox, wy, wz - oz)
        }
        return { vis, pick }
}

export type Region = ReturnType<typeof createRegion>
