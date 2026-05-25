import { createClient } from '@libsql/client'
import 'dotenv/config'

export const db = createClient({
    url: process.env.TURSO_DATABASE_URL ?? 'file:local.db',
    authToken: process.env.TURSO_AUTH_TOKEN
})

await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )
`)