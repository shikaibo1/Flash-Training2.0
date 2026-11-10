"""Contract and state-machine acceptance tests; never call a paid model."""
import copy
import json
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, closing
from pathlib import Path
from unittest.mock import patch
from app.bootstrap import build_services
from app.domain.project_commands import ProjectCreate, ProjectAction, ProjectDraft
from app.domain.learning_cases import CASE_TASK_ID, JOIN, CHECK, GRAIN
from app.errors import AIError, AppError
from app.infrastructure.database import Database, SCHEMA
from app.infrastructure.unit_of_work import SQLiteUnitOfWorkFactory
from app.infrastructure.catalog_seed import seed_catalog
from app.main import create_app
from app.settings import Settings
from tests import test_training as legacy


class ProjectAI:
    configured = True

    def __init__(self):
        self.calls = []
        self.states = {}
        self.probe_id = ''
        self.override = None
        self.entered = None
        self.release = None

    def generate_json(self, task, payload):
        self.calls.append(copy.deepcopy(payload))
        if self.entered:
            self.entered.set()
            self.release.wait(5)
        findings = []
        for atom in payload['target_atoms']:
            atom_id = atom['atomic_skill_id']
            state = self.states.get(atom_id, 'supported')
            findings.append({'atomic_skill_id': atom_id, 'state': state, 'quote': payload['answer'][:60],
                'reason': '本轮回答与此项量表相符。' if state == 'supported' else '需要确认连接时的重复情况。',
                'next_action': '换新材料独立核验。', 'issue': {'supported':'none','gap':'explicit_error','uncertain':'missing_evidence'}[state]})
        result = {'findings': findings, 'summary':'逐项检查了当前回答。', 'probe_question':'如果同一订单有两条退款，连接后的订单金额出现几次？',
            'probe_atom_id': self.probe_id, 'probe_value':'high' if self.probe_id else 'low', 'decision_reason':'一个小反例可确认关键条件。'}
        return self.override(result) if self.override else result


class ProjectTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.catalog_path = self.root / 'catalog.json'
        self.catalog_path.write_text(json.dumps(legacy.catalog_fixture()), encoding='utf-8')
        self.settings = Settings(database_path=self.root/'test.sqlite3', catalog_path=self.catalog_path)
        self.db = Database(self.settings.database_path)
        self.db.initialize()
        seed_catalog(self.db, self.catalog_path)
        self.work = SQLiteUnitOfWorkFactory(self.db)
        self.ai = ProjectAI()
        self.services = build_services(self.work, self.ai)
        self.svc = self.services.projects

    def tearDown(self):
        self.tmp.cleanup()

    def create(self, **kwargs):
        return self.svc.create(ProjectCreate(request_id='create', goal='学习数据库与订单分析', task_id=CASE_TASK_ID, **kwargs))

    def action(self, p, action, **kwargs):
        return self.svc.act(p.project_id, ProjectAction(request_id=f'{action}-{p.revision}', revision=p.revision,
            action=action, round_id=p.rounds[-1].round_id if p.rounds else None, **kwargs))

    def answer(self, p, number=340, **kwargs):
        return self.action(p, 'answer', answer='分别求订单总额减退款总额；一对多连接会重复订单金额；核对无退款订单。', numeric_answer=number, **kwargs)

    def test_pending_goal_preserved_without_forced_mapping(self):
        p = self.svc.create(ProjectCreate(request_id='new', goal='学习世界历史', source_text='我的阅读资料'))
        self.assertEqual(p.status, 'pending')
        self.assertEqual(p.source_text, '我的阅读资料')
        self.assertFalse(self.ai.calls)
        with self.assertRaises(AppError): self.action(p, 'start')
        p = self.action(p, 'bind', task_id=CASE_TASK_ID)
        self.assertEqual(p.status, 'ready')

    def test_create_retry_and_user_isolation(self):
        p = self.create()
        self.assertEqual(self.create().project_id, p.project_id)
        with self.assertRaises(AppError): self.create(probe_limit=1)
        with self.assertRaises(AppError): self.svc.get(p.project_id, 'other')
        self.assertEqual(self.svc.list('other'), [])

    def test_reference_answers_never_sent_and_snapshot_durable(self):
        p = self.action(self.create(), 'start')
        self.assertIsNone(p.rounds[-1].expected_value)
        self.assertEqual(p.rounds[-1].content.example_answer, '')
        with self.work.read() as u:
            self.assertEqual(u.projects.get(p.project_id,'default_user').rounds[-1].expected_value,340)

    def test_full_evidence_stops_without_probes_one_call(self):
        p = self.answer(self.action(self.create(), 'start'))
        self.assertEqual(p.status, 'review')
        self.assertEqual(p.probes_used,0)
        self.assertEqual(len(self.ai.calls),1)
        self.assertEqual(len(p.rounds),1)

    def test_correct_number_missing_condition_probes_one_atom(self):
        self.ai.states = {JOIN:'uncertain'}; self.ai.probe_id=JOIN
        p = self.answer(self.action(self.create(),'start'))
        self.assertEqual(p.status,'probing')
        self.assertEqual(p.rounds[-1].target_ids,[JOIN])
        self.assertEqual(p.rounds[0].assessment.probe_question,'')
        self.ai.states = {}; self.ai.probe_id=''
        p = self.answer(p,number=None)
        self.assertEqual(p.status,'review')
        self.assertEqual(p.probes_used,1)
        summary = next(a for a in self.services.evidence.dashboard('default_user').atomic_skills if a.atomic_skill_id==JOIN)
        self.assertEqual(summary.contexts[0].status,'assisted')

    def test_explicit_gap_goes_directly_to_support(self):
        self.ai.states={JOIN:'gap',GRAIN:'uncertain'}; self.ai.probe_id=GRAIN
        p=self.answer(self.action(self.create(),'start'))
        self.assertEqual(p.status,'support'); self.assertEqual(p.probes_used,0)

    def test_numeric_guard_overrides_optimistic_model(self):
        p=self.answer(self.action(self.create(),'start'),number=999)
        self.assertEqual(p.status,'support')
        self.assertEqual(next(f for f in p.findings if f.atomic_skill_id==CHECK).state,'gap')

    def test_alternate_method_accepted(self):
        p=self.action(self.create(),'start')
        p=self.action(p,'answer', answer='无需连接，分别汇总orders与refunds再相减，说明各自行粒度并核对无退款订单。',numeric_answer=340)
        self.assertTrue(all(f.state=='supported' for f in p.findings))

    def test_two_probe_budget_and_no_repeat(self):
        self.ai.states={JOIN:'uncertain',GRAIN:'uncertain'}; self.ai.probe_id=JOIN
        p=self.answer(self.action(self.create(),'start'))
        self.ai.probe_id=GRAIN
        p=self.answer(p,number=None)
        self.assertEqual(p.probes_used,2)
        self.ai.probe_id=JOIN
        p=self.answer(p,number=None)
        self.assertEqual(p.status,'support'); self.assertEqual(len(self.ai.calls),3)
        self.assertEqual(p.probes_used,2)

    def test_zero_budget_and_skipping_preserve_uncertainty(self):
        self.ai.states={JOIN:'uncertain'}; self.ai.probe_id=JOIN
        p=self.answer(self.action(self.create(probe_limit=0),'start'))
        self.assertEqual(p.status,'support'); self.assertEqual(p.probes_used,0)
        self.assertEqual(next(f for f in p.findings if f.atomic_skill_id==JOIN).state,'uncertain')

    def test_skip_allows_help_and_new_task(self):
        self.ai.states={JOIN:'uncertain'}; self.ai.probe_id=JOIN
        p=self.answer(self.action(self.create(),'start'))
        p=self.action(p,'skip')
        p=self.action(p,'help',level='explain')
        p=self.action(p,'verify')
        self.assertEqual(p.rounds[-1].stage,'verification')
        self.assertNotEqual(p.rounds[0].content.materials,p.rounds[-1].content.materials)
        self.assertFalse(p.rounds[-1].assistance_used)

    def test_help_and_micro_do_not_create_mastery_observations(self):
        self.ai.states={JOIN:'gap'}
        p=self.answer(self.action(self.create(),'start'))
        with self.work.read() as u: before=len(u.projects.observations('default_user'))
        p=self.action(p,'help',level='micro')
        p=self.action(p,'reflect',answer='直接连接会重复；需要保持订单粒度。')
        with self.work.read() as u: self.assertEqual(len(u.projects.observations('default_user')),before)
        self.assertEqual(p.status,'support')

    def test_learner_can_choose_other_atom_for_help(self):
        self.ai.states={JOIN:'gap',GRAIN:'gap'}
        p=self.answer(self.action(self.create(),'start'))
        p=self.action(p,'help',level='hint',atomic_skill_id=JOIN)
        self.assertEqual(p.interventions[-1].atomic_skill_id,JOIN)
        with self.assertRaises(AppError): self.action(p,'help',atomic_skill_id='unknown')

    def test_independent_retest_success_and_failed_retest_returns_support(self):
        p=self.answer(self.action(self.create(),'start'),number=999)
        p=self.action(p,'help',level='hint')
        p=self.action(p,'verify')
        p=self.answer(p,number=250)
        self.assertEqual(p.status,'completed')
        p=self.action(p,'verify'); p=self.answer(p,number=100)
        self.assertEqual(p.status,'support')
        self.assertTrue(any(f.state=='gap' for f in p.findings))

    def test_assisted_new_task_cannot_complete(self):
        p=self.answer(self.action(self.create(),'start'))
        p=self.action(p,'verify'); p=self.answer(p,number=250,assistance_used=True)
        self.assertEqual(p.status,'review')

    def test_probe_cannot_convert_incomplete_retest_to_independent_completion(self):
        p=self.answer(self.action(self.create(),'start')); p=self.action(p,'verify')
        self.ai.states={JOIN:'uncertain'}; self.ai.probe_id=JOIN
        p=self.answer(p,number=250)
        self.ai.states={}; self.ai.probe_id=''
        p=self.answer(p,number=None)
        self.assertEqual(p.status,'review')

    def test_draft_survives_new_service_and_prevents_stale_overwrite(self):
        p=self.action(self.create(),'start'); r=p.rounds[-1]
        saved=self.svc.draft(p.project_id,ProjectDraft(round_id=r.round_id,revision=p.revision,text='我的草稿',numeric_answer=340,draft_number=1,assistance_used=True))
        restarted=build_services(self.work,self.ai).projects.get(p.project_id,'default_user')
        self.assertEqual(restarted.rounds[-1].draft,'我的草稿')
        self.assertEqual(restarted.rounds[-1].numeric_answer,340)
        with self.assertRaises(AppError):
            self.svc.draft(p.project_id,ProjectDraft(round_id=r.round_id,revision=p.revision,text='旧窗口',draft_number=2))
        p=self.answer(saved)
        self.assertTrue(p.rounds[-1].assistance_used)

    def test_invalid_quote_or_target_rolls_back_and_preserves_draft(self):
        p=self.action(self.create(),'start')
        for override in (lambda r:{**r,'findings':[{**f,'quote':'用户没有写的句子'} for f in r['findings']]},
                         lambda r:{**r,'findings':r['findings'][:-1]}):
            self.ai.override=override
            with self.assertRaises(AIError): self.answer(p)
            self.assertEqual(self.svc.get(p.project_id,'default_user').revision,p.revision)
        self.ai.override=None
        self.assertEqual(self.answer(p).status,'review')

    def test_duplicate_operation_and_stale_revision(self):
        p=self.action(self.create(),'start')
        command=ProjectAction(request_id='answer-once',revision=p.revision,action='answer',round_id=p.rounds[-1].round_id,answer='分别合计后相减并检查连接倍增',numeric_answer=340)
        result=self.svc.act(p.project_id,command)
        self.assertEqual(self.svc.act(p.project_id,command).revision,result.revision)
        self.assertEqual(len(self.ai.calls),1)
        with self.assertRaises(AppError): self.answer(p)
        self.assertEqual(len(self.ai.calls),1)

    def test_model_runs_outside_transaction_and_concurrent_submit_calls_once(self):
        p=self.action(self.create(),'start')
        self.ai.entered=threading.Event(); self.ai.release=threading.Event()
        with ThreadPoolExecutor(max_workers=2) as pool:
            first=pool.submit(self.answer,p)
            self.assertTrue(self.ai.entered.wait(3))
            # A second writer can acquire a DB transaction while AI is waiting.
            with self.work.write() as u: u.users.ensure('parallel-reader')
            with self.assertRaises(AppError): self.answer(p)
            self.ai.release.set()
            self.assertEqual(first.result().status,'review')
        self.assertEqual(len(self.ai.calls),1)

    def test_graph_uncertainty_and_quote_are_visible(self):
        self.ai.states={JOIN:'uncertain'}
        p=self.answer(self.action(self.create(),'start'))
        dashboard=self.services.evidence.dashboard('default_user')
        state=next(a for a in dashboard.atomic_skills if a.atomic_skill_id==JOIN).contexts[0]
        self.assertEqual(state.status,'uncertain'); self.assertIsNone(state.last_score)
        self.assertTrue(dashboard.project_observations)
        self.assertIn(JOIN,[a.atomic_skill_id for a in self.services.graph.graph().atoms])
        self.services.evidence.recommendations('default_user')

    def test_case_exhaustion_does_not_recycle_unseen_task(self):
        p=self.answer(self.action(self.create(),'start'))
        for value in (250,365,330,370):
            p=self.answer(self.action(p,'verify'),number=value)
        with self.assertRaises(AppError): self.action(p,'verify')
        self.assertEqual(len(self.svc.get(p.project_id,'default_user').rounds),5)

    def test_stale_draft_number_with_different_text_is_rejected(self):
        p=self.action(self.create(),'start'); r=p.rounds[-1]
        body=ProjectDraft(round_id=r.round_id,revision=p.revision,text='窗口甲',draft_number=1)
        saved=self.svc.draft(p.project_id,body)
        self.assertEqual(self.svc.draft(p.project_id,body).revision,saved.revision)
        with self.assertRaises(AppError):
            self.svc.draft(p.project_id,body.model_copy(update={'text':'窗口乙'}))

    def test_general_catalog_task_generation_and_help(self):
        assess=self.ai.generate_json
        def model(task,payload):
            if 'answer' in payload: return assess(task,payload)
            if 'atom' in payload: return {'title':'检查分母','text':'先核对总体范围。','exercise':''}
            return dict(legacy.CONTENT)
        self.ai.generate_json=model
        p=self.svc.create(ProjectCreate(request_id='generic',goal='解释数据比较',task_id='s1',source_text='我的课件摘录'))
        p=self.action(p,'start')
        self.assertEqual(p.rounds[-1].content.example_answer,'')
        self.ai.states={'a1':'gap'}
        p=self.answer(p,number=None)
        p=self.action(p,'help',level='explain')
        self.assertEqual(p.interventions[-1].title,'检查分母')
        with self.assertRaises(AppError): self.action(p,'verify')
        self.assertEqual(self.svc.get(p.project_id,'default_user').status,'support')

    def test_task_limitation_never_becomes_gap_or_forced_probe(self):
        self.ai.states={JOIN:'uncertain'}; self.ai.probe_id=JOIN
        self.ai.override=lambda r:{**r,'findings':[{**f,'issue':'task_limitation'} if f['atomic_skill_id']==JOIN else f for f in r['findings']]}
        p=self.answer(self.action(self.create(),'start'))
        self.assertEqual(p.status,'support'); self.assertEqual(p.probes_used,0)
        self.assertEqual(next(f for f in p.findings if f.atomic_skill_id==JOIN).state,'uncertain')

    def test_inconsistent_model_state_is_rejected_without_writes(self):
        self.ai.override=lambda r:{**r,'findings':[{**f,'issue':'explicit_error'} for f in r['findings']]}
        p=self.action(self.create(),'start')
        with self.assertRaises(AIError): self.answer(p)
        with self.work.read() as u: self.assertEqual(len(u.projects.observations('default_user')),0)

    def test_http_project_routes(self):
        # Reuse the minimal ASGI driver, not the old one-shot practice assertions.
        self._request=legacy.TrainingTests._request.__get__(self)
        status,body=legacy.TrainingTests.request(self,'POST','/api/v3/projects', {'request_id':'http','goal':'数据库学习','task_id':CASE_TASK_ID})
        self.assertEqual(status,201)
        project=body['project']
        status,body=legacy.TrainingTests.request(self,'GET',f"/api/v3/projects/{project['project_id']}")
        self.assertEqual(status,200); self.assertEqual(body['project']['goal'],'数据库学习')


class MigrationTests(unittest.TestCase):
    def make_v2(self, root):
        path=root/'old.sqlite3'
        connection=sqlite3.connect(path)
        connection.executescript(SCHEMA)
        connection.execute("INSERT INTO users VALUES ('existing','2026-01-01')")
        connection.execute('PRAGMA user_version=2')
        connection.commit(); connection.close()
        return Database(path)

    def test_v2_upgrade_is_additive_backed_up_and_idempotent(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); db=self.make_v2(root)
            with db.read() as c: original=tuple(c.execute('SELECT * FROM users').fetchone())
            db.initialize(); db.initialize()
            self.assertEqual(db.check_health(),3)
            with db.read() as c: self.assertEqual(tuple(c.execute('SELECT * FROM users').fetchone()),original)
            backups=list((root/'backups').glob('*.sqlite3')); self.assertEqual(len(backups),1)
            with closing(sqlite3.connect(backups[0])) as c:
                self.assertEqual(c.execute('PRAGMA user_version').fetchone()[0],2)
                self.assertEqual(c.execute('SELECT * FROM users').fetchone(),original)

    def test_failed_migration_rolls_back_schema_and_version(self):
        with tempfile.TemporaryDirectory() as folder:
            db=self.make_v2(Path(folder))
            with patch('app.infrastructure.database.PROJECT_SCHEMA','CREATE TABLE new_test(id TEXT); INVALID SQL;'):
                with self.assertRaises(sqlite3.OperationalError): db.initialize()
            with db.read() as c:
                self.assertEqual(c.execute('PRAGMA user_version').fetchone()[0],2)
                self.assertIsNone(c.execute("SELECT 1 FROM sqlite_master WHERE name='new_test'").fetchone())
