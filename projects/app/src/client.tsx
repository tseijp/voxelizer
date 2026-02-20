import './style.css'
import { signIn } from '@hono/auth-js/react'
import { usePartySocket } from 'partysocket/react'
import { useEffect, useMemo, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import useSWRImmutable from 'swr/immutable'
import { useGL } from 'glre/src/react'
import { capsule } from 'glre/src/buffers'
import { float, Scope, instance, mat4, uniform, vec3, vec4, varying } from 'glre/src/node'
import { createCamera, createMesh, createScene } from 'voxelized-js'
import VoxelWorker from './worker?worker'
const Game = ({ username }: { username: string }) => {
        const worldNode = useMemo(() => {
                const geo = capsule({ radius: 0.5, height: 1 })
                const iMVP = uniform<'mat4'>(mat4(), 'iMVP')
                const pos = instance<'vec3'>(vec3(), 'pos')
                const scl = instance<'vec3'>(vec3(), 'scl')
                const vNormal = varying(geo.normal('boxNormal'))
                const vert = Scope(() => iMVP.mul(vec4(geo.vertex('boxVertex').mul(scl).add(pos), 1)))
                const frag = Scope(() => vec4(varying(vNormal).normalize().mul(0.5).add(float(0.5)), 1))
                return { iMVP, gl: { vert, frag, uniforms: { iMVP: null }, instances: { pos: null, scl: null }, attributes: { boxVertex: null, boxNormal: null }, isWebGL: true, isDepth: true, wireframe: true, triangleCount: geo.count, instanceCount: 1 } }
        }, [])
        const playerNode = useMemo(() => {
                const geo = capsule({ radius: 0.4, height: 1 })
                const pMVP = uniform<'mat4'>(mat4(), 'pMVP')
                const pos = instance<'vec3'>(vec3(), 'pPos')
                const vert = Scope(() => pMVP.mul(vec4(geo.vertex('pVertex').add(pos).add(vec3(0.5, 0, 0.5)), 1)))
                const frag = vec4(vec3(0.1, 1, 0.3), 1)
                return { pMVP, gl: { vert, frag, uniforms: { pMVP: null }, instances: { pPos: null }, attributes: { pVertex: null, pNormal: null }, isWebGL: true, isDepth: true, wireframe: true, triangleCount: geo.count, instanceCount: 0 } }
        }, [])
        const cam = useMemo(() => createCamera({ X: 22912, Y: 800, Z: 20096, yaw: Math.PI / 2, pitch: -Math.PI / 2 + 0.01, mode: -1 }), [])
        const mesh = useMemo(createMesh, [])
        const scene = useMemo(() => createScene(mesh, cam, new VoxelWorker()), [])
        const players = useRef<Float32Array>(new Float32Array(0))
        const keys = useRef<Record<string, number>>({})
        const program = useRef<WebGLProgram | null>(null)
        const vao = useRef<WebGLVertexArrayObject | null>(null)
        const socket = usePartySocket({
                party: 'v1',
                room: 'voxel-party',
                onMessage: (e) => {
                        const vals = Object.entries(JSON.parse(e.data) as Record<string, number[]>)
                                .filter(([k]) => k !== username)
                                .map(([, v]) => v)
                        const arr = new Float32Array(vals.length * 3)
                        vals.forEach((p, i) => arr.set(p, i * 3))
                        players.current = arr
                },
        })
        useEffect(() => {
                const press = (on = false, e: KeyboardEvent) => {
                        const k = e.code
                        if (k === 'KeyW') keys.current.w = on ? 1 : 0
                        if (k === 'KeyS') keys.current.s = on ? -1 : 0
                        if (k === 'KeyA') keys.current.a = on ? 1 : 0
                        if (k === 'KeyD') keys.current.d = on ? -1 : 0
                        if (k === 'Space') keys.current.space = on ? 1 : 0
                        if (k === 'ShiftLeft') keys.current.shift = on ? 1 : 0
                }
                const down = (e: KeyboardEvent) => press(true, e)
                const up = (e: KeyboardEvent) => press(false, e)
                window.addEventListener('keydown', down)
                window.addEventListener('keyup', up)
                return () => {
                        window.removeEventListener('keydown', down)
                        window.removeEventListener('keyup', up)
                }
        }, [])
        let ts = performance.now()
        let pt = ts
        let lastSend = 0
        const send = () => {
                const now = performance.now()
                if (now - lastSend < 50) return
                lastSend = now
                socket.send(JSON.stringify({ [username]: [...cam.pos] }))
        }
        const gl = useGL(
                {
                        ...worldNode.gl,
                        render() {
                                pt = ts
                                ts = performance.now()
                                const dt = Math.min((ts - pt) / 1000, 0.03)
                                cam.asdw(1, (keys.current.w || 0) + (keys.current.s || 0))
                                cam.asdw(2, (keys.current.a || 0) + (keys.current.d || 0))
                                cam.space(!!keys.current.space)
                                cam.shift(!!keys.current.shift)
                                cam.tick(dt, scene.pick)
                                cam.update(gl.size[0] / gl.size[1])
                                gl._uniform!('iMVP', [...cam.MVP])
                                scene.render(gl.context, program.current!)
                                gl.setInstanceCount(mesh.draw(gl.context, program.current!, vao.current!), 0)
                                gl._uniform!('pMVP', [...cam.MVP])
                                const count = players.current.length / 3
                                if (count > 0) {
                                        gl.setInstanceCount(count, 1)
                                        gl._instance?.('pPos', players.current, 1)
                                }
                                send()
                        },
                        resize() {
                                cam.update(gl.size[0] / gl.size[1])
                                gl._uniform!('iMVP', [...cam.MVP])
                                gl._uniform!('pMVP', [...cam.MVP])
                        },
                        mount() {
                                program.current = gl.program
                                vao.current = gl.vao
                        },
                },
                {
                        ...playerNode.gl,
                }
        )
        return <canvas ref={gl.ref} className="fixed top-0 left-0" />
}
const App = () => {
        const { data } = useSWRImmutable('me', async () => (await fetch('/api/v1/me')).json<{ username: string }>())
        if (!data) return <button onClick={() => void signIn()}>Sign In</button>
        return <Game username={data.username} />
}
createRoot(document.getElementById('root')!).render(<App />)
