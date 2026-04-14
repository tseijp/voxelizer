import './style.css'
import { signIn } from '@hono/auth-js/react'
import { usePartySocket } from 'partysocket/react'
import { useEffect, useMemo, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import useSWRImmutable from 'swr/immutable'
import * as THREE from 'three/webgpu'
import { Canvas, extend, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { Voxel } from 'three-voxel/src'
import VoxelWorker from './worker?worker'

const MODELS = ['konaku', 'ryusui', 'senku']
const modelUrl = (k: string) => `https://r.tsei.jp/model/${k}.glb`

interface PlayerState {
        username: string
        x: number
        y: number
        z: number
        model: number
}

const hashOf = (s: string) => {
        let h = 0
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
        return Math.abs(h) % MODELS.length
}

const Model = ({ url, position }: { url: string; position: [number, number, number] }) => {
        const { scene } = useGLTF(url) as any
        const cloned = useMemo(() => scene.clone(true), [scene])
        return <primitive object={cloned} position={position} scale={1} />
}

const Players = ({ players, selfId }: { players: Record<string, PlayerState>; selfId: string }) => (
        <>
                {Object.entries(players).map(([id, p]) => {
                        if (id === selfId) return null
                        return <Model key={id} url={modelUrl(MODELS[p.model])} position={[p.x, p.y, p.z]} />
                })}
        </>
)

const Self = ({ send, username }: { send: (s: PlayerState) => void; username: string }) => {
        const modelIdx = useMemo(() => hashOf(username), [username])
        const { camera } = useThree()
        const last = useRef(0)
        useFrame(() => {
                const now = performance.now()
                if (now - last.current < 50) return
                last.current = now
                send({ username, x: camera.position.x, y: camera.position.y - 1.5, z: camera.position.z, model: modelIdx })
        })
        const url = modelUrl(MODELS[modelIdx])
        return <Model url={url} position={[camera.position.x, camera.position.y - 1.5, camera.position.z]} />
}

const Scene = ({ username }: { username: string }) => {
        const voxelRef = useRef<Voxel | null>(null)
        if (!voxelRef.current) voxelRef.current = new Voxel({ worker: new VoxelWorker(), i: 116415, j: 51622 })
        const voxel = voxelRef.current
        const playersRef = useRef<Record<string, PlayerState>>({})
        const socket = usePartySocket({
                party: 'v1',
                room: 'voxel-party',
                onMessage: (e) => {
                        const data = JSON.parse(e.data) as Record<string, PlayerState>
                        playersRef.current = data
                },
        })
        const send = (s: PlayerState) => socket.send(JSON.stringify(s))
        useEffect(() => extend({ Voxel }), [])
        return (
                <Canvas
                        camera={{ position: [0, 5, 10], fov: 60, near: 0.1, far: 4000 }}
                        gl={(props) => {
                                extend(THREE as any)
                                const r = new THREE.WebGPURenderer(props as any)
                                return r.init().then(() => r)
                        }}
                >
                        <primitive object={voxel} />
                        <ambientLight intensity={2} />
                        <directionalLight position={[10, 20, 10]} />
                        <Self send={send} username={username} />
                        <Players players={playersRef.current} selfId={username} />
                        <OrbitControls />
                </Canvas>
        )
}

const App = () => {
        const { data } = useSWRImmutable('me', async () => (await fetch('/api/v1/me')).json<{ username: string }>())
        return 'HI'
        if (!data) return <button onClick={() => void signIn()}>Sign In</button>
        // return <Scene username={data.username} />
}

createRoot(document.getElementById('root')!).render(<App />)
