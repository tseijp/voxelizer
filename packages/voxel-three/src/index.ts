import * as THREE from 'three/webgpu'
import { attribute, float, Fn, int, ivec3, normalLocal, positionGeometry, positionLocal, textureLoad, uniformArray, varying, vec3, vec4 } from 'three/tsl'
import createVoxel from 'voxelized-js/src'
import { atlas } from './utils'
import type { Camera, DataArrayTexture, Object3D, Renderer, Scene, Texture, UniformArrayNode, VarNode, Vector3 } from 'three/webgpu'

export * from './utils'

type Req = Parameters<typeof createVoxel>[0]
type Res = ReturnType<typeof createVoxel>
type Cam = Res['cam']

type BaseRenderer = Parameters<Object3D['onBeforeRender']>[0]

const _vec2 = new THREE.Vector2()
const _vec3 = new THREE.Vector3()
const _mat4 = new THREE.Matrix4()
const _shift = new THREE.Matrix4()

const driveFromVoxel = (cam: Cam, camera: Camera, cx: number, cz: number, renderer: Renderer | BaseRenderer) => {
        const size = renderer.getSize(_vec2)
        cam.update(size.x / size.y)
        camera.position.set(cam.pos[0] - cx, cam.pos[1], cam.pos[2] - cz)
        _vec3.set(cam.eye[0] - cx, cam.eye[1], cam.eye[2] - cz)
        camera.lookAt(_vec3)
        camera.updateMatrixWorld()
        // @ts-ignore
        camera.updateProjectionMatrix()
}

const driveFromThree = (cam: Cam, camera: Camera, cx: number, cz: number) => {
        _mat4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        _shift.makeTranslation(-cx, 0, -cz)
        _mat4.multiply(_shift)
        for (let k = 0; k < 16; k++) cam.mvp[k] = _mat4.elements[k]
        cam.pos[0] = camera.position.x + cx
        cam.pos[1] = camera.position.y
        cam.pos[2] = camera.position.z + cz
}

const createAtlasTex = (slot = 16) => {
        const t = new THREE.DataArrayTexture(null, 4096, 4096, slot)
        t.minFilter = t.magFilter = THREE.NearestFilter
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
        t.generateMipmaps = false
        t.needsUpdate = true
        t.source.dataReady = false
        t.colorSpace = THREE.SRGBColorSpace
        return t
}

const createVec3 = () => new THREE.Vector3()
const createGeometry = () => new THREE.BoxGeometry()
const createMaterial = (atlasTex: DataArrayTexture, offsetNode: UniformArrayNode<'vec3'>) => {
        const _pos = attribute<'vec3'>('pos', 'vec3')
        const _scl = attribute<'vec3'>('scl', 'vec3')
        const _aid = attribute<'float'>('aid', 'float')
        const pick = Fn(([id, uvPix]: [VarNode<'float'>, VarNode<'ivec2'>]) => {
                return textureLoad(atlasTex, uvPix, int(0)).depth(id.toInt())
        })
        const diffuse = Fn(([n]: [VarNode<'vec3'>]) => {
                return vec3(-0.33, 0.77, 0.55).normalize().dot(n).mul(0.5).add(0.5)
        })
        const position = Fn(() => {
                const off = offsetNode.element(_aid.toInt())
                return off.add(_pos.add(positionLocal.mul(_scl)))
        })
        const center = Fn(() => {
                const local = _pos.add(positionGeometry.mul(_scl))
                return local.sub(normalLocal.sign().mul(float(0.5))).floor()
        })
        const vAid = varying(_aid, 'vAid')
        const vDiff = varying(diffuse(normalLocal), 'vDiff')
        const vCenter = varying(center(), 'vCenter')
        const color = Fn(() => {
                const p = ivec3(vCenter)
                const uv = atlas(p).toVar('uv')
                const rgb = pick(vAid, uv).rgb.mul(vDiff).toVar('rgb')
                return vec4(rgb, 1)
        })
        const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide })
        mat.positionNode = position()
        mat.colorNode = color()
        return mat
}

export class Voxel extends THREE.InstancedMesh {
        voxel: Res
        offsetNode: UniformArrayNode<'vec3'>
        dstTexture: DataArrayTexture
        private _texture: Texture
        private _isThree: boolean
        constructor(params: Req & { controls?: 'three' | 'voxel' }) {
                const { slot = 16, controls } = params
                const offsetNode = uniformArray<'vec3'>(Array.from({ length: slot }, createVec3), 'vec3')
                const dstTexture = createAtlasTex(slot)
                super(createGeometry(), createMaterial(dstTexture, offsetNode), 1)
                this.offsetNode = offsetNode
                this.dstTexture = dstTexture
                this.frustumCulled = false
                this.voxel = createVoxel(params)
                this._texture = new THREE.Texture()
                this._texture.flipY = this._texture.generateMipmaps = false
                this._isThree = controls !== 'voxel'
                this._setAttribute()
        }
        onBeforeRender(renderer: Renderer | BaseRenderer, _scene: Scene, camera: Camera) {
                const { dstTexture, offsetNode, voxel, _isThree, _texture } = this
                const { center, cam, updates, updated, count, overflow } = voxel
                const [cx, cz] = center
                if (_isThree) driveFromThree(cam, camera, cx, cz)
                else driveFromVoxel(cam, camera, cx, cz, renderer)
                const _node = offsetNode as unknown as { array: Vector3[]; needsUpdate: boolean }
                const array = _node.array
                updates(({ at, atlas, offset }) => {
                        array[at].set(offset[0] - cx, offset[1], offset[2] - cz)
                        _texture.image = atlas
                        _texture.needsUpdate = _node.needsUpdate = true
                        renderer.copyTextureToTexture(_texture, dstTexture, null, _vec3.set(0, 0, at))
                })
                if (!updated()) return
                if (overflow()) return this._setAttribute()
                const geometry = this.geometry
                geometry.getAttribute('pos').needsUpdate = true
                geometry.getAttribute('scl').needsUpdate = true
                geometry.getAttribute('aid').needsUpdate = true
                this.count = count()
        }
        private _setAttribute() {
                const { geometry, voxel } = this
                const { pos, scl, aid } = voxel
                geometry.setAttribute('pos', new THREE.InstancedBufferAttribute(pos(), 3))
                geometry.setAttribute('scl', new THREE.InstancedBufferAttribute(scl(), 3))
                geometry.setAttribute('aid', new THREE.InstancedBufferAttribute(aid(), 1))
        }
}

export default Voxel
