import type { Chunk } from './chunk'

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
        const merge = (c: Chunk, index = 0) => {
                _count += c.count()
                _pos.push(...c.pos)
                _scl.push(...c.scl)
                for (let i = 0; i < c.count(); i++) _aid.push(index)
        }
        const draw = (c: WebGL2RenderingContext, pg: WebGLProgram) => {
                if (!count) {
                        pos.push(0, 0, 0)
                        scl.push(1, 1, 1)
                        aid.push(0)
                        count = 1
                }
                _attr(c, pg, scl, 'scl', 3)
                _attr(c, pg, pos, 'pos', 3)
                _attr(c, pg, aid, 'aid', 1)
                return count
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
