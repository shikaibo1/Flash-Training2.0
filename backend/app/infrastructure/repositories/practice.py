from __future__ import annotations
import json
import sqlite3
import uuid
from ...domain.models import Evaluation, PracticeRecord, PracticeSession, SessionHistory
from ...errors import AppError
from ..serialization import dump


class PracticeRepository:
    def __init__(self, connection: sqlite3.Connection):
        self._conn = connection

    @staticmethod
    def _session(row: sqlite3.Row) -> PracticeSession:
        result = json.loads(row["result_json"] or "null")
        if result is not None:
            result = Evaluation.model_validate(result)
        return PracticeSession(session_id=row["session_id"], user_id=row["user_id"], skill_id=row["skill_id"],
            content=json.loads(row["content_json"]), skill_snapshot=json.loads(row["skill_snapshot_json"]),
            atom_snapshot=json.loads(row["atom_snapshot_json"]),
            params=json.loads(row["params_json"]), status=row["status"], started_at=row["started_at"],
            completed_at=row["completed_at"], result=result, provenance=row["provenance"])

    def get(self, session_id: str, user_id: str) -> PracticeSession:
        row = self._conn.execute("SELECT * FROM practice_sessions WHERE session_id=? AND user_id=?",
                                 (session_id, user_id)).fetchone()
        if not row:
            raise AppError("练习会话不存在", 404, "session_not_found")
        return self._session(row)

    def add(self, session: PracticeSession) -> None:
        self._conn.execute("""INSERT INTO practice_sessions
            (session_id,user_id,skill_id,content_json,skill_snapshot_json,atom_snapshot_json,params_json,status,started_at)
            VALUES (?,?,?,?,?,?,?,?,?)""", (session.session_id, session.user_id, session.skill_id,
            dump(session.content), dump(session.skill_snapshot), dump([a.model_dump(mode="json") for a in session.atom_snapshot]),
            dump(session.params), session.status, session.started_at))

    def complete(self, session_id: str, answer: str, result: Evaluation, stamp: str) -> None:
        self._conn.execute("INSERT INTO practice_attempts VALUES (?,?,?,?,?)",
                           (uuid.uuid4().hex, session_id, answer, dump(result), stamp))
        self._conn.execute("UPDATE practice_sessions SET status='completed',completed_at=?,result_json=? WHERE session_id=?",
                           (stamp, dump(result), session_id))

    def latest_answer(self, session_id: str) -> str | None:
        row = self._conn.execute("""SELECT answer FROM practice_attempts WHERE session_id=?
            ORDER BY created_at DESC,rowid DESC LIMIT 1""", (session_id,)).fetchone()
        return row[0] if row else None

    def record_id(self, session_id: str) -> str | None:
        row = self._conn.execute("SELECT record_id FROM practice_records WHERE session_id=?", (session_id,)).fetchone()
        return row[0] if row else None

    def add_record(self, record: PracticeRecord) -> None:
        self._conn.execute("""INSERT INTO practice_records
            (record_id,session_id,user_id,skill_id,score,started_at,ended_at,payload_json,provenance)
            VALUES (?,?,?,?,?,?,?,?,?)""", (record.record_id, record.session_id, record.user_id, record.skill_id,
            record.score, record.start_time, record.end_time, dump(record), record.provenance))

    def records(self, user_id: str) -> list[PracticeRecord]:
        records = []
        for row in self._conn.execute("""SELECT * FROM practice_records WHERE user_id=? AND deleted_at IS NULL
            ORDER BY julianday(started_at) DESC,rowid DESC""", (user_id,)):
            payload = json.loads(row["payload_json"])
            # Indexed columns remain canonical for list and replay responses.
            payload.update(record_id=row["record_id"], user_id=row["user_id"], skill_id=row["skill_id"],
                           session_id=row["session_id"], score=row["score"], start_time=row["started_at"],
                           end_time=row["ended_at"], provenance=row["provenance"])
            records.append(PracticeRecord.model_validate(payload))
        return records

    def delete_record(self, record_id: str, user_id: str, stamp: str) -> None:
        result = self._conn.execute("""UPDATE practice_records SET deleted_at=?
            WHERE record_id=? AND user_id=? AND deleted_at IS NULL""", (stamp, record_id, user_id))
        if not result.rowcount:
            raise AppError("练习记录不存在", 404, "record_not_found")

    def history(self, user_id: str, skill_id: str | None = None) -> list[SessionHistory]:
        sql, args = "SELECT * FROM practice_sessions WHERE user_id=?", [user_id]
        if skill_id:
            sql += " AND skill_id=?"
            args.append(skill_id)
        values = []
        for row in self._conn.execute(sql + " ORDER BY julianday(started_at) DESC,rowid DESC", args):
            session = self._session(row)
            values.append(SessionHistory(session_id=session.session_id, user_id=session.user_id,
                skill_id=session.skill_id, content=session.content, question=session.content.title,
                status=session.status, start_time=session.started_at, end_time=session.completed_at,
                final_result=session.result, mode=session.params["mode"],
                bridge_case_id=session.params.get("bridge_case_id"), source_session_id=session.params.get("source_session_id")))
        return values
