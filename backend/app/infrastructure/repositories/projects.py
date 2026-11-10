from __future__ import annotations
import hashlib
import json
import time
from ...domain.projects import LearningProject, ProjectObservation
from ...errors import AppError
from ..serialization import dump


def fingerprint(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


class ProjectRepository:
    def __init__(self, connection):
        self._conn = connection

    def get(self, project_id: str, user_id: str) -> LearningProject:
        row = self._conn.execute("SELECT payload_json FROM learning_projects WHERE project_id=? AND user_id=?", (project_id, user_id)).fetchone()
        if not row:
            raise AppError("学习项目不存在。", 404, "project_not_found")
        return LearningProject.model_validate_json(row[0])

    def list(self, user_id: str) -> list[LearningProject]:
        return [LearningProject.model_validate_json(row[0]) for row in self._conn.execute(
            "SELECT payload_json FROM learning_projects WHERE user_id=? ORDER BY updated_at DESC", (user_id,))]

    def created(self, user_id: str, request_id: str, values) -> LearningProject | None:
        row = self._conn.execute("SELECT payload_json,create_fingerprint FROM learning_projects WHERE user_id=? AND create_request=?", (user_id, request_id)).fetchone()
        if not row:
            return None
        if row[1] != fingerprint(values):
            raise AppError("这个请求标识已用于其他目标。", 409, "idempotency_conflict")
        return LearningProject.model_validate_json(row[0])

    def add(self, project: LearningProject, request_id: str, values):
        self._conn.execute("INSERT INTO learning_projects VALUES (?,?,?,?,?,?,?)", (project.project_id, project.user_id, request_id,
            fingerprint(values), project.revision, project.updated_at, dump(project)))

    def save(self, project: LearningProject, expected: int):
        count = self._conn.execute("UPDATE learning_projects SET revision=?,updated_at=?,payload_json=? WHERE project_id=? AND revision=?",
            (project.revision, project.updated_at, dump(project), project.project_id, expected)).rowcount
        if not count:
            raise AppError("学习进度已在另一窗口更新，请刷新后继续。", 409, "project_revision_conflict")

    def claim(self, project: LearningProject, request_id: str, values) -> bool:
        digest, now = fingerprint(values), time.time()
        row = self._conn.execute("SELECT fingerprint,state,expires_at FROM project_operations WHERE project_id=? AND request_id=?", (project.project_id, request_id)).fetchone()
        if row:
            if row[0] != digest:
                raise AppError("这个请求标识已用于其他操作。", 409, "idempotency_conflict")
            if row[1] == "done":
                return False
        running = self._conn.execute("SELECT 1 FROM project_operations WHERE project_id=? AND state='running' AND expires_at>?", (project.project_id, now)).fetchone()
        if running:
            raise AppError("本项目正在处理上一次操作，请稍后刷新。", 409, "project_busy")
        self._conn.execute("INSERT INTO project_operations VALUES (?,?,?,'running',?) ON CONFLICT(project_id,request_id) DO UPDATE SET state='running',expires_at=excluded.expires_at",
            (project.project_id, request_id, digest, now + 360))
        return True

    def done(self, project_id: str, request_id: str):
        self._conn.execute("UPDATE project_operations SET state='done' WHERE project_id=? AND request_id=?", (project_id, request_id))

    def release(self, project_id: str, request_id: str):
        self._conn.execute("DELETE FROM project_operations WHERE project_id=? AND request_id=? AND state='running'", (project_id, request_id))

    def add_observation(self, observation: ProjectObservation):
        self._conn.execute("INSERT INTO project_observations VALUES (?,?,?,?,?,?,?)", (observation.observation_id, observation.project_id,
            observation.user_id, observation.round_id, observation.atomic_skill_id, observation.created_at, dump(observation)))

    def observations(self, user_id: str) -> list[ProjectObservation]:
        return [ProjectObservation.model_validate_json(row[0]) for row in self._conn.execute(
            "SELECT payload_json FROM project_observations WHERE user_id=? ORDER BY created_at DESC,rowid DESC", (user_id,))]

    def busy(self, project_id: str) -> bool:
        return self._conn.execute("SELECT 1 FROM project_operations WHERE project_id=? AND state='running' AND expires_at>?", (project_id,time.time())).fetchone() is not None
