from __future__ import annotations
import sqlite3
from ...domain.achievements import AchievementAward


class AchievementRepository:
    def __init__(self, connection: sqlite3.Connection):
        self._conn = connection

    def list(self, user_id: str) -> list[AchievementAward]:
        return [AchievementAward(**dict(row)) for row in self._conn.execute(
            'SELECT achievement_id,rule_version,achieved_at,awarded_at,source_path,source_label,seen_at '
            'FROM achievement_awards WHERE user_id=? ORDER BY achieved_at,achievement_id', (user_id,))]

    def add(self, user_id: str, award: AchievementAward) -> None:
        self._conn.execute('INSERT INTO achievement_awards '
            '(user_id,achievement_id,rule_version,achieved_at,awarded_at,source_path,source_label,seen_at) '
            'VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,achievement_id) DO NOTHING',
            (user_id, award.achievement_id, award.rule_version, award.achieved_at,
             award.awarded_at, award.source_path, award.source_label, award.seen_at))

    def mark_seen(self, user_id: str, ids: list[str], stamp: str) -> None:
        self._conn.executemany('UPDATE achievement_awards SET seen_at=COALESCE(seen_at,?) '
            'WHERE user_id=? AND achievement_id=?', [(stamp, user_id, value) for value in ids])
