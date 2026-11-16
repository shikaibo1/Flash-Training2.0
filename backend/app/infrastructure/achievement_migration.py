ACHIEVEMENT_SCHEMA = """
CREATE TABLE achievement_awards (
    user_id TEXT NOT NULL REFERENCES users(user_id),
    achievement_id TEXT NOT NULL,
    rule_version INTEGER NOT NULL CHECK(rule_version >= 1),
    achieved_at TEXT NOT NULL,
    awarded_at TEXT NOT NULL,
    source_path TEXT NOT NULL,
    source_label TEXT NOT NULL,
    seen_at TEXT,
    PRIMARY KEY(user_id, achievement_id)
);
"""
