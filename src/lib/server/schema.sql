-- microscape-app database schema
-- Gatekeeper for pipeline-run outputs: auth/tenancy borrowed from sampletown,
-- plus pipelines / runs / run_access tables that model the access surface.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- LABS (tenant boundary)
--
-- Every run carries a lab_id. Users see runs in labs they belong to, plus
-- runs where they hold an explicit run_access row. A single install can
-- host multiple labs; new labs are created via scripts/create-lab.mjs.
-- ============================================================
CREATE TABLE IF NOT EXISTS labs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    github_repo TEXT,
    github_token TEXT,
    backup_interval_hours INTEGER,
    last_backup_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- USERS & AUTH
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    -- The lab currently being viewed. Null for fresh signups without a
    -- membership (forced through /auth/setup-lab).
    active_lab_id TEXT REFERENCES labs(id),
    -- Legacy column retained so `SELECT *` still works on migrated data.
    lab_id TEXT REFERENCES labs(id),
    github_id INTEGER UNIQUE,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT,
    email TEXT,
    avatar_url TEXT,
    avatar_emoji TEXT,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer')),
    is_local_account INTEGER NOT NULL DEFAULT 0,
    is_demo INTEGER NOT NULL DEFAULT 0,
    is_approved INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_active_lab ON users(active_lab_id);

CREATE TABLE IF NOT EXISTS lab_memberships (
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lab_id   TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
    role     TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer')),
    status   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    added_by TEXT REFERENCES users(id),
    PRIMARY KEY (user_id, lab_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_memberships_lab ON lab_memberships(lab_id);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- LAB INVITES
-- ============================================================
CREATE TABLE IF NOT EXISTS invites (
    token TEXT PRIMARY KEY,
    lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer')),
    email_hint TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    used_at TEXT,
    used_by TEXT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_invites_lab ON invites(lab_id);

-- ============================================================
-- PIPELINES
--
-- Global list of pipelines that produce gated outputs (microscape-nf,
-- danaseq-*). Not lab-scoped: the same pipeline feeds runs across many labs.
-- Seeded idempotently on first startup from scripts/seed-pipelines.mjs.
-- ============================================================
CREATE TABLE IF NOT EXISTS pipelines (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- RUNS
--
-- One run = one output directory (data_path) + one lab_id. Access control
-- is per-run. data_path is an absolute host path that the gated file
-- endpoint uses to resolve X-Accel-Redirect internal URIs. Registering a
-- run does not copy or move the underlying directory.
-- ============================================================
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE RESTRICT,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    data_path TEXT NOT NULL,
    -- When 1, any authenticated user can read the run — used for
    -- demo/showcase runs. ACL checks are skipped but the login wall is
    -- still in force.
    is_public INTEGER NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(lab_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_runs_lab ON runs(lab_id);
CREATE INDEX IF NOT EXISTS idx_runs_pipeline ON runs(pipeline_id);

-- ============================================================
-- RUN ACCESS
--
-- Per-user grants. Lab members of the run's lab already see it implicitly;
-- run_access exists to grant cross-lab collaborators a narrower view of a
-- single run without also admitting them to lab-wide data.
-- ============================================================
CREATE TABLE IF NOT EXISTS run_access (
    run_id   TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role     TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'user', 'admin')),
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    added_by TEXT REFERENCES users(id),
    PRIMARY KEY (run_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_run_access_user ON run_access(user_id);

-- ============================================================
-- FEEDBACK
-- ============================================================
CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    lab_id TEXT REFERENCES labs(id) ON DELETE CASCADE,
    page_url TEXT NOT NULL,
    message TEXT NOT NULL,
    user_id TEXT REFERENCES users(id),
    username TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'wontfix')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_lab ON feedback(lab_id);

-- ============================================================
-- DB SNAPSHOTS (per-lab GitHub backup history)
-- ============================================================
CREATE TABLE IF NOT EXISTS db_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
    commit_sha TEXT,
    commit_message TEXT,
    snapshot_path TEXT,
    error_message TEXT,
    is_automatic INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'committed', 'pushed', 'failed'
    )),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_snapshots_lab ON db_snapshots(lab_id);
