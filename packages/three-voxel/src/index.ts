import * as THREE from 'three/webgpu'
import { attribute, float, Fn, int, ivec3, normalLocal, positionGeometry, positionLocal, textureLoad, uniformArray, varying, vec3, vec4 } from 'three/tsl'
import createVoxel from 'voxelized-js/src'
import { atlas } from './utils'
import type { VarNode } from 'three/webgpu'

export * from './utils'

const SLOTS = 16

interface VoxelParams {
        worker: Worker
        i?: number
        j?: number
        camera?: any
        controls?: 'three' | 'voxel'
        onReady?: () => void
}

const _vec = new THREE.Vector3()
const _mat = new THREE.Matrix4()
const _shift = new THREE.Matrix4()
const _eye = new THREE.Vector3()

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

const createVoxelMaterial = (atlasTex: any, offsetNode: any) => {
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
        voxel: ReturnType<typeof createVoxel>
        atlasNode: any
        offsetNode: any
        center: [number, number]
        controls: 'three' | 'voxel'
        private _srcTex: any
        constructor(params: VoxelParams) {
                const atlasTex = createAtlasTex()
                const offsetNode = uniformArray(
                        Array.from({ length: SLOTS }, () => new THREE.Vector3()),
                        'vec3',
                )
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
        onBeforeRender(renderer: any, _scene: any, camera: any) {
                const v = this.voxel
                const cx = this.center[0]
                const cz = this.center[1]
                if (this.controls === 'three') this._driveFromThree(camera, cx, cz)
                else this._driveFromVoxel(renderer, camera, cx, cz)
                const offArr = this.offsetNode.array
                v.updates(({ at, atlas: atl, offset }: any) => {
                        offArr[at].set(offset[0] - cx, offset[1], offset[2] - cz)
                        this._srcTex.image = atl
                        this._srcTex.needsUpdate = true
                        this.offsetNode.needsUpdate = true
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
        private _driveFromThree(camera: any, cx: number, cz: number) {
                const v = this.voxel
                _mat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
                _shift.makeTranslation(-cx, 0, -cz)
                _mat.multiply(_shift)
                for (let k = 0; k < 16; k++) v.cam.mvp[k] = _mat.elements[k]
                v.cam.pos[0] = camera.position.x + cx
                v.cam.pos[1] = camera.position.y
                v.cam.pos[2] = camera.position.z + cz
        }
        private _driveFromVoxel(renderer: any, camera: any, cx: number, cz: number) {
                const v = this.voxel
                const size = renderer.getSize(_vec)
                v.cam.update(size.x / size.y)
                camera.position.set(v.cam.pos[0] - cx, v.cam.pos[1], v.cam.pos[2] - cz)
                _eye.set(v.cam.eye[0] - cx, v.cam.eye[1], v.cam.eye[2] - cz)
                camera.lookAt(_eye)
                camera.updateMatrixWorld()
                camera.updateProjectionMatrix()
        }
}

export default Voxel
