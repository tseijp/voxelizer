import { rays } from './ray'
import type { Parsed, V3 } from './types'

type Write = (path: string, data: Uint8Array) => any
type Config = { DIST: string; CHUNK: number; CHUNK_W: number; CHUNK_H: number; CHUNK_D: number }

type EachFn<Value, Key, This> = (this: This, value: Value, key: Key) => void

type EachObj<Value = any, Key = any, This = any> = {
        forEach(f: EachFn<Value, Key, This>, ctx?: This): void
}

const each = <T, K, This>(obj: EachObj<T, K, This>, f: EachFn<T, K, This>) => obj.forEach(f)
const clamp = (x = 0, a = 0, b = 1) => (x < a ? a : b < x ? b : x)

const CONFIG: Config = { DIST: '../dist/', CHUNK: 16, CHUNK_W: 16, CHUNK_H: 16, CHUNK_D: 16 }
const u8 = (n: number) => (n < 0 ? 0 : n > 255 ? 255 : n | 0)

export async function voxel(glb: Parsed, writeFile: Write, config?: Partial<Config>) {
        const c = { ...CONFIG, ...config }
        const width = glb.aabb.max[0] - glb.aabb.min[0]
        const height = glb.aabb.max[2] - glb.aabb.min[2]
        const depth = glb.aabb.max[1] - glb.aabb.min[1]
        const SIZE = [c.CHUNK * c.CHUNK_W, c.CHUNK * c.CHUNK_H, c.CHUNK * c.CHUNK_D]
        const size = Math.min((SIZE[0] - 1) / width, (SIZE[1] - 1) / depth, (SIZE[2] - 1) / height)

        const toVox = (p: number[]) => {
                const ret = []
                for (let axis = 0; axis < 3; axis++) ret[axis] = clamp(Math.round((p[axis] - glb.aabb.min[axis]) * size), 0, SIZE[axis] - 1)
                return ret as V3
        }

        const tris = glb.tris.map((tri) => {
                tri.v0 = toVox(tri.v0)
                tri.v1 = toVox(tri.v1)
                tri.v2 = toVox(tri.v2)
                return tri
        })

        const bins = new Map<string, number[]>()
        const toC = (v: number) => Math.floor(v / c.CHUNK)

        for (let i = 0; i < tris.length; i++) {
                const T = tris[i]
                const x0 = toC(Math.min(T.v0[0], T.v1[0], T.v2[0]))
                const x1 = toC(Math.max(T.v0[0], T.v1[0], T.v2[0]))
                const y0 = toC(Math.min(T.v0[1], T.v1[1], T.v2[1]))
                const y1 = toC(Math.max(T.v0[1], T.v1[1], T.v2[1]))
                const z0 = toC(Math.min(T.v0[2], T.v1[2], T.v2[2]))
                const z1 = toC(Math.max(T.v0[2], T.v1[2], T.v2[2]))
                for (let ci = x0; ci <= x1; ci++)
                        for (let cj = z0; cj <= z1; cj++)
                                for (let ck = y0; ck <= y1; ck++) {
                                        const k = ci + '.' + cj + '.' + ck
                                        ;(bins.get(k) || bins.set(k, []).get(k)!).push(i)
                                }
        }

        const img = c.CHUNK * Math.sqrt(c.CHUNK) // 64 if chunk is 16
        // const worldPix = new Uint8Array(4096 * 4096 * 4)
        for (const [key, ids] of Array.from(bins)) {
                const [ciS, cjS, ckS] = key.split('.')
                const ci = parseInt(ciS)
                const cj = parseInt(cjS)
                const ck = parseInt(ckS)
                const px0 = ci * c.CHUNK
                const py0 = ck * c.CHUNK
                const pz0 = cj * c.CHUNK
                const tri = ids.map((id) => tris[id])
                const chunkPix = new Uint8Array(img * img * 4)
                const write = (x: number, y: number, z: number, rgba: number[]) => {
                        const lx = x - px0
                        const ly = y - py0
                        const lz = z - pz0
                        if (lx < 0 || lx >= 16) return
                        if (ly < 0 || ly >= 16) return
                        if (lz < 0 || lz >= 16) return
                        const ox = (lz & 3) * 16
                        const oy = (lz >> 2) * 16
                        const u = ox + lx
                        const v = oy + ly
                        const idx = (v * 64 + u) * 4
                        each(rgba, (c, i) => {
                                chunkPix[idx + i] = u8(c * 255)
                        })
                }
                await rays(tri, glb, [px0, py0, pz0], [px0 + 15, py0 + 15, pz0 + 15], write)
                // blitChunk64ToWorld(chunkPix, ci, cj, ck, worldPix)
                // const png = await encodeImagePNG(chunkPix, img, img)
                // await writeFile(c.DIST + ci + '.' + cj + '.' + ck + '.png', png)
        }
}
