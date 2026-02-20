// client.tsx
import './style.css'
import { signIn } from '@hono/auth-js/react'
import { usePartySocket } from 'partysocket/react'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import useSWRImmutable from 'swr/immutable'
const Cursors = () => {
        const [users, set] = useState<[username: string, transform: string][]>([])
        const socket = usePartySocket({
                party: 'v1',
                room: 'my-room',
                onOpen: () => addEventListener('mousemove', (e) => socket.send(`translate(${e.clientX}px, ${e.clientY}px)`)),
                onMessage: (e) => set(Object.entries(JSON.parse(e.data))),
        })
        return users.map(([username, transform]) => (
                <div key={username} className="absolute" style={{ transform }}>
                        {username}
                </div>
        ))
}
const fetcher = async () => {
        const res = await fetch('/api/v1/me')
        return await res.json()
}
const App = () => {
        const { data } = useSWRImmutable('me', fetcher)
        if (!data) return <button onClick={() => void signIn()}>Sign In</button>
        return <Cursors />
}
createRoot(document.getElementById('root')!).render(<App />)
