import type { Mat, Parsed, Tex, Tri, V2, V3, V4 } from './types'

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

const eachAxis = (f: (axis: number) => void) => {
        for (let axis = 0; axis < 3; axis++) f(axis)
}

const eps = 1e-7

type Write = (x: number, y: number, z: number, rgba: V4) => void

const texCache = new WeakMap<Tex, { w: number; h: number; rgba: Uint8Array }>()

const paeth = (a: number, b: number, c: number) => {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

const decodeTex = async (t: Tex) => {
        if (texCache.has(t)) return texCache.get(t)!
        if (t.dat && t.dat.length === t.w * t.h * 4) {
                const val = { w: t.w, h: t.h, rgba: t.dat }
                texCache.set(t, val)
                return val
        }
        const rs = new globalThis.DecompressionStream('deflate')
        const raw = new Uint8Array(await new Response(new Blob([t.dat as any]).stream().pipeThrough(rs)).arrayBuffer())
        const bpp = 4
        const stride = bpp * t.w
        const out = new Uint8Array(t.w * t.h * 4)
        let ri = 0
        let oi = 0
        let prev = new Uint8Array(stride)
        for (let y = 0; y < t.h; y++) {
                const f = raw[ri++]
                let cur = new Uint8Array(stride)
                for (let x = 0; x < stride; x++) {
                        const a = x >= bpp ? cur[x - bpp] : 0
                        const b = prev[x]
                        const c = x >= bpp ? prev[x - bpp] : 0
                        let v = raw[ri++]
                        if (f === 0) cur[x] = v
                        else if (f === 1) cur[x] = (v + a) & 255
                        else if (f === 2) cur[x] = (v + b) & 255
                        else if (f === 3) cur[x] = (v + Math.floor((a + b) / 2)) & 255
                        else cur[x] = (v + paeth(a, b, c)) & 255
                }
                out.set(cur, oi)
                prev = cur
                oi += stride
        }
        const val = { w: t.w, h: t.h, rgba: out }
        texCache.set(t, val)
        return val
}

const sample = async (tex: Tex, uv: number[]): Promise<V4> => {
        const im = await decodeTex(tex)
        const u = ((uv[0] % 1) + 1) % 1
        const v = ((uv[1] % 1) + 1) % 1
        const x = Math.floor(u * im.w)
        const y = Math.floor((1 - v) * im.h)
        const i = (y * im.w + x) * 4
        return [im.rgba[i] / 255, im.rgba[i + 1] / 255, im.rgba[i + 2] / 255, im.rgba[i + 3] / 255]
}

const rayTri = (orig: V3, dir: V3, v0: V3, v1: V3, v2: V3) => {
        const e1 = sub(v1, v0)
        const e2 = sub(v2, v0)
        const h = cross(dir, e2)
        const a = dot(e1, h)
        if (a > -eps && a < eps) return
        const f = 1 / a
        const s = sub(orig, v0)
        const u = f * dot(s, h)
        if (u < 0 || u > 1) return
        const q = cross(s, e1)
        const v = f * dot(dir, q)
        if (v < 0 || u + v > 1) return
        const t = f * dot(e2, q)
        if (t <= eps) return
        return { t, u, v }
}

const bcenter = (t: { u: number; v: number }): V3 => [1 - t.u - t.v, t.u, t.v]

const baryUV = (tri: Tri, b: V3): V2 => [tri.uv0[0] * b[0] + tri.uv1[0] * b[1] + tri.uv2[0] * b[2], tri.uv0[1] * b[0] + tri.uv1[1] * b[1] + tri.uv2[1] * b[2]]

const sampler = async (m: Mat, textures: Tex[], uv: V2) => {
        if (!m) return [0, 0, 0, 1] as V4
        if (typeof m.tex === 'undefined') return [m.base[0], m.base[1], m.base[2], m.base[3]] as V4
        return await sample(textures[m.tex!], uv)
}

const unit: V3[] = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
]

const triBounds = (T: Tri) => {
        const ret = { bmin: [0, 0, 0], bmax: [0, 0, 0] }
        for (let i = 0; i < 3; i++) {
                ret.bmin[i] = Math.floor(Math.min(T.v0[i], T.v1[i], T.v2[i]))
                ret.bmax[i] = Math.ceil(Math.max(T.v0[i], T.v1[i], T.v2[i]))
        }
        return ret
}

export const rays = async (tris: Tri[], glb: Parsed, min: V3, max: V3, write: Write) => {
        type Range = [number, number]
        const { materials, textures } = glb

        const handleHit = async (T: Tri, hit: any, p: V3) => {
                const b = bcenter(hit)
                const uv = baryUV(T, b)
                const m = materials[T.mat]
                const rgba = await sampler(m, textures, uv)
                write(p[0], p[1], p[2], rgba)
        }

        const sweepAxis = async (T: Tri, axis: 0 | 1 | 2, ranges: Range[]) => {
                const dir = unit[axis]
                const others = [0, 1, 2].filter((a) => a !== axis) as (0 | 1 | 2)[]
                const o: V3 = [0, 0, 0]
                for (let a = ranges[others[0]][0]; a <= ranges[others[0]][1]; a++) {
                        for (let b = ranges[others[1]][0]; b <= ranges[others[1]][1]; b++) {
                                o[axis] = min[axis] - 1
                                o[others[0]] = a
                                o[others[1]] = b
                                const hit = rayTri(o, dir, T.v0, T.v1, T.v2)
                                if (!hit) continue
                                const p: V3 = [o[0], o[1], o[2]]
                                p[axis] = Math.round(min[axis] - 1 + hit.t)
                                await handleHit(T, hit, p)
                        }
                }
        }

        for (let ti = 0; ti < tris.length; ti++) {
                const T = tris[ti]
                const { bmin, bmax } = triBounds(T)
                const ranges = [] as Range[]
                eachAxis((i) => {
                        ranges[i] = [Math.max(bmin[i], min[i] - 1), Math.min(bmax[i], max[i] + 1)]
                })
                await sweepAxis(T, 0, ranges)
                await sweepAxis(T, 1, ranges)
                await sweepAxis(T, 2, ranges)
        }
}
