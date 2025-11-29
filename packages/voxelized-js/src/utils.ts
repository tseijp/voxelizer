import { vec3 as V, mat4 as M } from 'gl-matrix'

export const SCOPE = { x0: 28, x1: 123, y0: 75, y1: 79 }
export const ROW = SCOPE.x1 - SCOPE.x0 + 1 // 96 region = 96×16×16 voxel [m]
export const SLOT = 16
export const CHUNK = 16
export const CACHE = 32
export const REGION = 256
export const PREFETCH = 16
export const ATLAS_URL = `https://pub-a3916cfad25545dc917e91549e7296bc.r2.dev/v1` // `http://localhost:5173/logs`
export const scoped = (i = 0, j = 0) => SCOPE.x0 <= i && i <= SCOPE.x1 && SCOPE.y0 <= j && j <= SCOPE.y1
export const offOf = (i = SCOPE.x0, j = SCOPE.y0) => ({ x: REGION * (i - SCOPE.x0), y: 0, z: REGION * (SCOPE.y1 - j) })
export const posOf = (pos = V.create()) => ({ i: SCOPE.x0 + Math.floor(pos[0] / REGION), j: SCOPE.y1 - Math.floor(pos[2] / REGION) })
export const range = (n = 0) => [...Array(n).keys()]
export const chunkId = (i = 0, j = 0, k = 0) => i + j * CHUNK + k * CHUNK * CHUNK
export const regionId = (i = 0, j = 0) => i + ROW * j
export const culling = (VP = M.create(), rx = 0, ry = 0, rz = 0) => visSphere(VP, rx + 128, ry + 128, rz + 128, Math.sqrt(256 * 256 * 3) * 0.5)
export const solid = (f: (i: number, j: number, k: number) => void, n = CHUNK) => {
        for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) f(i, j, k)
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
