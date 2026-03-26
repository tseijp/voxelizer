export const createMesh = () => {
        let count = 1
        let pos = [0, 0, 0] as number[]
        let scl = [1, 1, 1] as number[]
        let aid = [0] as number[]
        let _count = 0
        let _pos = [] as number[]
        let _scl = [] as number[]
        let _aid = [] as number[]
        let isReady = false
        let version = 0
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
                version++
                return true
        }
        const getData = () => ({ pos, scl, aid, count, version })
        return { merge, reset, commit, count: () => count, isReady: () => isReady, getData }
}

export type Mesh = ReturnType<typeof createMesh>
