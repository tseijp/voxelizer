import * as THREE from 'three/webgpu'
import { attribute, float, Fn, int, ivec3, normalLocal, positionGeometry, positionLocal, textureLoad, uniformArray, varying, vec3, vec4 } from 'three/tsl'
import createVoxel from 'voxelized-js/src'
import { atlas } from './utils'
import type { VarNode } from 'three/webgpu'
import type { Debug } from 'voxelized-js/src'
export * from './utils'

const SLOTS = 16

type VoxelInstance = ReturnType<typeof createVoxel>
type CameraConfig = Parameters<typeof createVoxel>[0]['camera']
type SlotUpdate = Parameters<Parameters<VoxelInstance['updates']>[0]>[0]

interface VoxelParams {
        worker: Worker
        i?: number
        j?: number
        debug?: Debug
        camera?: CameraConfig
        controls?: 'three' | 'voxel'
        onReady?: () => void
}

const _vec = new THREE.Vector3()
const _size = new THREE.Vector2()
const _mat = new THREE.Matrix4()
const _shift = new THREE.Matrix4()
const _eye = new THREE.Vector3()

type VoxelCam = VoxelInstance['cam']

const driveFromThree = (cam: VoxelCam, camera: THREE.PerspectiveCamera, cx: number, cz: number) => {
        _mat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        _shift.makeTranslation(-cx, 0, -cz)
        _mat.multiply(_shift)
        for (let k = 0; k < 16; k++) cam.mvp[k] = _mat.elements[k]
        cam.pos[0] = camera.position.x + cx
        cam.pos[1] = camera.position.y
        cam.pos[2] = camera.position.z + cz
}

type BaseRenderer = Parameters<THREE.Object3D['onBeforeRender']>[0]

const driveFromVoxel = (cam: VoxelCam, renderer: THREE.Renderer | BaseRenderer, camera: THREE.PerspectiveCamera, cx: number, cz: number) => {
        const size = renderer.getSize(_size)
        cam.update(size.x / size.y)
        camera.position.set(cam.pos[0] - cx, cam.pos[1], cam.pos[2] - cz)
        _eye.set(cam.eye[0] - cx, cam.eye[1], cam.eye[2] - cz)
        camera.lookAt(_eye)
        camera.updateMatrixWorld()
        camera.updateProjectionMatrix()
}

const createAtlasTex = () => {
        const t = new THREE.DataArrayTexture(null, 4096, 4096, SLOTS)
        t.minFilter = t.magFilter = THREE.NearestFilter
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
        t.generateMipmaps = false
        t.needsUpdate = true
        t.source.dataReady = false
        t.colorSpace = THREE.SRGBColorSpace
        return t
}

const createVoxelMaterial = (atlasTex: THREE.DataArrayTexture, offsetNode: VarNode<'vec3'>) => {
        const posAttr = attribute<'vec3'>('pos', 'vec3')
        const sclAttr = attribute<'vec3'>('scl', 'vec3')
        const aidAttr = attribute<'float'>('aid', 'float')
        const pick = Fn(([id, uvPix]: [VarNode<'float'>, VarNode<'ivec2'>]) => {
                return textureLoad(atlasTex, uvPix, int(0)).depth(id.toInt())
        })
        const diffuse = Fn(([n]: [VarNode<'vec3'>]) => {
                return vec3(-0.33, 0.77, 0.55).normalize().dot(n).mul(0.5).add(0.5)
        })
        const worldPos = Fn(() => {
                const off = offsetNode.element(aidAttr.toInt()) as VarNode<'vec3'>
                return off.add(posAttr.add(positionLocal.mul(sclAttr)))
        })
        const centerNode = Fn(() => {
                const local = posAttr.add(positionGeometry.mul(sclAttr))
                return local.sub(normalLocal.sign().mul(float(0.5))).floor()
        })
        const vCenter = varying(centerNode(), 'vCenter')
        const vAid = varying(aidAttr, 'vAid')
        const vDiff = varying(diffuse(normalLocal), 'vDiff')
        const fragColor = Fn(() => {
                const p = ivec3(vCenter)
                const uv = atlas(p).toVar('uv')
                const rgb = pick(vAid, uv).rgb.mul(vDiff).toVar('rgb')
                return vec4(rgb, 1)
        })
        const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide })
        mat.positionNode = worldPos()
        mat.colorNode = fragColor()
        return mat
}

export class Voxel extends THREE.InstancedMesh {
        voxel: VoxelInstance
        atlasNode: THREE.DataArrayTexture
        offsetNode: VarNode<'vec3'>
        center: [number, number]
        controls: 'three' | 'voxel'
        private _srcTex: THREE.Texture
        constructor(params: VoxelParams) {
                const atlasTex = createAtlasTex()
                const offsetNode = uniformArray<'vec3'>(
                        Array.from({ length: SLOTS }, () => new THREE.Vector3()),
                        'vec3'
                ) as unknown as VarNode<'vec3'>
                const material = createVoxelMaterial(atlasTex, offsetNode)
                const geometry = new THREE.BoxGeometry()
                super(geometry, material, 1)
                this.frustumCulled = false
                this.atlasNode = atlasTex
                this.offsetNode = offsetNode
                const v = createVoxel(params)
                this.voxel = v
                this.center = v.center
                this.controls = params.controls ?? 'three'
                const srcTex = new THREE.Texture()
                srcTex.flipY = false
                srcTex.generateMipmaps = false
                this._srcTex = srcTex
                geometry.setAttribute('pos', new THREE.InstancedBufferAttribute(v.pos(), 3))
                geometry.setAttribute('scl', new THREE.InstancedBufferAttribute(v.scl(), 3))
                geometry.setAttribute('aid', new THREE.InstancedBufferAttribute(v.aid(), 1))
        }
        onBeforeRender(renderer: THREE.Renderer | BaseRenderer, _scene: THREE.Scene, camera: THREE.Camera) {
                const v = this.voxel
                const cx = this.center[0]
                const cz = this.center[1]
                const persp = camera as THREE.PerspectiveCamera
                if (this.controls === 'three') driveFromThree(v.cam, persp, cx, cz)
                else driveFromVoxel(v.cam, renderer, persp, cx, cz)
                const offNode = this.offsetNode as unknown as { array: THREE.Vector3[]; needsUpdate: boolean }
                v.updates(({ at, atlas: atl, offset }: SlotUpdate) => {
                        offNode.array[at].set(offset[0] - cx, offset[1], offset[2] - cz)
                        this._srcTex.image = atl
                        this._srcTex.needsUpdate = true
                        offNode.needsUpdate = true
                        renderer.copyTextureToTexture(this._srcTex, this.atlasNode, null, _vec.set(0, 0, at))
                })
                if (!v.updated()) return
                const geo = this.geometry
                this.count = v.count()
                if (v.overflow()) {
                        geo.setAttribute('pos', new THREE.InstancedBufferAttribute(v.pos(), 3))
                        geo.setAttribute('scl', new THREE.InstancedBufferAttribute(v.scl(), 3))
                        geo.setAttribute('aid', new THREE.InstancedBufferAttribute(v.aid(), 1))
                        return
                }
                geo.getAttribute('pos').needsUpdate = true
                geo.getAttribute('scl').needsUpdate = true
                geo.getAttribute('aid').needsUpdate = true
        }
}

export default Voxel
