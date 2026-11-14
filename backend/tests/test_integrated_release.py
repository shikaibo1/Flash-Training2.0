"""Regression checks for merging the two previously independent v3 feature sets."""
import json
import tempfile
import unittest
from pathlib import Path
from app.bootstrap import build_services
from app.domain.project_commands import ProjectCreate, ProjectAction
from app.infrastructure.database import Database, SCHEMA, BRIDGE_SCHEMA
from app.infrastructure.project_migration import PROJECT_SCHEMA
from app.infrastructure.catalog_seed import seed_catalog
from app.infrastructure.unit_of_work import SQLiteUnitOfWorkFactory
from app.settings import Settings
from tests import test_training as legacy


class IntegratedReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.db=Database(self.root/'test.sqlite3')

    def tearDown(self):
        self.tmp.cleanup()

    def legacy_v3(self, feature):
        with self.db.transaction() as c:
            for statement in (SCHEMA+';'+feature).split(';'):
                if statement.strip(): c.execute(statement)
            c.execute('PRAGMA user_version=3')
        seed_catalog(self.db,Settings().catalog_path)
        return build_services(SQLiteUnitOfWorkFactory(self.db),legacy.FakeAI())

    def assert_both_stores(self):
        self.assertEqual(self.db.check_health(),5)
        with self.db.read() as c:
            tables={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertTrue({'learning_projects','project_operations','project_observations','bridge_diagnoses'}<=tables)
            self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertFalse(c.execute('PRAGMA foreign_key_check').fetchall())

    def test_projects_v3_upgrade_preserves_saved_project_and_revision(self):
        services=self.legacy_v3(PROJECT_SCHEMA)
        p=services.projects.create(ProjectCreate(user_id="learner", request_id='saved',goal='保留我的学习目标',source_text='已有资料'))
        with self.db.read() as c: original=c.execute('SELECT payload_json FROM learning_projects').fetchone()[0]
        self.db.initialize(); self.db.initialize()
        self.assert_both_stores()
        with self.db.read() as c: self.assertEqual(c.execute('SELECT payload_json FROM learning_projects').fetchone()[0],original)
        self.assertEqual(services.projects.get(p.project_id,p.user_id).revision,0)
        self.assertEqual(len(list((self.root/'backups').glob('*.sqlite3'))),1)

    def test_bridge_v3_upgrade_preserves_completed_diagnosis_and_history(self):
        services=self.legacy_v3(BRIDGE_SCHEMA)
        session=services.practice.start('u','t_conversion',{'mode':'independent','bridge_case_id':'conversion_baseline'})
        services.practice.submit('u',session.session_id,'A=80/1000=8%，B=72/800=9%；窗口7天一致，不能推断因果。',False)
        answers={'formula':'purchase_over_visitors','denominator':'all_new_visitors','comparability':'align_window'}
        services.bridge.diagnose('u',session.session_id,answers)
        with self.db.read() as c:
            old=c.execute('SELECT * FROM bridge_diagnoses').fetchall()
            histories=c.execute('SELECT payload_json FROM practice_records').fetchall()
        self.db.initialize()
        self.assert_both_stores()
        with self.db.read() as c:
            self.assertEqual([tuple(r) for r in c.execute('SELECT * FROM bridge_diagnoses')],[tuple(r) for r in old])
            self.assertEqual([tuple(r) for r in c.execute('SELECT payload_json FROM practice_records')],[tuple(r) for r in histories])
        self.assertEqual(services.bridge.details('u',session.session_id)['diagnosis']['result']['answers'],answers)

    def test_fresh_database_supports_both_services_and_comparison(self):
        self.db.initialize(); seed_catalog(self.db,Settings().catalog_path)
        services=build_services(SQLiteUnitOfWorkFactory(self.db),legacy.FakeAI())
        baseline=services.practice.start('u','t_conversion',{'mode':'independent','bridge_case_id':'conversion_baseline'})
        answer='A=80/1000=8%，B=72/800=9%；同窗口可作描述比较，不推断因果。'
        services.practice.submit('u',baseline.session_id,answer,False)
        variant=services.practice.start('u','t_conversion',{'mode':'transfer','bridge_case_id':'conversion_representation','source_session_id':baseline.session_id})
        self.assertFalse(variant.content.example_answer)
        services.practice.submit('u',variant.session_id,answer,False)
        self.assertEqual(services.bridge.details('u',variant.session_id)['comparison']['status'],'comparable')
        self.assertEqual(services.practice.session_details('u',variant.session_id).bridge_case_id,'conversion_representation')
        p=services.projects.create(ProjectCreate(user_id="learner", request_id='coexist',goal='另一个学习目标'))
        self.assertEqual(p.status,'pending')
        self.assert_both_stores()

    def test_partial_project_schema_fails_without_marking_upgrade_complete(self):
        with self.db.transaction() as c:
            for statement in SCHEMA.split(';'):
                if statement.strip(): c.execute(statement)
            c.execute('CREATE TABLE learning_projects(id TEXT)')
            c.execute('PRAGMA user_version=3')
        with self.assertRaisesRegex(RuntimeError,'Incomplete'): self.db.initialize()
        self.assertEqual(self.db.check_health(),3)
