ACCOUNT_SCHEMA = """
CREATE TABLE accounts (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id),
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL
);
CREATE TABLE auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts(user_id),
    expires_at INTEGER NOT NULL
);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);
CREATE TABLE auth_attempts (
    bucket TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    attempts INTEGER NOT NULL
);
"""
