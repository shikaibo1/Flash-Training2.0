from __future__ import annotations
import json
import sqlite3
from ...domain.models import JsonObject
from ..serialization import dump


class DiagnosisRepository:
    """One immutable, rule-scored diagnosis per completed practice session."""
    def __init__(self, connection: sqlite3.Connection):
        self._conn = connection

    def get(self, session_id: str, user_id: str) -> JsonObject | None:
        record = self._conn.execute(
            "SELECT payload_json FROM bridge_diagnoses WHERE session_id=? AND user_id=?",
            (session_id, user_id)).fetchone()
        return json.loads(record[0]) if record else None

    def add(self, session_id: str, user_id: str, payload: JsonObject, stamp: str) -> None:
        self._conn.execute("INSERT INTO bridge_diagnoses(session_id,user_id,payload_json,created_at) VALUES (?,?,?,?)",
                           (session_id, user_id, dump(payload), stamp))
