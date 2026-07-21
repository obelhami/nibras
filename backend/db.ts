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
            is_verified INTEGER NOT NULL DEFAULT 0,
            external_source TEXT DEFAULT NULL,
            external_id TEXT DEFAULT NULL
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
            external_source TEXT DEFAULT NULL,
            external_id TEXT DEFAULT NULL,
            linked_project TEXT DEFAULT NULL,
            visibility TEXT NOT NULL DEFAULT 'private',
            team_id TEXT DEFAULT NULL,
            owner_email TEXT NOT NULL,
            sync_status TEXT DEFAULT NULL,
            sync_error TEXT DEFAULT NULL,
            last_synced_at TEXT DEFAULT NULL,
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
            external_source TEXT DEFAULT NULL,
            external_id TEXT DEFAULT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            last_synced_at TEXT DEFAULT NULL,
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
            assignee_id TEXT DEFAULT NULL,
            external_source TEXT DEFAULT NULL,
            external_id TEXT DEFAULT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            sync_error TEXT DEFAULT NULL,
            last_synced_at TEXT DEFAULT NULL,
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
    // KPI ENGINE (Module 6)
    // Append-only store of every computed KPI run (Store KPI step of the flow).
    await db.execute(`
        CREATE TABLE IF NOT EXISTS kpi_snapshots (
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,            -- 'board' | 'team' | 'user'
            scope_id TEXT NOT NULL,         -- board id / team id / user email
            kpi_type TEXT NOT NULL,         -- 'operational' | 'focus_score' | 'team_pulse'
            payload TEXT NOT NULL,          -- JSON metrics snapshot
            generated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
    // AI ENGINE (Module 8 — AI-01 Recommendation Engine)
    // Every generated recommendation is stored as `pending`: the AI never takes
    // automatic decisions, a manager must accept or dismiss each insight.
    await db.execute(`
        CREATE TABLE IF NOT EXISTS ai_insights (
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,            -- 'team' (AI-01) | 'board' (AI-02 Sprint Doctor)
            scope_id TEXT NOT NULL,
            type TEXT NOT NULL,             -- rule id, e.g. 'review_saturation'
            severity TEXT NOT NULL,         -- 'info' | 'warning' | 'critical'
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            evidence TEXT NOT NULL DEFAULT '{}',  -- JSON numbers that triggered the rule
            confidence REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'dismissed'
            validated_by_email TEXT DEFAULT NULL,
            validated_at TEXT DEFAULT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
    // Upgrade a legacy empty `ai_insights` table (target_type/target_id/category,
    // no validation columns) to the Module 8 schema. Each step is safe to re-run.
    const aiInsightMigrations = [
        `ALTER TABLE ai_insights RENAME COLUMN target_type TO scope`,
        `ALTER TABLE ai_insights RENAME COLUMN target_id TO scope_id`,
        `ALTER TABLE ai_insights RENAME COLUMN category TO type`,
        `ALTER TABLE ai_insights ADD COLUMN title TEXT NOT NULL DEFAULT ''`,
        `ALTER TABLE ai_insights ADD COLUMN evidence TEXT NOT NULL DEFAULT '{}'`,
        `ALTER TABLE ai_insights ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`,
        `ALTER TABLE ai_insights ADD COLUMN validated_by_email TEXT DEFAULT NULL`,
        `ALTER TABLE ai_insights ADD COLUMN validated_at TEXT DEFAULT NULL`,
    ];
    for (const migration of aiInsightMigrations) {
        try {
            await db.execute(migration);
        } catch (_) {
            // column already renamed / already exists → ignore
        }
    }
    // History of task re-assignments — feeds the Focus Score "excessive reassignment" indicator.
    await db.execute(`
        CREATE TABLE IF NOT EXISTS task_assignment_history (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            board_id TEXT NOT NULL,
            from_email TEXT DEFAULT NULL,
            to_email TEXT DEFAULT NULL,
            changed_by_email TEXT NOT NULL,
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

    await db.execute(`
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                start_date TEXT,
                end_date TEXT,
                status TEXT NOT NULL DEFAULT 'active',

                created_by TEXT NOT NULL,
                team_id TEXT,

                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS project_teams (
    project_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    PRIMARY KEY (project_id, team_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);
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

    await db.execute(`
        CREATE TABLE IF NOT EXISTS trello_oauth_states (
            state TEXT PRIMARY KEY,
            user_email TEXT NOT NULL,
            team_id TEXT NOT NULL,
            request_token TEXT NOT NULL,
            request_token_secret TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS trello_connections (
            id TEXT PRIMARY KEY,
            user_email TEXT NOT NULL,
            team_id TEXT NOT NULL,
            access_token TEXT DEFAULT NULL,
            token_secret TEXT DEFAULT NULL,
            trello_member_id TEXT DEFAULT NULL,
            trello_member_name TEXT DEFAULT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            last_sync_at TEXT DEFAULT NULL,
            last_error TEXT DEFAULT NULL,
            retry_count INTEGER NOT NULL DEFAULT 0,
            next_sync_at TEXT DEFAULT CURRENT_TIMESTAMP,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_email, team_id)
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS trello_entity_maps (
            id TEXT PRIMARY KEY,
            connection_id TEXT NOT NULL,
            trello_type TEXT NOT NULL,
            trello_id TEXT NOT NULL,
            nibras_type TEXT NOT NULL,
            nibras_id TEXT NOT NULL,
            parent_trello_id TEXT DEFAULT NULL,
            payload TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(connection_id, trello_type, trello_id)
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS trello_sync_jobs (
            id TEXT PRIMARY KEY,
            connection_id TEXT NOT NULL,
            job_type TEXT NOT NULL DEFAULT 'sync_connection',
            payload TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'queued',
            attempts INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 5,
            next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_error TEXT DEFAULT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_trello_sync_jobs_due
        ON trello_sync_jobs(status, next_attempt_at)
    `);

    // The remote DB may hold a legacy trello_connections table (user_id/board_id
    // schema) that CREATE TABLE IF NOT EXISTS silently skips — rebuild it.
    const trelloConnectionsInfo = await db.execute(`PRAGMA table_info(trello_connections)`);
    const hasTrelloUserEmail = trelloConnectionsInfo.rows.some(
        (row) => (row as unknown as { name: string }).name === 'user_email',
    );
    if (!hasTrelloUserEmail) {
        const legacyRows = await db.execute(`SELECT COUNT(*) AS c FROM trello_connections`);
        const legacyCount = Number((legacyRows.rows[0] as unknown as { c: number | string }).c ?? 0);
        if (legacyCount > 0) {
            await db.execute(`ALTER TABLE trello_connections RENAME TO trello_connections_legacy`);
        } else {
            await db.execute(`DROP TABLE trello_connections`);
        }
        await db.execute(`
            CREATE TABLE trello_connections (
                id TEXT PRIMARY KEY,
                user_email TEXT NOT NULL,
                team_id TEXT NOT NULL,
                access_token TEXT DEFAULT NULL,
                token_secret TEXT DEFAULT NULL,
                trello_member_id TEXT DEFAULT NULL,
                trello_member_name TEXT DEFAULT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                last_sync_at TEXT DEFAULT NULL,
                last_error TEXT DEFAULT NULL,
                retry_count INTEGER NOT NULL DEFAULT 0,
                next_sync_at TEXT DEFAULT CURRENT_TIMESTAMP,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_email, team_id)
            )
        `);
    }

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

    try {
        await db.execute(`
            ALTER TABLE users ADD COLUMN external_source TEXT DEFAULT NULL
        `);
    } catch (_) {
        // column already exists → ignore
    }

    try {
        await db.execute(`
            ALTER TABLE users ADD COLUMN external_id TEXT DEFAULT NULL
        `);
    } catch (_) {
        // column already exists → ignore
    }

    try {
        await db.execute(`
            ALTER TABLE boards ADD COLUMN external_source TEXT DEFAULT NULL
        `);
    } catch (_) {}

    try {
        await db.execute(`
            ALTER TABLE boards ADD COLUMN external_id TEXT DEFAULT NULL
        `);
    } catch (_) {}

    try {
        await db.execute(`
            ALTER TABLE boards ADD COLUMN sync_status TEXT DEFAULT NULL
        `);
    } catch (_) {}

    try {
        await db.execute(`
            ALTER TABLE boards ADD COLUMN sync_error TEXT DEFAULT NULL
        `);
    } catch (_) {}

    try {
        await db.execute(`
            ALTER TABLE boards ADD COLUMN last_synced_at TEXT DEFAULT NULL
        `);
    } catch (_) {}

    try {
        await db.execute(`
            ALTER TABLE board_columns ADD COLUMN external_source TEXT DEFAULT NULL
        `);
    } catch (_) {}

    try {
        await db.execute(`
            ALTER TABLE board_columns ADD COLUMN external_id TEXT DEFAULT NULL
        `);
    } catch (_) {}

    try {
        await db.execute(`
            ALTER TABLE board_columns ADD COLUMN last_synced_at TEXT DEFAULT NULL
        `);
    } catch (_) {}

    try {
        await db.execute(`
            ALTER TABLE tasks ADD COLUMN external_source TEXT DEFAULT NULL
        `);
    } catch (_) {}

    try {
        await db.execute(`
            ALTER TABLE tasks ADD COLUMN external_id TEXT DEFAULT NULL
        `);
    } catch (_) {}

    try {
        await db.execute(`
            ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'
        `);
    } catch (_) {}

    try {
        await db.execute(`
            ALTER TABLE tasks ADD COLUMN sync_error TEXT DEFAULT NULL
        `);
    } catch (_) {}

    try {
        await db.execute(`
            ALTER TABLE tasks ADD COLUMN last_synced_at TEXT DEFAULT NULL
        `);
    } catch (_) {}

    // Ensure `updated_at` exists on `projects` for older DBs
    try {
        await db.execute(`
            ALTER TABLE projects ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        `);
    } catch (_) {
        // column already exists → ignore
    }

    // Ensure `assignee_id` exists on `tasks` for older DBs (assignment by team member id)
    try {
        await db.execute(`
            ALTER TABLE tasks ADD COLUMN assignee_id TEXT DEFAULT NULL
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