export const createMesh = () => {
        let count = 1
        let cap = 1
        let pos = new Float32Array([0, 0, 0])
        let scl = new Float32Array([1, 1, 1])
        let aid = new Float32Array([0])
        let _count = 0
        let _cap = 0
        let _pos = new Float32Array(0)
        let _scl = new Float32Array(0)
        let _aid = new Float32Array(0)
        let overflow = false
        const ensure = (n: number) => {
                if (n <= _cap) return
                const c = Math.max(n, _cap * 2) || n
                const p = new Float32Array(c * 3)
                const s = new Float32Array(c * 3)
                const a = new Float32Array(c)
                if (_count) {
                        p.set(_pos.subarray(0, _count * 3))
                        s.set(_scl.subarray(0, _count * 3))
                        a.set(_aid.subarray(0, _count))
                }
                _pos = p
                _scl = s
                _aid = a
                _cap = c
        }
        // prettier-ignore
        const merge = (built: { pos: ArrayLike<number>; scl: ArrayLike<number>; cnt: number }, index = 0, ox = 0, oy = 0, oz = 0) => {
                ensure(_count + built.cnt)
                const off = _count * 3
                for (let i = 0; i < built.cnt; i++) {
                        _pos[off + i * 3    ] = built.pos[i * 3    ] + ox
                        _pos[off + i * 3 + 1] = built.pos[i * 3 + 1] + oy
                        _pos[off + i * 3 + 2] = built.pos[i * 3 + 2] + oz
                        _scl[off + i * 3    ] = built.scl[i * 3    ]
                        _scl[off + i * 3 + 1] = built.scl[i * 3 + 1]
                        _scl[off + i * 3 + 2] = built.scl[i * 3 + 2]
                }
                _aid.fill(index, _count, _count + built.cnt)
                _count += built.cnt
        }
        const reset = () => {
                _count = 0
        }
        const commit = () => {
                if (!_count) return false
                overflow = _count > cap
                if (overflow) {
                        cap = Math.max(_count, cap * 2) || _count
                        pos = new Float32Array(cap * 3)
                        scl = new Float32Array(cap * 3)
                        aid = new Float32Array(cap)
                }
                pos.set(_pos.subarray(0, _count * 3))
                scl.set(_scl.subarray(0, _count * 3))
                aid.set(_aid.subarray(0, _count))
                count = _count
                reset()
                return true
        }
        return {
                merge,
                reset,
                commit,
                pos: () => pos,
                scl: () => scl,
                aid: () => aid,
                count: () => count,
                overflow: () => overflow,
        }
}

export type Mesh = ReturnType<typeof createMesh>
