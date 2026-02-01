import { createGL } from 'glre/src'
import { box } from 'glre/src/buffers'
import { attribute, float, Fn, If, instance, int, ivec2, ivec3, mat4, Scope, texelFetch, texture2D, uniform, varying, vec3, vec4 } from 'glre/src/node'
import { createCamera, createMesh, createScene } from 'voxelized-js'
import VoxelWorker from 'voxelized-js/worker?worker'
import type { Float, Int, IVec2, IVec3, Vec3 } from 'glre/src/node'
import type { GL } from 'glre/src'

const SLOT = 16
const range = (n = 0) => [...Array(n).keys()]

const iMVP = uniform<'mat4'>(mat4(), 'iMVP')
const cube = box()
const vertex = attribute<'vec3'>(cube.attributes.vertex, 'vertex')
const normal = attribute<'vec3'>(cube.attributes.normal, 'normal')
const iAtlas = range(SLOT).map((i) => uniform(texture2D(), `iAtlas${i}`))
const iOffset = range(SLOT).map((i) => uniform(vec3(0, 0, 0), `iOffset${i}`))
const scl = instance<'vec3'>(vec3(), 'scl')
const pos = instance<'vec3'>(vec3(), 'pos')
const aid = instance<'float'>(float(), 'aid')
const vCenter = varying<'vec3'>(vec3(), 'vCenter')
const mff0000ff = int(0xff0000ff).constant()
const m0300f00f = int(0x0300f00f).constant()
const m030c30c3 = int(0x030c30c3).constant()
const m09249249 = int(0x09249249).constant()
const m5555 = int(0x55555555).constant()
const m3333 = int(0x33333333).constant()
const m0f0f = int(0x0f0f0f0f).constant()
const m00ff = int(0x00ff00ff).constant()
const mffff = int(0x0000ffff).constant()
const xyz2m = Fn(([xyz]: [IVec3]): Int => {
        const p = xyz.toVar()
        p.bitOrAssign(p.shiftLeft(int(16)))
        p.bitAndAssign(ivec3(mff0000ff))
        p.bitOrAssign(p.shiftLeft(int(8)))
        p.bitAndAssign(ivec3(m0300f00f))
        p.bitOrAssign(p.shiftLeft(int(4)))
        p.bitAndAssign(ivec3(m030c30c3))
        p.bitOrAssign(p.shiftLeft(int(2)))
        p.bitAndAssign(ivec3(m09249249))
        return p.x.bitOr(p.y.shiftLeft(int(1))).bitOr(p.z.shiftLeft(int(2)))
})
const m2uv = Fn(([morton]: [Int]): IVec2 => {
        const p = ivec2(morton, morton.shiftRight(int(1))).toVar()
        p.bitAndAssign(ivec2(m5555))
        p.bitOrAssign(p.shiftRight(int(1)))
        p.bitAndAssign(ivec2(m3333))
        p.bitOrAssign(p.shiftRight(int(2)))
        p.bitAndAssign(ivec2(m0f0f))
        p.bitOrAssign(p.shiftRight(int(4)))
        p.bitAndAssign(ivec2(m00ff))
        p.bitOrAssign(p.shiftRight(int(8)))
        p.bitAndAssign(ivec2(mffff))
        return p
})
const atlas = Fn(([p]: [IVec3]): IVec2 => {
        const morton = xyz2m(p.clamp(int(0), int(255))).toVar()
        return m2uv(morton)
})
const pick = Fn(([id, uvPix]: [Float, IVec2]) => {
        const t = vec4(0, 0, 0, 1).toVar('t')
        range(SLOT).map((i) => {
                If(id.equal(i), () => {
                        t.assign(texelFetch(iAtlas[i], uvPix, int(0)))
                })
        })
        return t
})
const diffuse = Fn(([n]: [Vec3]) => {
        return vec3(-0.33, 0.77, 0.55).normalize().dot(n).mul(0.5).add(0.5)
})
const vert = Scope(() => {
        const off = vec3(0, 0, 0).toVar('off')
        range(SLOT).forEach((i) => {
                If(aid.equal(i), () => {
                        off.assign(iOffset[i])
                })
        })
        const local = vertex.mul(scl).add(pos)
        const world = off.add(local)
        const center = local.sub(normal.sign().mul(0.5)).floor()
        vCenter.assign(center)
        return iMVP.mul(vec4(world, 1))
})
const frag = Scope(() => {
        const p = vCenter.toIVec3()
        const d = varying(diffuse(normal))
        const i = varying(aid)
        const uv = atlas(p).toVar('uv')
        const rgb = pick(i, uv).rgb.mul(d).toVar('rgb')
        return vec4(rgb, 1)
})

// @ts-ignore
const worker = new VoxelWorker()
const cam = createCamera({ X: 14720, Y: 800, Z: 1152, yaw: Math.PI / 2, pitch: -Math.PI / 2 + 0.01, mode: -1 })
const mesh = createMesh()
const scene = createScene(mesh, cam, worker)

let ts = performance.now()
let pt = ts

const gl = createGL({
        precision: 'highp',
        isWebGL: true,
        isDepth: true,
        triangleCount: 12,
        instanceCount: 1,
        vert,
        frag,
        resize() {
                cam.update(gl.size[0] / gl.size[1])
        },
        render() {
                pt = ts
                ts = performance.now()
                const dt = Math.min((ts - pt) / 1000, 0.03)
                cam.tick(dt, scene.pick)
                cam.update(gl.size[0] / gl.size[1])
                iMVP.value = [...cam.MVP]
                scene.render(gl.gl, gl.program)
                gl.instanceCount = mesh.draw(gl.gl, gl.program)
        },
}) as GL

gl.mount()
