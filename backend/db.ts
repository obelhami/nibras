import { createClient } from "@libsql/client";
import "dotenv/config";

/**
 * 🔥 HARD FAIL if env is missing (no fallback to local DB)
 */
if (!process.env.TURSO_DATABASE_URL) {
    throw new Error("❌ TURSO_DATABASE_URL is missing");
}

if (!process.env.TURSO_AUTH_TOKEN) {
    throw new Error("❌ TURSO_AUTH_TOKEN is missing");
}

/**
 * 🧠 Turso client
 */
export const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

/**
 * 🗄️ Database initialization (safe for multiple startups)
 */
async function initDB() {
    // USERS
    await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            picture TEXT,
            is_verified INTEGER NOT NULL DEFAULT 0
        )
    `);

    // refresh tokens
    await db.execute(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT NOT NULL,
            email TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // verification tokens
    await db.execute(`
        CREATE TABLE IF NOT EXISTS verification_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT UNIQUE NOT NULL,
            user_email TEXT NOT NULL,
            payload TEXT NOT NULL DEFAULT '{}',
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    /**
     * ⚠️ Optional migration (safe ignore if column exists)
     */
    try {
        await db.execute(`
            ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0
        `);
    } catch (_) {
        // column already exists → ignore
    }

    try {
        await db.execute(`
            ALTER TABLE users ADD COLUMN picture TEXT
        `);
    } catch (_) {
        // column already exists → ignore
    }

    try {
        await db.execute(`
            ALTER TABLE verification_tokens ADD COLUMN payload TEXT NOT NULL DEFAULT '{}'
        `);
    } catch (_) {
        // column already exists → ignore
    }

    console.log("✅ Database initialized successfully");
}


initDB().catch((err) => {
    console.error("❌ DB init failed:", err);
    process.exit(1);
});