import './style.css'
import { signIn } from '@hono/auth-js/react'
import { usePartySocket } from 'partysocket/react'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import useSWRImmutable from 'swr/immutable'
import { Drag, GL, useGL } from 'glre/src/react'
import { box, capsule } from 'glre/src/buffers'
import { If, float, Scope, instance, mat4, uniform, vec3, vec4, varying } from 'glre/src/node'
import { createCamera, createMesh, createScene, range } from 'voxelized-js/src'
import VoxelWorker from './worker?worker'
const createUsers = () => {
        const mvp = uniform<'mat4'>(mat4(), 'mvp')
        const geo = capsule({ radius: 0.4, height: 1.4 })
        const pos = instance<'vec3'>(vec3(), 'pPos')
        return {
                mvp,
                gl: {
                        vert: mvp.mul(vec4(geo.vertex('pVertex').add(pos).add(vec3(0.5)), 1)),
                        frag: vec4(vec3(0.1, 1, 0.3), 1),
                        uniforms: { mvp: null },
                        instances: { pPos: null },
                        attributes: { pVertex: null, pNormal: null },
                        count: geo.count,
                        instanceCount: 0,
                        wireframe: true,
                        isWebGL: true,
                        isDepth: true,
                },
        }
}
const createWorld = () => {
        const mvp = uniform<'mat4'>(mat4(), 'mvp')
        const geo = box()
        const pos = instance<'vec3'>(vec3(), 'pos')
        const scl = instance<'vec3'>(vec3(), 'scl')
        const aid = instance<'float'>(float(), 'aid')
        const iOffset = range(16).map((i) => uniform<'vec3'>(vec3(), `iOffset${i}`))
        const vCenter = varying<'vec3'>(vec3(), 'vCenter')
        const wNormal = geo.normal('wNormal')
        return {
                mvp,
                gl: {
                        vert: Scope(() => {
                                const off = vec3(0).toVar('off')
                                range(16).forEach((i) => If(aid.equal(i), () => void off.assign(iOffset[i])))
                                const local = geo.vertex('wVertex').mul(scl).add(pos)
                                vCenter.assign(local.sub(wNormal.sign().mul(0.5)).floor())
                                return mvp.mul(vec4(off.add(local), 1))
                        }),
                        frag: vec4(varying(wNormal), 1),
                        textures: Object.fromEntries(range(16).map((i) => [`iAtlas${i}`, null])),
                        uniforms: { ...Object.fromEntries(range(16).map((i) => [`iOffset${i}`, null])), mvp: null },
                        instances: { pos: null, scl: null, aid: null },
                        attributes: { wVertex: null, wNormal: null },
                        triangleCount: 12,
                        instanceCount: 1,
                },
        }
}
const createGame = (username: string) => {
        let gl: GL
        let ts = performance.now()
        let pt = ts
        let st = ts
        let pg: WebGLProgram | null = null
        let players = new Float32Array(0)
        let send = (_: string) => {}
        const users = createUsers()
        const world = createWorld()
        const mesh = createMesh()
        const cam = createCamera({ X: 22912, Y: 100, Z: 20096, yaw: Math.PI / 2, pitch: -Math.PI / 4, mode: 1 })
        const scene = createScene(mesh, cam, new VoxelWorker())
        const press = (on = false, e: KeyboardEvent) => {
                const k = e.code
                if (k === 'KeyW') cam.asdw(1, on ? 1 : 0)
                if (k === 'KeyS') cam.asdw(1, on ? -1 : 0)
                if (k === 'KeyA') cam.asdw(2, on ? 1 : 0)
                if (k === 'KeyD') cam.asdw(2, on ? -1 : 0)
                if (k === 'Space') cam.space(on)
                if (k === 'ShiftLeft') cam.shift(on)
        }
        const down = press.bind(null, true)
        const up = press.bind(null, false)
        const render = () => {
                if (!gl || !pg) return
                gl.context.useProgram(pg)
                pt = ts
                ts = performance.now()
                const dt = Math.min((ts - pt) / 1000, 0.03)
                cam.tick(dt, scene.pick)
                cam.update(gl.size[0] / gl.size[1])
                users.mvp.value = world.mvp.value = [...cam.MVP]
                scene.render(gl.context, pg)
                gl.setInstanceCount(mesh.draw(gl.context, pg, gl.vao), 1)
                if (players.length > 0) {
                        gl.setInstanceCount(players.length / 3, 0)
                        gl._instance?.('pPos', players, 0)
                }
                if (ts - st < 100) return
                st = ts
                send(JSON.stringify(cam.pos))
        }
        const mount = () => {
                pg = gl.program
                users.mvp.value = world.mvp.value = [...cam.MVP]
                window.addEventListener('keydown', down)
                window.addEventListener('keyup', up)
        }
        const clean = () => {
                window.removeEventListener('keydown', down)
                window.removeEventListener('keyup', up)
        }
        const dragging = (drag: Drag) => {
                if (!drag.isDragging) return
                cam.turn([-drag.delta[0], -drag.delta[1]])
        }
        const onMessage = (e: WebSocketEventMap['message']) => {
                const body = JSON.parse(e.data) as Record<string, string>
                players = new Float32Array(
                        Object.entries(body)
                                .filter(([k]) => k !== username)
                                .flatMap(([, v]) => JSON.parse(v))
                )
        }
        return {
                bind: (_gl: GL, _send: (d: string) => void) => void ((gl = _gl), (send = _send)),
                onMessage,
                users: { ...users.gl },
                world: { ...world.gl, render, mount, clean, dragging },
        }
}
const Game = ({ username }: { username: string }) => {
        const [game] = useState(() => createGame(username))
        const socket = usePartySocket({ party: 'v1', room: 'voxel-party', onMessage: game.onMessage })
        const gl = useGL(game.users, game.world)
        game.bind(gl, (d) => socket.send(d))
        return <canvas ref={gl.ref} className="fixed top-0 left-0" />
}
const App = () => {
        const { data } = useSWRImmutable('me', async () => (await fetch('/api/v1/me')).json<{ username: string }>())
        if (!data) return <button onClick={() => void signIn()}>Sign In</button>
        return <Game username={data.username} />
}
createRoot(document.getElementById('root')!).render(<App />)
