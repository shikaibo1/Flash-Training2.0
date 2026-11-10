"""Additive v2 -> v3 migration. No legacy rows are updated or discarded."""
PROJECT_SCHEMA = """
CREATE TABLE learning_projects (
    project_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id),
    create_request TEXT NOT NULL, create_fingerprint TEXT NOT NULL,
    revision INTEGER NOT NULL, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL,
    UNIQUE(user_id,create_request)
);
CREATE INDEX projects_user_idx ON learning_projects(user_id,updated_at);
CREATE TABLE project_operations (
    project_id TEXT NOT NULL REFERENCES learning_projects(project_id), request_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('running','done')),
    expires_at REAL NOT NULL, PRIMARY KEY(project_id,request_id)
);
CREATE TABLE project_observations (
    observation_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES learning_projects(project_id),
    user_id TEXT NOT NULL REFERENCES users(user_id), round_id TEXT NOT NULL,
    atomic_skill_id TEXT NOT NULL REFERENCES atomic_skills(atomic_skill_id),
    created_at TEXT NOT NULL, payload_json TEXT NOT NULL,
    UNIQUE(project_id,round_id,atomic_skill_id)
);
CREATE INDEX project_obs_user_idx ON project_observations(user_id,created_at);
"""
