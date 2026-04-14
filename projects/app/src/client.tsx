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
type State = { x: number; y: number; z: number; yaw: number; model: number }

const hashOf = (s: string) => {
        let h = 0
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
        return Math.abs(h) % MODELS.length
}

const Model = ({ url, state: { x, y, z, yaw } }: { url: string; state: State }) => {
        const { scene } = useGLTF(url) as any
        const cloned = useMemo(() => scene.clone(true), [scene])
        return <primitive object={cloned} position={[x, y, z]} rotation={[0, yaw, 0]} />
}

const Players = ({ players, selfId }: { players: Record<string, State>; selfId: string }) =>
        Object.entries(players).map(([id, state]) => {
                if (id === selfId || !MODELS[state?.model]) return null
                return <Model key={id} url={URL(MODELS[state.model])} state={state} />
        })

const _dir = new THREE.Vector3()
const _right = new THREE.Vector3()
const _move = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)

const blocked = (v: Voxel, wx: number, wy: number, wz: number) => {
        const fx = Math.floor(wx + v.center[0])
        const fz = Math.floor(wz + v.center[1])
        return !!v.voxel.pick(fx, Math.floor(wy - 0.1), fz) || !!v.voxel.pick(fx, Math.floor(wy - EYE + 0.1), fz)
}
const readInput = (camera: any, s: any) => {
        camera.getWorldDirection(_dir).setY(0).normalize()
        _right.crossVectors(_dir, _up).normalize()
        _move.set(0, 0, 0)
        if (s.forward) _move.add(_dir)
        if (s.back) _move.sub(_dir)
        if (s.right) _move.add(_right)
        if (s.left) _move.sub(_right)
}
const walk = (v: Voxel, camera: any, step: number, dash: boolean) => {
        if (_move.lengthSq() === 0) return
        _move.normalize().multiplyScalar(step * SPEED * (dash ? DASH : 1))
        const nx = camera.position.x + _move.x
        const nz = camera.position.z + _move.z
        if (!blocked(v, nx, camera.position.y, camera.position.z)) camera.position.x = nx
        if (!blocked(v, camera.position.x, camera.position.y, nz)) camera.position.z = nz
}
const fall = (v: Voxel, camera: any, step: number, jump: boolean, velY: { current: number }, grounded: { current: boolean }) => {
        if (jump && grounded.current) velY.current = JUMP
        velY.current += GRAVITY * step
        const ny = camera.position.y + velY.current * step
        grounded.current = velY.current < 0 && blocked(v, camera.position.x, ny, camera.position.z)
        const ceil = velY.current > 0 && blocked(v, camera.position.x, ny + EYE, camera.position.z)
        if (grounded.current || ceil) velY.current = 0
        else camera.position.y = ny
        if (camera.position.y < -100) void ((camera.position.y = 100), (velY.current = 0))
}
const changed = (prev: number[], x: number, y: number, z: number, yaw: number) => {
        const dx = x - prev[0], dy = y - prev[1], dz = z - prev[2], dYaw = yaw - prev[3]
        return !(dx * dx + dy * dy + dz * dz + dYaw * dYaw < 1e-4)
}
const Controller = ({ voxel, ready, send, username }: { voxel: Voxel; ready: { current: boolean }; send: (s: State & { username: string }) => void; username: string }) => {
        const { camera } = useThree()
        const [, get] = useKeyboardControls()
        const model = useMemo(() => hashOf(username), [username])
        const last = useRef(0)
        const prev = useRef([NaN, NaN, NaN, NaN])
        const velY = useRef(0)
        const grounded = useRef(false)
        useFrame((_, dt) => {
                if (!ready.current) return
                const s = get() as any
                const step = Math.min(dt, 0.05)
                readInput(camera, s)
                walk(voxel, camera, step, s.dash)
                fall(voxel, camera, step, s.jump, velY, grounded)
                const now = performance.now()
                if (now - last.current < 50) return
                const yaw = Math.atan2(-_dir.z, _dir.x)
                const { x, y, z } = camera.position
                if (!changed(prev.current, x, y, z, yaw)) return
                last.current = now
                prev.current = [x, y, z, yaw]
                send({ username, x, y: y - EYE, z, yaw, model })
        })
        return null
}
const Scene = ({ username }: { username: string }) => {
        const ready = useRef(false)
        const [voxel] = useState(() => new Voxel({ worker: new VoxelWorker(), i: 116415, j: 51622, onReady: () => (ready.current = true) }))
        const [players, setPlayers] = useState<Record<string, State>>({})
        const socket = usePartySocket({ party: 'v1', room: 'voxel-party', onMessage: (e) => setPlayers(JSON.parse(e.data)) })
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
                                {/* @ts-ignore */}
                                <primitive object={voxel} />
                                <ambientLight intensity={2} />
                                <directionalLight position={[10, 20, 10]} />
                                <Controller voxel={voxel} ready={ready} send={(s) => socket.send(JSON.stringify(s))} username={username} />
                                <Players players={players} selfId={username} />
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
