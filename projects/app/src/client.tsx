import './style.css'
import VoxelWorker from './worker?worker'
import { signIn } from '@hono/auth-js/react'
import { KeyboardControls, PointerLockControls, useGLTF, useKeyboardControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { usePartySocket } from 'partysocket/react'
import { useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import useSWRImmutable from 'swr/immutable'
import { Voxel } from 'three-voxel/src'
import * as THREE from 'three/webgpu'
import type PartySocket from 'partysocket'

const { atan2, floor, hypot, min, random } = Math
const MODELS = ['konaku', 'ryusui', 'senku']
const GRAVITY = -75
const SPEED = 12
const DASH = 3
const JUMP = 20
const EYE = 1.6
const MAP = [
        { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
        { name: 'right', keys: ['ArrowRight', 'KeyD'] },
        { name: 'left', keys: ['ArrowLeft', 'KeyA'] },
        { name: 'back', keys: ['ArrowDown', 'KeyS'] },
        { name: 'jump', keys: ['Space'] },
        { name: 'dash', keys: ['ShiftLeft', 'ShiftRight'] },
]

const collide = (v: Voxel, wx: number, wy: number, wz: number) => {
        return [wy - 0.1, wy - EYE + 0.1].some((fy) => v.voxel.pick(floor(wx + v.center[0]), floor(fy), floor(wz + v.center[1])))
}

const createTick = (voxel: Voxel, socket: PartySocket, username: string) => {
        let vy = 0
        let pt = 0
        let stop = false
        const _up = new THREE.Vector3(0, 1, 0)
        const _dir = new THREE.Vector3()
        const _move = new THREE.Vector3()
        const _right = new THREE.Vector3()
        const prev = { x: 0, y: 0, z: 0, yaw: 0 }
        const model = floor(random() * MODELS.length)
        return (camera: THREE.Camera, dt: number, { forward, right, left, back, jump, dash }: Record<string, boolean>) => {
                let { x, y, z } = camera.position
                camera.getWorldDirection(_dir).setY(0).normalize()
                _right.crossVectors(_dir, _up).normalize()
                _move.set(0, 0, 0)
                if (forward || right || left || back) {
                        if (forward) _move.add(_dir)
                        if (right) _move.add(_right)
                        if (left) _move.sub(_right)
                        if (back) _move.sub(_dir)
                        _move.normalize().multiplyScalar(dt * SPEED * (dash ? DASH : 1))
                        if (!collide(voxel, x + _move.x, y, z)) x += _move.x
                        if (!collide(voxel, x, y, z + _move.z)) z += _move.z
                }
                if (jump && stop) vy = JUMP
                vy += GRAVITY * dt
                const _y = y + vy * dt
                stop = collide(voxel, x, _y, z)
                if (stop) vy = 0
                else y = _y
                if (y < -100) {
                        y = 100
                        vy = 0
                }
                Object.assign(camera.position, { x, y, z })
                const now = performance.now()
                if (now - pt < 50) return
                pt = now
                const yaw = atan2(-_dir.z, _dir.x)
                if (hypot(x - prev.x, y - prev.y, z - prev.z, yaw - prev.yaw) < 1e-2) return
                Object.assign(prev, { x, y, z, yaw })
                socket.send(JSON.stringify({ username, x, y: y - EYE, z, yaw, model }))
        }
}

const Controller = ({ voxel, socket, username, ready }: { voxel: Voxel; socket: PartySocket; username: string; ready: { current: boolean } }) => {
        const get = useKeyboardControls()[1]
        const tick = useMemo(() => createTick(voxel, socket, username), [])
        useFrame(({ camera }, dt) => {
                if (ready.current) tick(camera, min(dt, 0.05), get())
        })
        return null
}

const Model = ({ data }: { data: string }) => {
        const { x, y, z, yaw, model } = useMemo(() => JSON.parse(data), [data])
        const { scene } = useGLTF(`https://r.tsei.jp/model/${MODELS[model]}.glb`)
        return <primitive object={scene} position={[x, y, z]} rotation={[0, yaw, 0]} />
}

const gl = async (props: any) => {
        const renderer = new THREE.WebGPURenderer(props)
        await renderer.init()
        return renderer
}

const Scene = ({ username }: { username: string }) => {
        const ready = useRef(false)
        const socket = usePartySocket({ party: 'v1', room: 'voxel-party', onMessage: (e) => set(Object.entries(JSON.parse(e.data))) })
        const [voxel] = useState(() => new Voxel({ worker: new VoxelWorker(), i: 116415, j: 51622, onReady: () => (ready.current = true) }))
        const [users, set] = useState<[string, string][]>([])
        return (
                <KeyboardControls map={MAP}>
                        <Canvas gl={gl} camera={{ position: [0, 40, 0], fov: 70, near: 0.1, far: 4000 }} onClick={(e) => (e.target as HTMLElement).requestPointerLock?.()}>
                                <primitive object={voxel} />
                                <ambientLight intensity={2} />
                                <directionalLight position={[10, 20, 10]} />
                                <Controller voxel={voxel} socket={socket} username={username} ready={ready} />
                                <PointerLockControls />
                                {users.map(([id, data]) => {
                                        if (id === username) return null
                                        return <Model key={id} data={data} />
                                })}
                        </Canvas>
                </KeyboardControls>
        )
}

const App = () => {
        const { data } = useSWRImmutable('me', async () => (await fetch('/api/v1/me')).json<{ username: string }>())
        if (!data) return <button onClick={() => void signIn()}>Sign In</button>
        return <Scene username={data.username} />
}

createRoot(document.getElementById('root')!).render(<App />)
