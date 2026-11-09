"""SQLite schema and connection lifecycle; writes use explicit transactions."""
from __future__ import annotations
import sqlite3
from contextlib import contextmanager
from pathlib import Path

SCHEMA_VERSION = 3
BRIDGE_SCHEMA = """
CREATE TABLE bridge_diagnoses (
    session_id TEXT PRIMARY KEY REFERENCES practice_sessions(session_id),
    user_id TEXT NOT NULL REFERENCES users(user_id),
    payload_json TEXT NOT NULL, created_at TEXT NOT NULL
)
"""
SCHEMA = """
CREATE TABLE users (user_id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE atomic_skills (
    atomic_skill_id TEXT PRIMARY KEY, name TEXT NOT NULL,
    description TEXT NOT NULL, categories_json TEXT NOT NULL DEFAULT '[]',
    definition_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE skills (
    skill_id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL, description TEXT NOT NULL,
    generate_prompt TEXT NOT NULL DEFAULT '', evaluate_prompt TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    default_params_json TEXT NOT NULL DEFAULT '{}', deleted_at TEXT,
    task_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE roles (role_id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL);
CREATE TABLE knowledge_concepts (
    knowledge_id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, course TEXT NOT NULL
);
CREATE TABLE catalog_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE skill_atoms (
    skill_id TEXT NOT NULL REFERENCES skills(skill_id),
    atomic_skill_id TEXT NOT NULL REFERENCES atomic_skills(atomic_skill_id),
    position INTEGER NOT NULL,
    PRIMARY KEY(skill_id, atomic_skill_id)
);
CREATE TABLE practice_sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    skill_id TEXT NOT NULL REFERENCES skills(skill_id),
    content_json TEXT NOT NULL, skill_snapshot_json TEXT NOT NULL, atom_snapshot_json TEXT NOT NULL,
    params_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK(status IN ('active','completed')),
    started_at TEXT NOT NULL, completed_at TEXT, result_json TEXT,
    provenance TEXT NOT NULL DEFAULT 'live'
);
CREATE INDEX sessions_user_idx ON practice_sessions(user_id, started_at);
CREATE TABLE practice_attempts (
    attempt_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES practice_sessions(session_id),
    answer TEXT NOT NULL, evaluation_json TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(session_id, attempt_id)
);
CREATE TABLE practice_records (
    record_id TEXT PRIMARY KEY,
    session_id TEXT UNIQUE REFERENCES practice_sessions(session_id),
    user_id TEXT NOT NULL REFERENCES users(user_id),
    skill_id TEXT NOT NULL REFERENCES skills(skill_id),
    score REAL NOT NULL CHECK(score >= 0 AND score <= 100),
    started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
    payload_json TEXT NOT NULL, deleted_at TEXT,
    provenance TEXT NOT NULL DEFAULT 'live'
);
CREATE INDEX records_user_idx ON practice_records(user_id, started_at);
CREATE TABLE atom_evidence (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES practice_sessions(session_id),
    user_id TEXT NOT NULL REFERENCES users(user_id),
    atomic_skill_id TEXT NOT NULL REFERENCES atomic_skills(atomic_skill_id),
    context TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('guided','independent','transfer')),
    assistance_used INTEGER NOT NULL CHECK(assistance_used IN (0,1)),
    status TEXT NOT NULL CHECK(status IN ('observed','not_observable')),
    score REAL CHECK(score >= 0 AND score <= 10),
    quote TEXT NOT NULL, reason TEXT NOT NULL, next_action TEXT NOT NULL, created_at TEXT NOT NULL,
    CHECK((status='observed' AND score IS NOT NULL) OR (status='not_observable' AND score IS NULL)),
    UNIQUE(session_id, atomic_skill_id)
);
CREATE INDEX evidence_user_atom_idx ON atom_evidence(user_id, atomic_skill_id, created_at, event_id);
"""


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)

    def connect(self):
        conn = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=15000")
        return conn

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = self.connect()
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("BEGIN IMMEDIATE")
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version > SCHEMA_VERSION:
                raise RuntimeError("Database schema is newer than this application")
            if version not in (0, 2, SCHEMA_VERSION):
                raise RuntimeError("This application supports schema v2 or v3; schema v1 requires a new database path. Existing data was not modified.")
            if version == 0:
                if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1").fetchone():
                    raise RuntimeError("The selected database is not empty; select a new database path.")
                for statement in SCHEMA.split(";"):
                    if statement.strip():
                        conn.execute(statement)
            if version in (0, 2):
                conn.execute(BRIDGE_SCHEMA)
                conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    def check_health(self) -> int:
        with self.read() as connection:
            return connection.execute("PRAGMA user_version").fetchone()[0]

    @contextmanager
    def read(self):
        conn = self.connect()
        try:
            # A consistent snapshot for multi-query reads.
            conn.execute("PRAGMA query_only=ON")
            conn.execute("BEGIN")
            yield conn
        finally:
            conn.rollback()
            conn.close()

    @contextmanager
    def transaction(self):
        conn = self.connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()
