// import { createGL } from 'glre/src'
// import { box } from 'glre/src/buffers'
// import { float, Fn, If, instance, int, ivec2, ivec3, mat4, Scope, texelFetch, texture2D, uniform, varying, vec3, vec4 } from 'glre/src/node'
import { createGL } from '../../../../packages/core/src'
import { box } from '../../../../packages/core/src/buffers'
import { float, Fn, If, instance, mat4, Scope, texelFetch, texture2D, uint, uniform, uvec2, uvec3, varying, vec3, vec4 } from '../../../../packages/core/src/node'
import { createCamera, createMesh, createScene, range } from 'voxelized-js/src'
import VoxelWorker from './worker?worker'

// import type { Float, Int, IVec2, IVec3, Vec3 } from 'glre/src/node'
import type { Float, UInt, UVec2, UVec3, Vec3 } from '../../../../packages/core/src/node'

const iMVP = uniform<'mat4'>(mat4(), 'iMVP')
const cube = box()
const vertex = cube.vertex('vertex')
const normal = cube.normal('normal')
const iAtlas = range(16).map((i) => uniform(texture2D(), `iAtlas${i}`))
const iOffset = range(16).map((i) => uniform(vec3(0, 0, 0), `iOffset${i}`))
const scl = instance<'vec3'>(vec3(), 'scl')
const pos = instance<'vec3'>(vec3(), 'pos')
const aid = instance<'float'>(float(), 'aid')
const vCenter = varying<'vec3'>(vec3(), 'vCenter')
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
        const uv = uvPix.toIVec2().toVar()
        const t = vec4(0, 0, 0, 1).toVar('t')
        range(16).map((i) => {
                If(id.equal(i), () => {
                        t.assign(texelFetch(iAtlas[i], uv, uint(0)))
                })
        })
        return t
})
const diffuse = Fn(([n]: [Vec3]) => {
        return vec3(-0.33, 0.77, 0.55).normalize().dot(n).mul(0.5).add(0.5)
})
const vert = Scope(() => {
        const off = vec3(0, 0, 0).toVar('off')
        range(16).forEach((i) => {
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
        const p = vCenter.toUVec3()
        const d = varying(diffuse(normal))
        const i = varying(aid)
        const uv = m2uv(xyz2m(p)).toVar('uv')
        const rgb = pick(i, uv).rgb.mul(d).toVar('rgb')
        return vec4(rgb, 1)
})
const worker = new VoxelWorker()
const cam = createCamera({ X: 22912, Y: 800, Z: 20096, yaw: Math.PI / 2, pitch: -Math.PI / 2 + 0.01, mode: -1 })
const mesh = createMesh()
const scene = createScene(mesh, cam, worker)

let ts = performance.now()
let pt = ts
let lastVersion = -1

const gl = createGL({
        precision: 'highp',
        isWebGL: false,
        // isWebGL: true,
        isDepth: true,
        // wireframe: true,
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
                gl._uniform?.('iMVP', [...cam.MVP])
                scene.render()
                scene.slots.getUpdates().forEach(({ index, bitmap, offset }) => {
                        gl._uniform?.(`iOffset${index}`, offset)
                        gl._texture?.(`iAtlas${index}`, bitmap)
                })
                const data = mesh.getData()
                if (data.version === lastVersion) return
                lastVersion = data.version
                gl._instance?.('pos', data.pos)
                gl._instance?.('scl', data.scl)
                gl._instance?.('aid', data.aid)
                gl.setInstanceCount(data.count)
        },
})

gl.mount()
