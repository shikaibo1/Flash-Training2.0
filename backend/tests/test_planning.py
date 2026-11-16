"""Reviewed personal definitions must stay separate from both public content and evidence."""
import copy
import json
import sqlite3
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from contextlib import closing
from unittest.mock import patch
from pydantic import ValidationError
from app.bootstrap import build_services
from app.domain.planning import LearningPlan
from app.domain.project_commands import ProjectCreate, ProjectAction
from app.domain.learning_cases import CASE_TASK_ID
from app.infrastructure.project_migration import PROJECT_SCHEMA
from app.errors import AIError, AppError
from tests import test_training as legacy
from tests.test_projects import ProjectAI


SOURCE = '均值是数据总和除以数据个数。极端值可能影响均值，应结合中位数比较。'


def proposal_fixture():
    atom = dict(key='mean', module_key='statistics', name='计算均值', action='用数据总和除以数量，写出算式和结果',
        input_spec='一个完整的小样本数列', output_spec='算式、结果和分母说明', boundary='只处理题目给出的完整数据，不推断总体',
        rubric=['分母为实际数据个数', '算式与数值一致'], prerequisite_keys=[], diagnostic_question='少算一个数据会怎样影响分母？',
        basis='user_material', source_quote='均值是数据总和除以数据个数。',
        applicability_conditions=['数据单位一致且没有遗漏'], common_misuses=['把数据最大值误当作分母'])
    return dict(disposition='ready', title='解释小样本的均值与中位数', scope='第一阶段只比较一个小样本中的两种集中趋势。',
        context='基础统计解释', deliverable='写出算式，说明极端值的影响并给出边界', exclusions='不涉及统计推断和完整统计课程', questions=[],
        modules=[dict(key='statistics', name='集中趋势', description='观察均值、中位数与极端值的关系')],
        atoms=[atom, {**atom, 'key':'outlier', 'name':'解释极端值影响', 'action':'比较均值和中位数，指出极端值影响',
            'prerequisite_keys':['mean'], 'source_quote':'极端值可能影响均值，应结合中位数比较。', 'rubric':['区分两种统计量', '不把描述比较当成总体结论']}])


class PlanningAI(ProjectAI):
    def __init__(self):
        super().__init__()
        self.proposal = proposal_fixture()
        self.planner_calls = 0
        self.generated = 0
        self.plan_failure = False
        self.plan_payload = None
        self.gate = None
        self.release_gate = None

    def generate_json(self, task, payload):
        if payload.get('purpose') == 'goal_decomposition':
            self.planner_calls += 1
            self.plan_payload = copy.deepcopy(payload)
            if self.gate:
                self.gate.set(); self.release_gate.wait(5)
            if self.plan_failure:
                raise AIError('temporary model error')
            return copy.deepcopy(self.proposal)
        if 'task' in payload and 'answer' not in payload:
            self.generated += 1
            return {**legacy.CONTENT, 'materials': f'教学模拟材料 {self.generated}：样本为2、4、9。'}
        if 'level' in payload:
            return {'title':'先检查分母', 'text':'列出每个样本，再核对数量。', 'exercise':'为2、4、9写出均值算式。'}
        return super().generate_json(task, payload)


class PlanningTests(unittest.TestCase):
    setUp = legacy.TrainingTests.setUp
    tearDown = legacy.TrainingTests.tearDown
    request = legacy.TrainingTests.request
    _request = legacy.TrainingTests._request

    def create(self, **kwargs):
        self.ai = PlanningAI()
        self.services = build_services(self.work, self.ai)
        self.projects = self.services.projects
        return self.projects.create(ProjectCreate(user_id='u1', request_id='goal', goal='学会统计并解释数据', source_text=SOURCE, **kwargs))

    def command(self, project, action, **kwargs):
        return ProjectAction(user_id='u1', request_id=kwargs.pop('request_id',f'{action}-{project.revision}'), revision=project.revision, action=action, **kwargs)

    def action(self, project, action, **kwargs):
        return self.projects.act(project.project_id, self.command(project, action, **kwargs))

    def confirmed(self):
        return self.action(self.action(self.create(), 'plan'), 'confirm_plan')

    def test_draft_is_reviewable_durable_and_produces_no_ability_or_shared_content(self):
        project = self.create()
        graph_before = self.services.graph.graph()
        project = self.action(project, 'plan')
        self.assertEqual(project.status, 'pending')
        self.assertIsNone(project.skill)
        self.assertEqual(project.atoms, [])
        self.assertEqual(project.plan.atoms[0].source_quote, proposal_fixture()['atoms'][0]['source_quote'])
        self.assertEqual(self.projects.get(project.project_id, 'u1'), project)
        self.assertEqual(self.services.graph.graph(), graph_before)
        self.assertEqual(self.services.evidence.dashboard('u1').project_observations, [])
        self.assertEqual(self.ai.planner_calls, 1)

    def test_confirmed_definitions_are_private_and_graph_uses_module_snapshots(self):
        before = len(self.skills.list())
        project = self.confirmed()
        self.assertEqual(project.status, 'ready')
        self.assertTrue(project.plan_confirmed_at)
        self.assertEqual(len(self.skills.list()), before)
        self.assertTrue(all(a.atomic_skill_id.startswith(f'personal_{project.project_id}_') for a in project.atoms))
        graph = self.services.graph.project_plan('u1', project.project_id)
        self.assertEqual(len(graph.graph.atoms), 2)
        self.assertEqual(graph.graph.knowledge[0].name, '集中趋势')
        self.assertTrue(any(e.relation == 'prerequisite' for e in graph.graph.edges))
        private_id = project.atoms[0].atomic_skill_id
        self.assertFalse(any(n.reference_id == private_id for n in self.services.graph.graph().nodes))
        self.assertFalse(any(s.atomic_skill_id == private_id for s in self.services.evidence.dashboard('other').atomic_skills))
        self.assertTrue(any(s.atomic_skill_id == private_id and s.project_id == project.project_id for s in self.services.evidence.dashboard('u1').atomic_skills))
        for operation in [lambda: self.projects.get(project.project_id,'other'), lambda: self.services.graph.project_plan('other',project.project_id),
                          lambda: self.services.timeline.timeline('other',private_id,None,None,0,20)]:
            with self.assertRaises(AppError): operation()

    def test_end_to_end_personal_task_help_and_unseen_retest_feed_evidence_and_achievements(self):
        project = self.action(self.confirmed(), 'start')
        self.assertEqual(project.rounds[-1].content.hint, '')
        self.ai.states = {project.atoms[0].atomic_skill_id: 'gap'}
        project = self.action(project, 'answer', round_id=project.rounds[-1].round_id, answer='分母可能是最大值。')
        self.assertEqual(project.status, 'support')
        project = self.action(project, 'help', level='micro')
        project = self.action(project, 'reflect', answer='分母应为样本数量。')
        project = self.action(project, 'verify')
        self.ai.states = {}
        project = self.action(project, 'answer', round_id=project.rounds[-1].round_id, answer='均值为总和除以三个样本，比较中位数并说明极端值影响。')
        self.assertEqual(project.status, 'completed')
        self.assertNotEqual(project.rounds[0].content.materials, project.rounds[-1].content.materials)
        timeline = self.services.timeline.timeline('u1',project.atoms[0].atomic_skill_id,None,project.project_id,0,20)
        self.assertEqual(timeline.total, 2)
        self.assertEqual(timeline.items[0].stage, 'verification')
        self.assertTrue(all(i.definition_version == 1 for i in timeline.items))
        self.assertTrue(any(i.id == 'learning_loop' and i.unlocked for i in self.services.achievements.sync('u1').items))
        self.assertTrue(all(s.status == 'independent' for s in self.services.graph.project_plan('u1', project.project_id).states))

    def test_clarification_is_bounded_and_previous_answers_survive_regeneration(self):
        project = self.create()
        self.ai.proposal = {**proposal_fixture(), 'disposition':'needs_clarification','questions':['优先练课堂计算还是科研描述？'], 'atoms':[], 'modules':[]}
        project = self.action(project, 'plan')
        with self.assertRaises(AppError): self.action(project, 'confirm_plan')
        self.ai.proposal = proposal_fixture()
        project = self.action(project, 'plan', answer='先练课堂计算')
        self.assertEqual(project.plan_feedback, ['先练课堂计算'])
        project = self.action(project, 'plan', answer='再补上极端值解释')
        self.assertEqual(self.ai.plan_payload['previous_clarifications'], ['先练课堂计算'])
        self.assertEqual(len(project.plan_feedback), 2)

    def test_nonexistent_source_quote_is_rejected_without_progress_and_retry_recovers(self):
        project = self.create()
        self.ai.proposal['atoms'][0]['source_quote'] = '并不存在于资料的引文'
        with self.assertRaises(AIError): self.action(project, 'plan')
        self.assertEqual(self.projects.get(project.project_id,'u1'), project)
        self.ai.proposal = proposal_fixture()
        project = self.action(project, 'plan')
        self.assertIsNotNone(project.plan)

    def test_model_failure_preserves_previous_draft_and_releases_operation(self):
        project = self.action(self.create(), 'plan')
        self.ai.plan_failure = True
        with self.assertRaises(AIError): self.action(project, 'plan')
        self.assertEqual(self.projects.get(project.project_id,'u1'),project)
        self.ai.plan_failure = False
        self.action(project,'plan')

    def test_manual_edit_checks_source_and_does_not_call_model(self):
        project = self.action(self.create(), 'plan')
        values = project.plan.model_dump()
        values['title'] = '自己核对过的第一阶段'
        values['atoms'][0]['name'] = '列算式计算均值'
        edited = LearningPlan.model_validate(values)
        calls = self.ai.planner_calls
        project = self.action(project,'save_plan',plan=edited)
        self.assertEqual(project.plan.title,'自己核对过的第一阶段')
        self.assertEqual(self.ai.planner_calls,calls)
        values['atoms'][0]['source_quote'] = '伪造资料'
        with self.assertRaises(AppError): self.action(project,'save_plan',plan=LearningPlan.model_validate(values))
        self.assertEqual(self.projects.get(project.project_id,'u1').plan,edited)

    def test_cycles_missing_references_duplicates_and_empty_definitions_are_rejected(self):
        for mutate in [
            lambda p: p['atoms'][0]['prerequisite_keys'].append('outlier'),
            lambda p: p['atoms'][0]['prerequisite_keys'].append('missing'),
            lambda p: p['atoms'][0]['prerequisite_keys'].append('mean'),
            lambda p: p['atoms'][0].update(rubric=['   ']),
            lambda p: p['atoms'][0].update(module_key='missing'),
            lambda p: p['atoms'][1].update(name=p['atoms'][0]['name']),
            lambda p: p['atoms'][0].update(basis='proposal'),
            lambda p: p['atoms'].pop(),
        ]:
            values = proposal_fixture(); mutate(values)
            with self.subTest(values=values):
                with self.assertRaises(ValidationError): LearningPlan.model_validate(values)

    def test_repeated_requests_are_idempotent_and_stale_edit_cannot_overwrite(self):
        project = self.create()
        command = self.command(project,'plan')
        draft = self.projects.act(project.project_id,command)
        self.assertEqual(self.projects.act(project.project_id,command),draft)
        self.assertEqual(self.ai.planner_calls,1)
        with self.assertRaises(AppError):
            self.projects.act(project.project_id, self.command(project,'plan',request_id='unused'))

    def test_confirm_is_idempotent_and_definition_changes_are_locked(self):
        project = self.action(self.create(), 'plan')
        command = self.command(project,'confirm_plan')
        confirmed = self.projects.act(project.project_id,command)
        self.assertEqual(self.projects.act(project.project_id,command),confirmed)
        for action in ('plan','confirm_plan'):
            with self.assertRaises(AppError): self.action(confirmed,action)
        with self.assertRaises(AppError): self.action(confirmed,'save_plan',plan=project.plan)

    def test_planning_model_call_holds_no_database_transaction_and_concurrent_edit_is_rejected(self):
        project = self.create()
        self.ai.gate, self.ai.release_gate = threading.Event(), threading.Event()
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.action, project, 'plan')
            self.assertTrue(self.ai.gate.wait(2))
            # This write could not finish while a planning call held a write transaction.
            with self.work.write() as unit: unit.users.ensure('unrelated-user')
            with self.assertRaises(AppError) as error: self.action(project,'bind',task_id='s1')
            self.assertEqual(error.exception.code,'project_busy')
            self.ai.release_gate.set()
            self.assertIsNotNone(future.result().plan)

    def test_http_owner_validation_and_private_confirmation(self):
        project = self.create()
        status, body = self.request('POST', f'/api/v3/projects/{project.project_id}/actions',
            {'request_id':'http-plan','revision':0,'action':'plan'})
        self.assertEqual(status,200)
        self.assertEqual(body['project']['plan']['disposition'],'ready')
        status, _ = self.request('POST',f'/api/v3/projects/{project.project_id}/actions',
            {'request_id':'http-save','revision':1,'action':'save_plan','plan':proposal_fixture(),'user_id':'other'})
        self.assertEqual(status,422)
        status, body = self.request('POST',f'/api/v3/projects/{project.project_id}/actions',
            {'request_id':'http-confirm','revision':1,'action':'confirm_plan'})
        self.assertEqual((status,body['project']['status']),(200,'ready'))

    def test_old_project_json_without_planning_fields_remains_readable(self):
        project = self.create()
        values = project.model_dump()
        for key in ('plan','plan_confirmed_at','plan_feedback'): values.pop(key)
        with self.db.transaction() as c:
            c.execute('UPDATE learning_projects SET payload_json=? WHERE project_id=?',(json.dumps(values),project.project_id))
        self.assertIsNone(self.projects.get(project.project_id,'u1').plan)

    def make_legacy_v6(self):
        self.ai = ProjectAI()
        self.projects = build_services(self.work,self.ai).projects
        project = self.projects.create(ProjectCreate(user_id='u1',request_id='legacy',goal='已有SQL学习项目',task_id=CASE_TASK_ID))
        project = self.action(project,'start')
        project = self.action(project,'answer',round_id=project.rounds[-1].round_id,
            answer='分别求订单与退款合计，一对多连接会重复订单金额，核对无退款订单。',numeric_answer=340)
        with self.db.transaction() as c:
            rows = c.execute('SELECT * FROM project_observations').fetchall()
            c.execute('DROP TABLE project_observations')
            for statement in PROJECT_SCHEMA.split(';'):
                if 'CREATE TABLE project_observations ' in statement or 'CREATE INDEX project_obs_user_idx' in statement:
                    c.execute(statement)
            c.executemany('INSERT INTO project_observations VALUES (?,?,?,?,?,?,?)',[tuple(row) for row in rows])
            c.execute('DROP TABLE project_atom_snapshots')
            c.execute('PRAGMA user_version=6')
        return project, [tuple(row) for row in rows]

    def test_v6_migration_preserves_observations_and_backfills_immutable_snapshots(self):
        project, original = self.make_legacy_v6()
        self.db.initialize(); self.db.initialize()
        self.assertEqual(self.db.check_health(),7)
        with self.db.read() as c:
            self.assertEqual([tuple(row) for row in c.execute('SELECT * FROM project_observations')],original)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM project_atom_snapshots').fetchone()[0],3)
            self.assertFalse(c.execute('PRAGMA foreign_key_check').fetchall())
        backups = list((self.root/'backups').glob('before-v7-*'))
        self.assertEqual(len(backups),1)
        with closing(sqlite3.connect(backups[0])) as c:
            self.assertEqual(c.execute('PRAGMA user_version').fetchone()[0],6)
        project = self.action(project,'verify')
        project = self.action(project,'answer',round_id=project.rounds[-1].round_id,
            answer='分别合计，解释行粒度与连接重复，检查无退款订单。',numeric_answer=250)
        self.assertEqual(project.status,'completed')

    def test_failed_v6_observation_migration_rolls_back_old_table_rows_and_version(self):
        _, original = self.make_legacy_v6()
        with patch('app.infrastructure.planning_migration.OBSERVATION_SCHEMA','INVALID SQL'):
            with self.assertRaises(sqlite3.OperationalError): self.db.initialize()
        with self.db.read() as c:
            self.assertEqual(c.execute('PRAGMA user_version').fetchone()[0],6)
            self.assertEqual([tuple(row) for row in c.execute('SELECT * FROM project_observations')],original)
            self.assertIsNone(c.execute("SELECT name FROM sqlite_master WHERE name='project_atom_snapshots'").fetchone())
