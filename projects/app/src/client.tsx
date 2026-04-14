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
const _dir = new THREE.Vector3()
const _right = new THREE.Vector3()
const _move = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const blocked = (v: Voxel, wx: number, wy: number, wz: number) => {
        const [cx, cz] = v.center
        const fx = Math.floor(wx + cx),
                fz = Math.floor(wz + cz)
        return [wy - 0.1, wy - EYE + 0.1].some((fy) => v.voxel.pick(fx, Math.floor(fy), fz))
}
const walk = (v: Voxel, camera: THREE.Camera, step: number, keys: Record<string, boolean>) => {
        camera.getWorldDirection(_dir).setY(0).normalize()
        _right.crossVectors(_dir, _up).normalize()
        _move.set(0, 0, 0)
        if (keys.forward) _move.add(_dir)
        if (keys.back) _move.sub(_dir)
        if (keys.right) _move.add(_right)
        if (keys.left) _move.sub(_right)
        if (_move.lengthSq() === 0) return
        _move.normalize().multiplyScalar(step * SPEED * (keys.dash ? DASH : 1))
        const { x, y, z } = camera.position
        if (!blocked(v, x + _move.x, y, z)) camera.position.x += _move.x
        if (!blocked(v, camera.position.x, y, z + _move.z)) camera.position.z += _move.z
}
const fall = (v: Voxel, camera: THREE.Camera, step: number, jump: boolean, velY: number, stop: boolean) => {
        if (jump && stop) velY = JUMP
        velY += GRAVITY * step
        const ny = camera.position.y + velY * step
        const { x, z } = camera.position
        stop = velY < 0 && blocked(v, x, ny, z)
        if (stop || (velY > 0 && blocked(v, x, ny + EYE, z))) velY = 0
        else camera.position.y = ny
        if (camera.position.y < -100) {
                camera.position.y = 100
                velY = 0
        }
        return { velY, stop }
}

const createTick = (voxel: Voxel) => {
        let velY = 0
        let last = 0
        let stop = false
        const prev = [NaN, NaN, NaN, NaN]
        const model = Math.floor(Math.random() * MODELS.length)
        return (camera: THREE.Camera, dt: number, keys: Record<string, boolean>, username: string, send: (s: State) => void) => {
                const step = Math.min(dt, 0.05)
                walk(voxel, camera, step, keys)
                ;({ velY, stop } = fall(voxel, camera, step, keys.jump, velY, stop))
                const now = performance.now()
                if (now - last < 50) return
                const yaw = Math.atan2(-_dir.z, _dir.x)
                const { x, y, z } = camera.position
                const [p0, p1, p2, p3] = prev
                if ((x - p0) ** 2 + (y - p1) ** 2 + (z - p2) ** 2 + (yaw - p3) ** 2 < 1e-4) return
                last = now
                ;[prev[0], prev[1], prev[2], prev[3]] = [x, y, z, yaw]
                send({ username, x, y: y - EYE, z, yaw, model })
        }
}
const Controller = ({ voxel, ready, send, username }: { voxel: Voxel; ready: { current: boolean }; send: (s: State) => void; username: string }) => {
        const { camera } = useThree()
        const [, get] = useKeyboardControls()
        const [tick] = useState(() => createTick(voxel))
        useFrame((_, dt) => {
                if (!ready.current) return
                tick(camera, dt, get(), username, send)
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
