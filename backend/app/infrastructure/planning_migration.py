"""Project observations reference immutable project definitions, not public catalog rows."""
import json
from ..domain.models import AtomicSkill

PROJECT_ATOM_SCHEMA = """
CREATE TABLE project_atom_snapshots (
    project_id TEXT NOT NULL REFERENCES learning_projects(project_id),
    atomic_skill_id TEXT NOT NULL,
    definition_json TEXT NOT NULL,
    PRIMARY KEY(project_id,atomic_skill_id)
)
"""
OBSERVATION_SCHEMA = """
CREATE TABLE project_observations_v7 (
    observation_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES learning_projects(project_id),
    user_id TEXT NOT NULL REFERENCES users(user_id), round_id TEXT NOT NULL,
    atomic_skill_id TEXT NOT NULL,
    created_at TEXT NOT NULL, payload_json TEXT NOT NULL,
    UNIQUE(project_id,round_id,atomic_skill_id),
    FOREIGN KEY(project_id,atomic_skill_id) REFERENCES project_atom_snapshots(project_id,atomic_skill_id)
)
"""


def migrate_planning(connection):
    connection.execute(PROJECT_ATOM_SCHEMA)
    for row in connection.execute('SELECT project_id,payload_json FROM learning_projects').fetchall():
        payload = json.loads(row[1])
        for atom in payload.get('atoms', []):
            connection.execute('INSERT INTO project_atom_snapshots VALUES (?,?,?)',
                (row[0], atom['atomic_skill_id'], json.dumps(AtomicSkill.model_validate(atom).model_dump(mode='json'), ensure_ascii=False, allow_nan=False)))
    connection.execute(OBSERVATION_SCHEMA)
    # Existing observation bytes and identifiers remain unchanged. Invalid references abort safely.
    connection.execute('INSERT INTO project_observations_v7 SELECT * FROM project_observations')
    connection.execute('DROP TABLE project_observations')
    connection.execute('ALTER TABLE project_observations_v7 RENAME TO project_observations')
    connection.execute('CREATE INDEX project_obs_user_idx ON project_observations(user_id,created_at)')
