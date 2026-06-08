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
    await db.execute(`
        CREATE TABLE IF NOT EXISTS teams (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            manager_id TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `
        );
    await db.execute(`
        CREATE TABLE IF NOT EXISTS boards (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'manual',
            linked_project TEXT DEFAULT NULL,
            visibility TEXT NOT NULL DEFAULT 'private',
            team_id TEXT DEFAULT NULL,
            owner_email TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS board_columns (
            id TEXT PRIMARY KEY,
            board_id TEXT NOT NULL,
            name TEXT NOT NULL,
            slug TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (board_id)
                REFERENCES boards(id)
                ON DELETE CASCADE,
            UNIQUE(board_id, slug)
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            board_id TEXT NOT NULL,
            column_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            priority TEXT NOT NULL DEFAULT 'medium',
            status_slug TEXT NOT NULL,
            due_date TEXT DEFAULT NULL,
            complexity INTEGER DEFAULT NULL,
            assignee_email TEXT DEFAULT NULL,
            created_by_email TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (board_id)
                REFERENCES boards(id)
                ON DELETE CASCADE,
            FOREIGN KEY (column_id)
                REFERENCES board_columns(id)
                ON DELETE RESTRICT
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS task_history (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            board_id TEXT NOT NULL,
            from_column_id TEXT DEFAULT NULL,
            to_column_id TEXT DEFAULT NULL,
            from_status_slug TEXT DEFAULT NULL,
            to_status_slug TEXT DEFAULT NULL,
            moved_by_email TEXT NOT NULL,
            note TEXT DEFAULT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (board_id)
                REFERENCES boards(id)
                ON DELETE CASCADE
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS board_metrics (
            board_id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (board_id)
                REFERENCES boards(id)
                ON DELETE CASCADE
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS task_signals (
            id TEXT PRIMARY KEY,
            board_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            signal_type TEXT NOT NULL,
            severity TEXT NOT NULL,
            message TEXT NOT NULL,
            details TEXT NOT NULL DEFAULT '{}',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (board_id)
                REFERENCES boards(id)
                ON DELETE CASCADE
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS team_members (
            team_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            PRIMARY KEY (team_id, user_id),
            FOREIGN KEY (team_id)
                REFERENCES teams(id)
                ON DELETE CASCADE,
            FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE CASCADE)
    `
        );
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

    try {
        await db.execute(`
            ALTER TABLE users ADD COLUMN role TEXT DEFAULT NULL
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