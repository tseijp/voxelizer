// export const SCOPE = { x0: 28, x1: 123, y0: 75, y1: 79 }

// export const SCOPE = { x0: 116415, x1: 116415, y0: 51623, y1: 51623 }
// export const SCOPE = { x0: 116414, x1: 116416, y0: 51622, y1: 51624 }
// export const SCOPE = { x0: 116413, x1: 116417, y0: 51620, y1: 51624 }
// export const SCOPE = { x0: 116413, x1: 116417, y0: 51615, y1: 51624 }

// for y in {51619..51626}; do for x in {116358..116467}; do yarn script2 --z 17 --x $x --y $y; done; done
export const SCOPE = { x0: 116358, x1: 116467, y0: 51619, y1: 51626 }

export const ROW = SCOPE.x1 - SCOPE.x0 + 1 // 96 region = 96×16×16 voxel [m]
export const SLOT = 16
export const REGION = 256
export const TOTAL = REGION * REGION * REGION
export const PREBUILD = 4
export const PREFETCH = 4
export const PREPURGE = 32
export const ATLAS_URL = 'http://localhost:5500/logs/v4'
// export const ATLAS_URL = `https://pub-a3916cfad25545dc917e91549e7296bc.r2.dev/v3`

export const offOf = (i = SCOPE.x0, j = SCOPE.y0) => [(i - SCOPE.x0) << 8, 0, (j - SCOPE.y0) << 8]
export const local = (x: number, y: number, z: number) => (x | 0) + ((y | 0) + (z | 0) * REGION) * REGION
export const posOf = (x = 0, z = 0) => [SCOPE.x0 + (x >> 8), SCOPE.y0 + (z >> 8)]
export const range = (n = 0) => [...Array(n).keys()]
export const regionId = (i = 0, j = 0) => i + ROW * j
export const culling = (VP = M.create(), rx = 0, ry = 0, rz = 0) => visSphere(VP as number[], rx + 128, ry + 128, rz + 128, Math.sqrt(256 * 256 * 3) * 0.5)

export const localOf = (wx: number, wy: number, wz: number, ri: number, rj: number): [number, number, number] => {
        const [ox, , oz] = offOf(ri, rj)
        return [wx - ox, wy, wz - oz]
}

export const withinRange = (dx: number, dy: number, range: number) => Math.abs(dx) < range && Math.abs(dy) < range

export const inRegion = (x: number, y: number, z: number) => {
        if (x < 0) return false
        if (y < 0) return false
        if (z < 0) return false
        if (x >= REGION) return false
        if (y >= REGION) return false
        if (z >= REGION) return false
        return true
}

export const scoped = (i = 0, j = 0) => {
        // if (i === 78) if (j === 75) return false
        // if (i === 78) if (j === 74) return true
        // if (i === 78) if (j === 73) return true
        // if (i === 78) if (j === 72) return true
        if (i < SCOPE.x0) return false
        if (i > SCOPE.x1) return false
        if (j < SCOPE.y0) return false
        if (j > SCOPE.y1) return false
        return true
}

export const xyz2m = (x: number, y: number, z: number) => {
        x = x >>> 0
        y = y >>> 0
        z = z >>> 0
        x = (x | (x << 16)) & 0xff0000ff
        y = (y | (y << 16)) & 0xff0000ff
        z = (z | (z << 16)) & 0xff0000ff
        x = (x | (x << 8)) & 0x0300f00f
        y = (y | (y << 8)) & 0x0300f00f
        z = (z | (z << 8)) & 0x0300f00f
        x = (x | (x << 4)) & 0x030c30c3
        y = (y | (y << 4)) & 0x030c30c3
        z = (z | (z << 4)) & 0x030c30c3
        x = (x | (x << 2)) & 0x09249249
        y = (y | (y << 2)) & 0x09249249
        z = (z | (z << 2)) & 0x09249249
        return (x | (y << 1) | (z << 2)) >>> 0
}

export const m2xyz = (morton: number): [number, number, number] => {
        let x = morton >>> 0
        let y = (morton >>> 1) >>> 0
        let z = (morton >>> 2) >>> 0
        x = x & 0x09249249
        y = y & 0x09249249
        z = z & 0x09249249
        x = (x | (x >>> 2)) & 0x030c30c3
        y = (y | (y >>> 2)) & 0x030c30c3
        z = (z | (z >>> 2)) & 0x030c30c3
        x = (x | (x >>> 4)) & 0x0300f00f
        y = (y | (y >>> 4)) & 0x0300f00f
        z = (z | (z >>> 4)) & 0x0300f00f
        x = (x | (x >>> 8)) & 0xff0000ff
        y = (y | (y >>> 8)) & 0xff0000ff
        z = (z | (z >>> 8)) & 0xff0000ff
        x = (x | (x >>> 16)) & 0x000003ff
        y = (y | (y >>> 16)) & 0x000003ff
        z = (z | (z >>> 16)) & 0x000003ff
        return [x, y, z]
}

export const m2uv = (morton: number): [number, number] => {
        let x = morton >>> 0
        let y = (morton >>> 1) >>> 0
        x = x & 0x55555555
        y = y & 0x55555555
        x = (x | (x >>> 1)) & 0x33333333
        y = (y | (y >>> 1)) & 0x33333333
        x = (x | (x >>> 2)) & 0x0f0f0f0f
        y = (y | (y >>> 2)) & 0x0f0f0f0f
        x = (x | (x >>> 4)) & 0x00ff00ff
        y = (y | (y >>> 4)) & 0x00ff00ff
        x = (x | (x >>> 8)) & 0x0000ffff
        y = (y | (y >>> 8)) & 0x0000ffff
        return [x, y]
}

export const uv2m = (x: number, y: number) => {
        x = x >>> 0
        y = y >>> 0
        x = x & 0x0000ffff
        y = y & 0x0000ffff
        x = (x | (x << 8)) & 0x00ff00ff
        y = (y | (y << 8)) & 0x00ff00ff
        x = (x | (x << 4)) & 0x0f0f0f0f
        y = (y | (y << 4)) & 0x0f0f0f0f
        x = (x | (x << 2)) & 0x33333333
        y = (y | (y << 2)) & 0x33333333
        x = (x | (x << 1)) & 0x55555555
        y = (y | (y << 1)) & 0x55555555
        return ((y << 1) | x) >>> 0
}

export const atlas2occ = (data: Uint8ClampedArray, width: number, height: number) => {
        const occ = new Uint8Array(TOTAL)
        const pixels = width * height
        for (let i = 0; i < pixels; i++) {
                const alpha = data[i * 4 + 3]
                if (alpha === 0) continue
                const ax = i % width
                const ay = (i / width) | 0
                const id = uv2m(ax, ay)
                const [x, y, z] = m2xyz(id)
                occ[local(x, y, z)] = 1
        }
        return occ
}

export const timer = (t = 6) => {
        const start = performance.now()
        return () => performance.now() - start < Math.max(0, t)
}

export const createImage = async (src = '') => {
        const img = new Image()
        const promise = new Promise<HTMLImageElement>((resolve) => void (img.onload = () => resolve(img)))
        Object.assign(img, { src, crossOrigin: 'anonymous' })
        return await promise
}

export const createContext = () => {
        const el = document.createElement('canvas')
        Object.assign(el, { width: 4096, height: 4096 })
        return el.getContext('2d', { willReadFrequently: true })
}

export const visSphere = (m = M.create(), cx = 0, cy = 0, cz = 0, r = 1) => {
        const t = (ax = 0, ay = 0, az = 0, aw = 0) => (ax * cx + ay * cy + az * cz + aw) / (Math.hypot(ax, ay, az) || 1) + r < 0
        if (t(m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12])) return false
        if (t(m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12])) return false
        if (t(m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13])) return false
        if (t(m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13])) return false
        if (t(m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14])) return false
        if (t(m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14])) return false
        return true
}

export const V = {
        create: (): number[] => [0, 0, 0],
        fromValues: (x = 0, y = 0, z = 0): number[] => [x, y, z],
        copy: (o: number[], a: number[]) => {
                o[0] = a[0]
                o[1] = a[1]
                o[2] = a[2]
                return o
        },
        normalize: (o: number[], a: number[]) => {
                const l = Math.hypot(a[0], a[1], a[2]) || 1
                o[0] = a[0] / l
                o[1] = a[1] / l
                o[2] = a[2] / l
                return o
        },
        cross: (o: number[], a: number[], b: number[]) => {
                const x = a[1] * b[2] - a[2] * b[1]
                const y = a[2] * b[0] - a[0] * b[2]
                const z = a[0] * b[1] - a[1] * b[0]
                o[0] = x
                o[1] = y
                o[2] = z
                return o
        },
        scale: (o: number[], a: number[], s: number) => {
                o[0] = a[0] * s
                o[1] = a[1] * s
                o[2] = a[2] * s
                return o
        },
        add: (o: number[], a: number[], b: number[]) => {
                o[0] = a[0] + b[0]
                o[1] = a[1] + b[1]
                o[2] = a[2] + b[2]
                return o
        },
        scaleAndAdd: (o: number[], a: number[], b: number[], s: number) => {
                o[0] = a[0] + b[0] * s
                o[1] = a[1] + b[1] * s
                o[2] = a[2] + b[2] * s
                return o
        },
        squaredLength: (a: number[]) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2],
        clone: (a: number[]) => [a[0], a[1], a[2]],
        floor: (o: number[], a: number[]) => {
                o[0] = Math.floor(a[0])
                o[1] = Math.floor(a[1])
                o[2] = Math.floor(a[2])
                return o
        },
        transformMat4: (o: number[], a: number[], m: number[]) => {
                const x = a[0]
                const y = a[1]
                const z = a[2]
                const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1
                o[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w
                o[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w
                o[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
                return o
        },
}

export const M = {
        create: (): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        identity: (o: number[]) => {
                o[0] = 1
                o[1] = 0
                o[2] = 0
                o[3] = 0
                o[4] = 0
                o[5] = 1
                o[6] = 0
                o[7] = 0
                o[8] = 0
                o[9] = 0
                o[10] = 1
                o[11] = 0
                o[12] = 0
                o[13] = 0
                o[14] = 0
                o[15] = 1
                return o
        },
        rotateX: (out: number[], a: number[], rad: number) => {
                const s = Math.sin(rad)
                const c = Math.cos(rad)
                const a10 = a[4]
                const a11 = a[5]
                const a12 = a[6]
                const a13 = a[7]
                const a20 = a[8]
                const a21 = a[9]
                const a22 = a[10]
                const a23 = a[11]
                if (a !== out) {
                        out[0] = a[0]
                        out[1] = a[1]
                        out[2] = a[2]
                        out[3] = a[3]
                        out[12] = a[12]
                        out[13] = a[13]
                        out[14] = a[14]
                        out[15] = a[15]
                }
                out[4] = a10 * c + a20 * s
                out[5] = a11 * c + a21 * s
                out[6] = a12 * c + a22 * s
                out[7] = a13 * c + a23 * s
                out[8] = a20 * c - a10 * s
                out[9] = a21 * c - a11 * s
                out[10] = a22 * c - a12 * s
                out[11] = a23 * c - a13 * s
                return out
        },
        rotateY: (out: number[], a: number[], rad: number) => {
                const s = Math.sin(rad)
                const c = Math.cos(rad)
                const a00 = a[0]
                const a01 = a[1]
                const a02 = a[2]
                const a03 = a[3]
                const a20 = a[8]
                const a21 = a[9]
                const a22 = a[10]
                const a23 = a[11]
                if (a !== out) {
                        out[4] = a[4]
                        out[5] = a[5]
                        out[6] = a[6]
                        out[7] = a[7]
                        out[12] = a[12]
                        out[13] = a[13]
                        out[14] = a[14]
                        out[15] = a[15]
                }
                out[0] = a00 * c - a20 * s
                out[1] = a01 * c - a21 * s
                out[2] = a02 * c - a22 * s
                out[3] = a03 * c - a23 * s
                out[8] = a00 * s + a20 * c
                out[9] = a01 * s + a21 * c
                out[10] = a02 * s + a22 * c
                out[11] = a03 * s + a23 * c
                return out
        },
        perspective: (o: number[], fovy: number, aspect: number, near: number, far: number) => {
                const f = 1 / Math.tan(0.5 * fovy)
                for (let i = 0; i < 16; i++) o[i] = 0
                o[0] = f / aspect
                o[5] = f
                o[10] = (far + near) / (near - far)
                o[11] = -1
                o[14] = (2 * far * near) / (near - far)
                return o
        },
        lookAt: (o: number[], eye: number[], center: number[], up: number[]) => {
                let z0 = eye[0] - center[0]
                let z1 = eye[1] - center[1]
                let z2 = eye[2] - center[2]
                let l = Math.hypot(z0, z1, z2)
                if (!l) {
                        z2 = 1
                } else {
                        z0 /= l
                        z1 /= l
                        z2 /= l
                }
                let x0 = up[1] * z2 - up[2] * z1
                let x1 = up[2] * z0 - up[0] * z2
                let x2 = up[0] * z1 - up[1] * z0
                l = Math.hypot(x0, x1, x2)
                if (l) {
                        x0 /= l
                        x1 /= l
                        x2 /= l
                }
                const y0 = z1 * x2 - z2 * x1
                const y1 = z2 * x0 - z0 * x2
                const y2 = z0 * x1 - z1 * x0
                o[0] = x0
                o[1] = y0
                o[2] = z0
                o[3] = 0
                o[4] = x1
                o[5] = y1
                o[6] = z1
                o[7] = 0
                o[8] = x2
                o[9] = y2
                o[10] = z2
                o[11] = 0
                o[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2])
                o[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2])
                o[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2])
                o[15] = 1
                return o
        },
        multiply: (o: number[], a: number[], b: number[]) => {
                const a00 = a[0]
                const a01 = a[1]
                const a02 = a[2]
                const a03 = a[3]
                const a10 = a[4]
                const a11 = a[5]
                const a12 = a[6]
                const a13 = a[7]
                const a20 = a[8]
                const a21 = a[9]
                const a22 = a[10]
                const a23 = a[11]
                const a30 = a[12]
                const a31 = a[13]
                const a32 = a[14]
                const a33 = a[15]
                const b00 = b[0]
                const b01 = b[1]
                const b02 = b[2]
                const b03 = b[3]
                const b10 = b[4]
                const b11 = b[5]
                const b12 = b[6]
                const b13 = b[7]
                const b20 = b[8]
                const b21 = b[9]
                const b22 = b[10]
                const b23 = b[11]
                const b30 = b[12]
                const b31 = b[13]
                const b32 = b[14]
                const b33 = b[15]
                o[0] = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03
                o[1] = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03
                o[2] = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03
                o[3] = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03
                o[4] = a00 * b10 + a10 * b11 + a20 * b12 + a30 * b13
                o[5] = a01 * b10 + a11 * b11 + a21 * b12 + a31 * b13
                o[6] = a02 * b10 + a12 * b11 + a22 * b12 + a32 * b13
                o[7] = a03 * b10 + a13 * b11 + a23 * b12 + a33 * b13
                o[8] = a00 * b20 + a10 * b21 + a20 * b22 + a30 * b23
                o[9] = a01 * b20 + a11 * b21 + a21 * b22 + a31 * b23
                o[10] = a02 * b20 + a12 * b21 + a22 * b22 + a32 * b23
                o[11] = a03 * b20 + a13 * b21 + a23 * b22 + a33 * b23
                o[12] = a00 * b30 + a10 * b31 + a20 * b32 + a30 * b33
                o[13] = a01 * b30 + a11 * b31 + a21 * b32 + a31 * b33
                o[14] = a02 * b30 + a12 * b31 + a22 * b32 + a32 * b33
                o[15] = a03 * b30 + a13 * b31 + a23 * b32 + a33 * b33
                return o
        },
}
