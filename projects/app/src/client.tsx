import './style.css'
import { signIn } from '@hono/auth-js/react'
import { usePartySocket } from 'partysocket/react'
import { useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import useSWRImmutable from 'swr/immutable'
import * as THREE from 'three/webgpu'
import { Canvas, extend, useFrame, useThree } from '@react-three/fiber'
import { KeyboardControls, PointerLockControls, useGLTF, useKeyboardControls } from '@react-three/drei'
import { Voxel } from 'three-voxel/src'
import VoxelWorker from './worker?worker'
const { atan2, floor, hypot, min, random } = Math
const MODELS = ['konaku', 'ryusui', 'senku']
const URL = (k: string) => `https://r.tsei.jp/model/${k}.glb`
const SPEED = 12
const DASH = 3
const JUMP = 20
const GRAVITY = -75
const EYE = 1.6
const keyMap = [
        { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
        { name: 'back', keys: ['ArrowDown', 'KeyS'] },
        { name: 'left', keys: ['ArrowLeft', 'KeyA'] },
        { name: 'right', keys: ['ArrowRight', 'KeyD'] },
        { name: 'jump', keys: ['Space'] },
        { name: 'dash', keys: ['ShiftLeft', 'ShiftRight'] },
]
type State = { username: string; x: number; y: number; z: number; yaw: number; model: number }
const blocked = (v: Voxel, wx: number, wy: number, wz: number) => {
        const [cx, cz] = v.center
        return [wy - 0.1, wy - EYE + 0.1].some((fy) => v.voxel.pick(floor(wx + cx), floor(fy), floor(wz + cz)))
}
const createTick = (voxel: Voxel, username: string, send: (s: State) => void) => {
        let vy = 0
        let pt = 0
        let stop = false
        const _up = new THREE.Vector3(0, 1, 0)
        const _dir = new THREE.Vector3()
        const _move = new THREE.Vector3()
        const _right = new THREE.Vector3()
        const prev = { x: 0, y: 0, z: 0, yaw: 0 }
        const model = floor(random() * MODELS.length)
        return (camera: THREE.Camera, dt: number, keys: Record<string, boolean>) => {
                let { x, y, z } = camera.position
                camera.getWorldDirection(_dir).setY(0).normalize()
                _right.crossVectors(_dir, _up).normalize()
                _move.set(0, 0, 0)
                if (keys.forward) _move.add(_dir)
                if (keys.right) _move.add(_right)
                if (keys.back) _move.sub(_dir)
                if (keys.left) _move.sub(_right)
                if (_move.lengthSq() > 0) {
                        _move.normalize().multiplyScalar(dt * SPEED * (keys.dash ? DASH : 1))
                        if (!blocked(voxel, x + _move.x, y, z)) x += _move.x
                        if (!blocked(voxel, x, y, z + _move.z)) z += _move.z
                }
                if (keys.jump && stop) vy = JUMP
                vy += GRAVITY * dt
                const _y = y + vy * dt
                stop = vy < 0 && blocked(voxel, x, _y, z)
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
                send({ username, x, y: y - EYE, z, yaw, model })
        }
}
const Controller = ({ voxel, ready, send, username }: { voxel: Voxel; ready: { current: boolean }; send: (s: State) => void; username: string }) => {
        const { camera } = useThree()
        const [, get] = useKeyboardControls()
        const tick = useMemo(() => createTick(voxel, username, send), [])
        useFrame((_, dt) => {
                if (!ready.current) return
                tick(camera, min(dt, 0.05), get())
        })
        return null
}
const Model = ({ url, state: { x, y, z, yaw } }: { url: string; state: State }) => {
        const { scene } = useGLTF(url)
        const cloned = useMemo(() => scene.clone(true), [scene])
        return <primitive object={cloned} position={[x, y, z]} rotation={[0, yaw, 0]} />
}
const Scene = ({ username }: { username: string }) => {
        const ready = useRef(false)
        const [voxel] = useState(() => new Voxel({ worker: new VoxelWorker(), i: 116415, j: 51622, onReady: () => (ready.current = true) }))
        const [players, setPlayers] = useState<[string, State][]>([])
        const socket = usePartySocket({ party: 'v1', room: 'voxel-party', onMessage: (e) => setPlayers(Object.entries(JSON.parse(e.data))) })
        return (
                <KeyboardControls map={keyMap}>
                        <Canvas
                                camera={{ position: [0, 40, 0], fov: 70, near: 0.1, far: 4000 }}
                                gl={async (props) => {
                                        extend(THREE as any)
                                        const renderer = new THREE.WebGPURenderer(props as any)
                                        await renderer.init()
                                        return renderer
                                }}
                                onClick={(e) => (e.target as HTMLElement).requestPointerLock?.()}
                        >
                                <primitive object={voxel} />
                                <ambientLight intensity={2} />
                                <directionalLight position={[10, 20, 10]} />
                                <Controller voxel={voxel} ready={ready} send={(s) => socket.send(JSON.stringify(s))} username={username} />
                                {players.map(([id, state]) => {
                                        if (id === username || !MODELS[state?.model]) return null
                                        return <Model key={id} url={URL(MODELS[state.model])} state={state} />
                                })}
                                <PointerLockControls />
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
