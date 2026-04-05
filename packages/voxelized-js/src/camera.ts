import { M, V } from './utils'

const _up = V.fromValues(0, 1, 0)
const _fwd = V.fromValues(0, 0, -1)
const _t0 = V.create()
const _t1 = V.create()
const _t2 = M.create()
const _t3 = M.create()

const clampToFace = (pos = 0, half = 0.5, sign = 0, base = Math.floor(pos)) => (sign > 0 ? Math.min(pos, base + 1 - half) : Math.max(pos, base + half))

const createCollider = ({ size = [0.8, 1.8, 0.8], gravity = -50, jump = 12, ground = 0, y = 0 }) => {
        let isGround = false
        const collide = (pos: ReturnType<typeof V.create>, vel: ReturnType<typeof V.create>, axis = 0, pick = (_x = 0, _y = 0, _z = 0) => 0) => {
                const v = vel[axis]
                if (!v) return
                const s = Math.sign(v)
                const xyz = V.clone(pos)
                xyz[axis] += s
                if (!pick(...V.floor(xyz, xyz))) return
                if (axis === 1 && s < 0) isGround = true
                pos[axis] = clampToFace(pos[axis], size[axis] * 0.5, s)
                vel[axis] = 0
        }
        const tick = (dt = 0, pos: ReturnType<typeof V.create>, vel: ReturnType<typeof V.create>, pick = (_x = 0, _y = 0, _z = 0) => 0) => {
                vel[1] += gravity * dt
                const vmax = Math.max(Math.abs(vel[0]), Math.abs(vel[1]), Math.abs(vel[2]))
                let steps = Math.ceil((vmax * dt) / 0.25)
                if (steps < 1) steps = 1
                const sdt = dt / steps
                isGround = false
                for (let i = 0; i < steps; i++) {
                        pos[1] += vel[1] * sdt
                        collide(pos, vel, 1, pick)
                        pos[0] += vel[0] * sdt
                        collide(pos, vel, 0, pick)
                        pos[2] += vel[2] * sdt
                        collide(pos, vel, 2, pick)
                }
                if (pos[1] < ground) void ((pos[1] = y / 4), (vel[1] = 0))
        }
        const doJump = (vel: ReturnType<typeof V.create>) => {
                if (isGround) vel[1] = jump
        }
        return { tick, jump: doJump, isGround: () => isGround }
}

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

const perspective = (mvp = M.create(), pos = V.create(), eye = V.create(), aspect = 1, offsetY = 0) => {
        M.perspective(_t2, (28 * Math.PI) / 180, aspect, 0.1, 4000)
        V.copy(_t0, pos)
        V.copy(_t1, eye)
        _t0[1] += offsetY
        _t1[1] += offsetY
        M.lookAt(_t3, _t0, _t1, _up)
        M.multiply(mvp, _t2, _t3)
}

const turnRate = (mode = 'scroll') => {
        if (mode === 'scroll') return 0
        if (mode === 'creative') return 1.5
        if (mode === 'survive') return 1
        return 0
}

export const createCamera = ({ yaw = Math.PI * 0.5, pitch = -Math.PI * 0.45, mode = 'scroll' as string, autoScroll = false, x = 0, y = 0, z = 0, dash = 3, move = 12, jump = 12, ground = 0, size = [0.8, 1.8, 0.8], gravity = -50, sens = 1 / 250, wrap = 0 }) => {
        let dashing = 1
        let scroll = 0
        const collider = createCollider({ size, gravity, jump, ground, y })
        const mvp = M.create()
        const pos = V.fromValues(x, y, z)
        const eye = V.fromValues(x - 10, y, z)
        const vel = V.fromValues(0, 0, 0)
        const dir = V.fromValues(0, 0, 0)
        const face = V.fromValues(-1, 0, 0)
        const asdw = (axis = 0, delta = 0) => {
                if (axis === 0) return void (dir[1] = delta)
                if (axis === 1) return void (dir[2] = delta)
                if (axis === 2) return void (dir[0] = delta)
        }
        const shift = (isPress = true) => {
                if (mode === 'creative') return asdw(0, isPress ? -1 : 0)
                if (mode === 'survive') return void (dashing = isPress ? dash : 1)
        }
        const space = (isPress = true) => {
                if (mode === 'creative') return asdw(0, isPress ? 1 : 0)
                if (mode === 'survive' && isPress) return collider.jump(vel)
        }
        const turn = (delta = [0, 0]) => {
                const r = turnRate(mode)
                yaw += delta[0] * r * sens
                pitch += delta[1] * r * sens
                pitch = Math.min(pitch, Math.PI / 2 - 0.01)
                pitch = Math.max(pitch, -Math.PI / 2 + 0.01)
                faceDir(face, yaw, pitch)
                lookAt(eye, pos, face)
        }
        const reset = (y = 0, p = -Math.PI / 2 + 0.01) => {
                faceDir(face, (yaw = y), (pitch = p))
                lookAt(eye, pos, face)
        }
        const tick = (dt = 0, pick = (_x = 0, _y = 0, _z = 0) => 0) => {
                if (mode === 'scroll') {
                        if (!autoScroll) return
                        scroll -= dt * move
                        pos[0] = x + scroll
                        if (pos[0] < 0) pos[0] = wrap
                        if (pos[0] > wrap) pos[0] = 0
                        lookAt(eye, pos, face)
                        return
                }
                const speed = move * dashing * (mode === 'creative' ? 20 : 1)
                const heading = moveDir(V.clone(face), dir, speed, mode === 'survive')
                vel[0] = heading[0]
                vel[2] = heading[2]
                if (mode === 'creative') {
                        pos[0] += vel[0] * dt
                        pos[1] += dir[1] * dt * speed
                        pos[2] += vel[2] * dt
                }
                if (mode === 'survive') collider.tick(dt, pos, vel, pick)
                lookAt(eye, pos, face)
        }
        let _aspect = 16 / 9
        const update = (a = _aspect) => perspective(mvp, pos, eye, (_aspect = a), size[1] * 0.5)
        faceDir(face, yaw, pitch)
        lookAt(eye, pos, face)
        return { pos, eye, mvp, reset, tick, turn, shift, space, asdw, update, mode: (x = 'scroll') => (mode = x), yaw: () => yaw, pitch: () => pitch }
}

export type CameraConfig = Parameters<typeof createCamera>[0]
export type Camera = ReturnType<typeof createCamera>
