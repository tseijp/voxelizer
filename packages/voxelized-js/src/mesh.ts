export const createMesh = () => {
        let count = 1
        let pos = [0, 0, 0]
        let scl = [1, 1, 1]
        let aid = [0]
        let _count = 0
        let _pos = [] as number[]
        let _scl = [] as number[]
        let _aid = [] as number[]
        let isReady = false
        const _buf = {} as Record<string, WebGLBuffer>
        const _attr = (c: WebGL2RenderingContext, pg: WebGLProgram, data: number[], key = 'pos', size = 3) => {
                const loc = c.getAttribLocation(pg, key)
                if (loc < 0) return
                const array = new Float32Array(data)
                const buffer = (_buf[key] = _buf[key] || c.createBuffer())
                c.bindBuffer(c.ARRAY_BUFFER, buffer)
                if (!_buf[key + ':init']) {
                        c.bufferData(c.ARRAY_BUFFER, array, c.DYNAMIC_DRAW)
                        c.enableVertexAttribArray(loc)
                        c.vertexAttribPointer(loc, size, c.FLOAT, false, 0, 0)
                        c.vertexAttribDivisor(loc, 1)
                        _buf[key + ':init'] = 1
                        _buf[key + ':len'] = array.length
                        return
                }
                if (_buf[key + ':len'] !== array.length) {
                        c.bufferData(c.ARRAY_BUFFER, array, c.DYNAMIC_DRAW)
                        _buf[key + ':len'] = array.length
                        return
                }
                c.bufferSubData(c.ARRAY_BUFFER, 0, array)
        }
        const draw = (c: WebGL2RenderingContext, pg: WebGLProgram, vao: WebGLVertexArrayObject) => {
                if (!count) {
                        pos.push(0, 0, 0)
                        scl.push(1, 1, 1)
                        aid.push(0)
                        count = 1
                }
                c.bindVertexArray(vao)
                _attr(c, pg, scl, 'scl', 3)
                _attr(c, pg, pos, 'pos', 3)
                _attr(c, pg, aid, 'aid', 1)
                c.bindVertexArray(null)
                return count
        }
        const merge = (built: { pos: ArrayLike<number>; scl: ArrayLike<number>; cnt: number }, index = 0, ox = 0, oy = 0, oz = 0) => {
                for (let i = 0; i < built.cnt; i++) {
                        _pos.push(built.pos[i * 3] + ox, built.pos[i * 3 + 1] + oy, built.pos[i * 3 + 2] + oz)
                        _scl.push(built.scl[i * 3], built.scl[i * 3 + 1], built.scl[i * 3 + 2])
                        _aid.push(index)
                }
                _count += built.cnt
        }
        const reset = () => {
                _pos.length = _scl.length = _aid.length = _count = 0
        }
        const commit = () => {
                if (!_count) return false
                ;[pos, _pos, scl, _scl, aid, _aid, count] = [_pos, pos, _scl, scl, _aid, aid, _count]
                reset()
                isReady = true
                return true
        }
        return { merge, draw, reset, commit, count: () => count, isReady: () => isReady }
}

export type Mesh = ReturnType<typeof createMesh>

/**
const greedyMesh = (src: Uint8Array, size = REGION, pos: number[] = [], scl: number[] = [], cnt = 0) => {
        const data = new Uint8Array(src)
        const index = (x = 0, y = 0, z = 0) => x + (y + z * size) * size
        const isHitWidth = (x = 0, y = 0, z = 0) => {
                if (x >= size) return true
                return !data[index(x, y, z)]
        }
        const isHitHeight = (x = 0, y = 0, z = 0, w = 0) => {
                if (y >= size) return true
                for (let i = 0; i < w; i++) if (isHitWidth(x + i, y, z)) return true
                return false
        }
        const isHitDepth = (x = 0, y = 0, z = 0, w = 1, h = 1) => {
                if (z >= size) return true
                for (let j = 0; j < h; j++) if (isHitHeight(x, y + j, z, w)) return true
                return false
        }
        const hitWidth = (x = 0, y = 0, z = 0, w = 1) => {
                if (isHitWidth(x + w, y, z)) return w
                return hitWidth(x, y, z, w + 1)
        }
        const hitHeight = (x = 0, y = 0, z = 0, w = 1, h = 1) => {
                if (isHitHeight(x, y + h, z, w)) return h
                return hitHeight(x, y, z, w, h + 1)
        }
        const hitDepth = (x = 0, y = 0, z = 0, w = 1, h = 1, d = 1) => {
                if (isHitDepth(x, y, z + d, w, h)) return d
                return hitDepth(x, y, z, w, h, d + 1)
        }
        const markVisited = (x = 0, y = 0, z = 0, w = 1, h = 1, d = 1) => {
                for (let k = 0; k < d; k++) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[index(x + i, y + j, z + k)] = 0
        }
        const tick = (x = 0, y = 0, z = 0) => {
                if (!data[index(x, y, z)]) return
                const w = hitWidth(x, y, z, 1)
                const h = hitHeight(x, y, z, w, 1)
                const d = hitDepth(x, y, z, w, h, 1)
                markVisited(x, y, z, w, h, d)
                pos[3 * cnt] = w * 0.5 + x
                pos[3 * cnt + 1] = h * 0.5 + y
                pos[3 * cnt + 2] = d * 0.5 + z
                scl[cnt * 3] = w
                scl[cnt * 3 + 1] = h
                scl[cnt * 3 + 2] = d
                cnt++
        }
        for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) for (let z = 0; z < size; z++) tick(x, y, z)
        return { pos, scl, cnt }
}
 */
