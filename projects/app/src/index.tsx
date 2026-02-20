// index.tsx
import { users } from './schema'
import Google from '@auth/core/providers/google'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { authHandler, initAuthConfig, verifyAuth } from '@hono/auth-js'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { env } from 'hono/adapter'
import { createMiddleware } from 'hono/factory'
import { routePartykitRequest, Server } from 'partyserver'
import type { Connection, ConnectionContext } from 'partyserver'

const getUserBySub = (DB: D1Database, sub: string) => drizzle(DB).select().from(users).where(eq(users.id, sub)).limit(1)
const authMiddleware = initAuthConfig((c) => ({
        adapter: DrizzleAdapter(drizzle(c.env.my_d1_tmp)),
        providers: [Google({ clientId: c.env.GOOGLE_CLIENT_ID, clientSecret: c.env.GOOGLE_CLIENT_SECRET })],
        secret: c.env.AUTH_SECRET,
        session: { strategy: 'jwt' },
}))
const myMiddleware = createMiddleware(async (c) => {
        const headers = new Headers(c.req.raw.headers)
        headers.set('x-user-sub', c.get('authUser')?.token?.sub!)
        const req = new Request(c.req.raw, { headers })
        const res = await routePartykitRequest(req, env(c))
        return res ?? c.text('Not Found', 404)
})

type Env = { my_d1_tmp: D1Database; my_r2_tmp: R2Bucket }
type Conn = Connection<{ username: string }>

export class PartyServer extends Server<Env> {
        users = {} as Record<string, string>
        static options = { hibernate: true }
        async onConnect(conn: Conn, c: ConnectionContext) {
                const sub = c.request.headers.get('x-user-sub')!
                const [user] = await getUserBySub(this.env.my_d1_tmp, sub)
                conn.setState({ username: user.name! })
        }
        async onMessage(conn: Conn, message: string) {
                this.users[conn.state!.username] = message
                this.broadcast(JSON.stringify(this.users))
        }
        onClose(conn: Conn) {
                delete this.users[conn.state!.username]
                this.broadcast(JSON.stringify(this.users), [conn.id])
        }
}

export default new Hono<{ Bindings: Env }>()
        .get('/api/res', (c) => c.text('ok'))
        .use('*', authMiddleware)
        .use('/parties/*', verifyAuth())
        .use('/parties/*', myMiddleware)
        .use('/api/auth/*', authHandler())
        .use('/api/v1/*', verifyAuth())
        .get('/api/v1/me', async (c) => {
                const { token } = c.get('authUser')
                if (!token || !token.sub) return c.json(null, 401)
                const [user] = await getUserBySub(c.env.my_d1_tmp, token.sub)
                return c.json({ username: user.name || null })
        })
