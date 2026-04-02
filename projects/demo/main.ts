import { createGL } from '../../../../packages/core/src'
import { box } from '../../../../packages/core/src/buffers'
import { float, Fn, instance, mat4, Scope, texelFetch, texture2D, uint, uniform, uniformArray, uvec2, uvec3, varying, vec3, vec4 } from '../../../../packages/core/src/node'
import { createCamera, createScene, range } from 'voxelized-js/src'
import VoxelWorker from './worker?worker'
import type { Float, UInt, UVec2, UVec3, Vec3 } from '../../../../packages/core/src/node'

const iMVP = uniform<'mat4'>(mat4(), 'iMVP')
const cube = box()
const vertex = cube.vertex('vertex')
const normal = cube.normal('normal')
const iAtlas = uniformArray(texture2D(), 'iAtlas', 16)
const iOffset = uniformArray(vec3(), 'iOffset', 16)
const scl = instance<'vec3'>(vec3(), 'scl')
const pos = instance<'vec3'>(vec3(), 'pos')
const aid = instance<'float'>(float(), 'aid')
const vCenter = varying<'vec3'>(vec3(), 'vCenter')
const vDiffuse = varying<'float'>(float(), 'vDiffuse')
const vAid = varying<'float'>(float(), 'vAid')
const xyz2m = Fn(([xyz]: [UVec3]): UInt => {
        const p = xyz.toVar()
        p.bitOrAssign(p.shiftLeft(uvec3(uint(16))))
        p.bitAndAssign(uvec3(uint(0xff0000ff)))
        p.bitOrAssign(p.shiftLeft(uvec3(uint(8))))
        p.bitAndAssign(uvec3(uint(0x0300f00f)))
        p.bitOrAssign(p.shiftLeft(uvec3(uint(4))))
        p.bitAndAssign(uvec3(uint(0x030c30c3)))
        p.bitOrAssign(p.shiftLeft(uvec3(uint(2))))
        p.bitAndAssign(uvec3(uint(0x09249249)))
        return p.x.bitOr(p.y.shiftLeft(uint(1))).bitOr(p.z.shiftLeft(uint(2)))
})
const m2uv = Fn(([morton]: [UInt]): UVec2 => {
        const p = uvec2(morton, morton.shiftRight(uint(1))).toVar()
        p.bitAndAssign(uvec2(uint(0x55555555)))
        p.bitOrAssign(p.shiftRight(uvec2(uint(1))))
        p.bitAndAssign(uvec2(uint(0x33333333)))
        p.bitOrAssign(p.shiftRight(uvec2(uint(2))))
        p.bitAndAssign(uvec2(uint(0x0f0f0f0f)))
        p.bitOrAssign(p.shiftRight(uvec2(uint(4))))
        p.bitAndAssign(uvec2(uint(0x00ff00ff)))
        p.bitOrAssign(p.shiftRight(uvec2(uint(8))))
        p.bitAndAssign(uvec2(uint(0x0000ffff)))
        return p
})
const pick = Fn(([id, uvPix]: [Float, UVec2]) => {
        return texelFetch(iAtlas.element(id.toInt()), uvPix.toIVec2(), uint(0))
})
const diffuse = Fn(([n]: [Vec3]) => {
        return vec3(-0.33, 0.77, 0.55).normalize().dot(n).mul(0.5).add(0.5)
})
const vert = Scope(() => {
        const off = iOffset.element(aid.toInt()).xyz
        const local = vertex.mul(scl).add(pos)
        const world = off.add(local)
        const center = local.sub(normal.sign().mul(0.5)).floor()
        vCenter.assign(center)
        vDiffuse.assign(diffuse(normal))
        vAid.assign(aid)
        return iMVP.mul(vec4(world, 1))
})
const frag = Scope(() => {
        const p = vCenter.toUVec3()
        const uv = m2uv(xyz2m(p)).toVar('uv')
        const rgb = pick(vAid, uv).rgb.mul(vDiffuse).toVar('rgb')
        return vec4(rgb, 1)
})
const worker = new VoxelWorker()
const cam = createCamera({ X: 22912, Y: 800, Z: 20096, yaw: Math.PI / 2, pitch: -Math.PI / 2 + 0.01, mode: -1 })
const scene = createScene(cam, worker)

let ts = performance.now()
let pt = ts

const gl = createGL({
        precision: 'highp',
        isWebGL: false,
        // isWebGL: true,
        isDepth: true,
        triangleCount: 12,
        instanceCount: 1,
        isDebug: true,
        vert,
        frag,
        render() {
                pt = ts
                ts = performance.now()
                const dt = Math.min((ts - pt) / 1000, 0.03)
                cam.tick(dt, scene.pick)
                cam.update(gl.size[0] / gl.size[1])
                scene.render()
                scene.updates(({ at, atlas, offset }) => {
                        gl._uniform('iOffset', offset, at)
                        gl._texture('iAtlas', atlas, at)
                })
                gl._uniform?.('iMVP', [...cam.MVP])
                if (!scene.updated) return
                gl._instance('pos', scene.pos())
                gl._instance('scl', scene.scl())
                gl._instance('aid', scene.aid())
                gl.setInstanceCount(scene.count())
        },
})

// for webgpu binding layout
const empty = new OffscreenCanvas(4096, 4096)
empty.getContext('2d')

range(16).map((i) => {
        gl.uniform('iOffset', [0, 0, 0], i)
        gl.texture('iAtlas', empty, i)
})

gl.mount()
