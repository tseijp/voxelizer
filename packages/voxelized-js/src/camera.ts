import { M, REGION, ROW, V } from './utils'

const _up = V.fromValues(0, 1, 0)
const _fwd = V.fromValues(0, 0, -1)
const _t0 = V.create()
const _t1 = V.create()
const _t2 = M.create()
const _t3 = M.create()
const clampToFace = (pos = 0, half = 0.5, sign = 0, base = Math.floor(pos)) => (sign > 0 ? Math.min(pos, base + 1 - half) : Math.max(pos, base + half))
const lookAt = (eye = V.create(), pos = V.create(), face = V.create()) => {
        V.scaleAndAdd(eye, pos, face, 10)
}
const faceDir = (out = V.create(), yaw = 0, pitch = 0) => {
        M.identity(_t2)
        M.rotateY(_t2, _t2, yaw)
        M.rotateX(_t2, _t2, pitch)
        V.transformMat4(out, _fwd, _t2)
        return out
}

const moveDir = (out = V.create(), dir = V.create(), speed = 1, planar = false) => {
        V.copy(_t1, out)
        _t1[1] = 0
        if (V.squaredLength(_t1) < 1e-8) {
                _t1[0] = _t1[1] = 0
                _t1[2] = -1
        }
        V.normalize(_t1, _t1)
        V.cross(_t0, _up, _t1)
        V.normalize(_t0, _t0)
        const fwd = planar ? _t1 : out
        V.scale(_t0, _t0, dir[0])
        V.scale(_t1, fwd, dir[2])
        V.add(out, _t0, _t1)
        V.scale(out, out, speed)
        return out
}

const perspective = (MVP = M.create(), pos = V.create(), eye = V.create(), aspect = 1, offsetY = 0) => {
        M.perspective(_t2, (28 * Math.PI) / 180, aspect, 0.1, 4000)
        V.copy(_t0, pos)
        V.copy(_t1, eye)
        _t0[1] += offsetY
        _t1[1] += offsetY
        M.lookAt(_t3, _t0, _t1, _up)
        M.multiply(MVP, _t2, _t3)
}

const turnRate = (mode = 0) => {
        if (mode === -1) return 0
        if (mode === 0) return 1.5
        if (mode === 1) return 1
        return 0
}

export const createCamera = ({ yaw = Math.PI * 0.5, pitch = -Math.PI * 0.45, mode = -1, X = 0, Y = 0, Z = 0, DASH = 3, MOVE = 12, JUMP = 12, GROUND = 0, SIZE = [0.8, 1.8, 0.8], GRAVITY = -50, TURN = 1 / 250 }) => {
        let dash = 1
        let scroll = 0
        let isGround = false
        const MVP = M.create()
        const pos = V.fromValues(X, Y, Z)
        const eye = V.fromValues(X - 10, Y, Z)
        const vel = V.fromValues(0, 0, 0)
        const dir = V.fromValues(0, 0, 0)
        const face = V.fromValues(-1, 0, 0)
        const asdw = (axis = 0, delta = 0) => {
                if (axis === 0) return void (dir[1] = delta)
                if (axis === 1) return void (dir[2] = delta)
                if (axis === 2) return void (dir[0] = delta)
        }
        const shift = (isPress = true) => {
                if (mode === 0) return asdw(0, isPress ? -1 : 0)
                if (mode === 1) return void (dash = isPress ? DASH : 1)
        }
        const space = (isPress = true) => {
                if (mode === 0) return asdw(0, isPress ? 1 : 0)
                if (mode === 1 && isGround && isPress) return void (vel[1] = JUMP)
        }
        const turn = (delta = [0, 0]) => {
                const r = turnRate(mode)
                yaw += delta[0] * r * TURN
                pitch += delta[1] * r * TURN
                pitch = Math.min(pitch, Math.PI / 2 - 0.01)
                pitch = Math.max(pitch, -Math.PI / 2 + 0.01)
                faceDir(face, yaw, pitch)
                lookAt(eye, pos, face)
        }
        const collide = (axis = 0, pick = (_x = 0, _y = 0, _z = 0) => 0) => {
                const v = vel[axis]
                if (!v) return
                const s = Math.sign(v)
                const xyz = V.clone(pos)
                xyz[axis] += s
                if (!pick(...V.floor(xyz, xyz))) return
                if (axis === 1 && s < 0) isGround = true
                pos[axis] = clampToFace(pos[axis], SIZE[axis] * 0.5, s)
                vel[axis] = 0
        }
        const tick = (dt = 0, pick = (_x = 0, _y = 0, _z = 0) => 0) => {
                if (mode === 2) return
                if (mode === -1) {
                        scroll -= dt * MOVE
                        pos[0] = X + scroll
                        if (pos[0] < 0) pos[0] = ROW * REGION
                        if (pos[0] > ROW * REGION) pos[0] = 0
                        lookAt(eye, pos, face)
                }
                const speed = MOVE * dash * (mode === 0 ? 20 : 1)
                const move = moveDir(V.clone(face), dir, speed, mode === 1)
                vel[0] = move[0]
                vel[2] = move[2]
                if (mode === 0) {
                        pos[0] += vel[0] * dt
                        pos[1] += dir[1] * dt * speed
                        pos[2] += vel[2] * dt
                }
                if (mode === 1) {
                        vel[1] += GRAVITY * dt
                        const vmax = Math.max(Math.abs(vel[0]), Math.abs(vel[1]), Math.abs(vel[2]))
                        let steps = Math.ceil((vmax * dt) / 0.25) // 0.25 step size
                        if (steps < 1) steps = 1
                        const sdt = dt / steps
                        isGround = false // update isGround in collide()
                        for (let i = 0; i < steps; i++) {
                                pos[1] += vel[1] * sdt
                                collide(1, pick)
                                pos[0] += vel[0] * sdt
                                collide(0, pick)
                                pos[2] += vel[2] * sdt
                                collide(2, pick)
                        }
                        if (pos[1] < GROUND) void ((pos[1] = Y / 4), (vel[1] = 0))
                }
                lookAt(eye, pos, face)
        }
        faceDir(face, yaw, pitch)
        lookAt(eye, pos, face)
        return { pos, MVP, tick, turn, shift, space, asdw, mode: (x = 0) => (mode = x), update: (aspect = 1) => perspective(MVP, pos, eye, aspect, SIZE[1] * 0.5) }
}

export type Camera = ReturnType<typeof createCamera>
