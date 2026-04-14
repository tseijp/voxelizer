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
const modelUrl = (k: string) => `https://r.tsei.jp/model/${k}.glb`
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

interface PlayerState {
        username: string
        x: number
        y: number
        z: number
        yaw: number
        model: number
}

const hashOf = (s: string) => {
        let h = 0
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
        return Math.abs(h) % MODELS.length
}

const Model = ({ url, position, yaw }: { url: string; position: [number, number, number]; yaw: number }) => {
        const { scene } = useGLTF(url) as any
        const cloned = useMemo(() => scene.clone(true), [scene])
        return <primitive object={cloned} position={position} rotation={[0, yaw, 0]} />
}

const Players = ({ players, selfId }: { players: Record<string, PlayerState>; selfId: string }) => (
        <>
                {Object.entries(players).map(([id, p]) => {
                        if (id === selfId) return null
                        if (!p || typeof p.model !== 'number' || !MODELS[p.model]) return null
                        return <Model key={id} url={modelUrl(MODELS[p.model])} position={[p.x, p.y, p.z]} yaw={p.yaw ?? 0} />
                })}
        </>
)

const _dir = new THREE.Vector3()
const _right = new THREE.Vector3()
const _move = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)

const blocked = (voxel: Voxel, wx: number, wy: number, wz: number) => {
        const cx = voxel.center[0]
        const cz = voxel.center[1]
        const pick = voxel.voxel.pick
        if (pick(Math.floor(wx + cx), Math.floor(wy - 0.1), Math.floor(wz + cz))) return true
        if (pick(Math.floor(wx + cx), Math.floor(wy - EYE + 0.1), Math.floor(wz + cz))) return true
        return false
}

const Controller = ({ voxel, ready, send, username }: { voxel: Voxel; ready: { current: boolean }; send: (s: PlayerState) => void; username: string }) => {
        const { camera } = useThree()
        const [, get] = useKeyboardControls()
        const modelIdx = useMemo(() => hashOf(username), [username])
        const last = useRef(0)
        const prev = useRef<[number, number, number, number]>([NaN, NaN, NaN, NaN])
        const velY = useRef(0)
        const grounded = useRef(false)
        useFrame((_, dt) => {
                if (!ready.current) return
                const s = get() as any
                const step = Math.min(dt, 0.05)
                camera.getWorldDirection(_dir)
                _dir.y = 0
                _dir.normalize()
                _right.crossVectors(_dir, _up).normalize()
                _move.set(0, 0, 0)
                if (s.forward) _move.add(_dir)
                if (s.back) _move.sub(_dir)
                if (s.right) _move.add(_right)
                if (s.left) _move.sub(_right)
                const speed = SPEED * (s.dash ? DASH : 1)
                if (_move.lengthSq() > 0) {
                        _move.normalize().multiplyScalar(step * speed)
                        const nx = camera.position.x + _move.x
                        const nz = camera.position.z + _move.z
                        if (!blocked(voxel, nx, camera.position.y, camera.position.z)) camera.position.x = nx
                        if (!blocked(voxel, camera.position.x, camera.position.y, nz)) camera.position.z = nz
                }
                if (s.jump && grounded.current) velY.current = JUMP
                velY.current += GRAVITY * step
                const ny = camera.position.y + velY.current * step
                grounded.current = false
                if (velY.current < 0 && blocked(voxel, camera.position.x, ny, camera.position.z)) {
                        velY.current = 0
                        grounded.current = true
                } else if (velY.current > 0 && blocked(voxel, camera.position.x, ny + EYE, camera.position.z)) {
                        velY.current = 0
                } else {
                        camera.position.y = ny
                }
                if (camera.position.y < -100) {
                        camera.position.y = 100
                        velY.current = 0
                }
                const now = performance.now()
                if (now - last.current < 50) return
                camera.getWorldDirection(_dir)
                const yaw = Math.atan2(-_dir.z, _dir.x)
                const dx = camera.position.x - prev.current[0]
                const dy = camera.position.y - prev.current[1]
                const dz = camera.position.z - prev.current[2]
                const dYaw = yaw - (prev.current[3] ?? 0)
                if (dx * dx + dy * dy + dz * dz + dYaw * dYaw < 1e-4) return
                last.current = now
                prev.current = [camera.position.x, camera.position.y, camera.position.z, yaw]
                send({ username, x: camera.position.x, y: camera.position.y - EYE, z: camera.position.z, yaw, model: modelIdx })
        })
        return null
}

const Scene = ({ username }: { username: string }) => {
        const ready = useRef(false)
        const [voxel] = useState(() => new Voxel({ worker: new VoxelWorker(), i: 116415, j: 51622, onReady: () => (ready.current = true) }))
        const [players, setPlayers] = useState<Record<string, PlayerState>>({})
        const socket = usePartySocket({
                party: 'v1',
                room: 'voxel-party',
                onMessage: (e) => setPlayers(JSON.parse(e.data) as Record<string, PlayerState>),
        })
        const send = (s: PlayerState) => socket.send(JSON.stringify(s))
        return (
                <KeyboardControls map={keyMap}>
                        <Canvas
                                camera={{ position: [0, 40, 0], fov: 70, near: 0.1, far: 4000 }}
                                gl={(props) => {
                                        extend(THREE as any)
                                        const r = new THREE.WebGPURenderer(props as any)
                                        return r.init().then(() => r)
                                }}
                                onClick={(e) => (e.target as HTMLElement).requestPointerLock?.()}
                        >
                                {/* @ts-ignore */}
                                <primitive object={voxel} />
                                <ambientLight intensity={2} />
                                <directionalLight position={[10, 20, 10]} />
                                <Controller voxel={voxel} ready={ready} send={send} username={username} />
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
