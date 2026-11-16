"""Milestone integrity, persistence, concurrent sync, ownership and schema upgrades."""
import sqlite3
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from app.bootstrap import build_services
from app.domain.achievement_rules import evaluate
from app.domain.project_commands import ProjectCreate, ProjectAction
from app.domain.learning_cases import CASE_TASK_ID, JOIN
from app.infrastructure.database import Database
from app.infrastructure.unit_of_work import SQLiteUnitOfWorkFactory
from tests import test_training as legacy
from tests.test_projects import ProjectAI


class AchievementTests(unittest.TestCase):
    setUp = legacy.TrainingTests.setUp
    tearDown = legacy.TrainingTests.tearDown
    complete = legacy.TrainingTests.complete
    request = legacy.TrainingTests.request
    _request = legacy.TrainingTests._request

    def dashboard(self, user='u1'):
        return self.services.achievements.sync(user)

    @staticmethod
    def earned(data):
        return {item.id for item in data.items if item.unlocked}

    def project(self):
        self.project_ai = ProjectAI()
        self.project_service = build_services(self.work, self.project_ai).projects
        return self.project_service.create(ProjectCreate(user_id='u1', request_id='create',
            goal='数据库订单分析', task_id=CASE_TASK_ID))

    def action(self, project, action, **kwargs):
        return self.project_service.act(project.project_id, ProjectAction(user_id='u1',
            request_id=f'{action}-{project.revision}', revision=project.revision,
            round_id=project.rounds[-1].round_id if project.rounds else None, action=action, **kwargs))

    def answer(self, project, value=340, **kwargs):
        return self.action(project, 'answer', answer='分别合计订单减退款，一对多连接会重复累计；检查无退款订单。', numeric_answer=value, **kwargs)

    def recovery(self, assisted=False, value=250):
        project = self.action(self.project(), 'start')
        self.project_ai.states = {JOIN: 'gap'}
        project = self.answer(project)
        project = self.action(project, 'help', level='micro')
        project = self.action(project, 'reflect', answer='需要先识别每行粒度，不能直接连接后汇总。')
        project = self.action(project, 'verify')
        self.project_ai.states = {}
        return self.answer(project, value, assistance_used=assisted)

    def test_empty_dashboard_is_read_only_and_uses_no_ai(self):
        before = len(self.ai.calls)
        data = self.services.achievements.get('u1')
        self.assertEqual((data.total, data.unlocked_count, data.completed_tasks), (10, 0, 0))
        self.assertTrue(all(item.progress == 0 for item in data.items))
        self.assertEqual(len(self.ai.calls), before)
        with self.db.read() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM achievement_awards').fetchone()[0], 0)

    def test_existing_goal_backfills_at_original_time_and_survives_restart(self):
        project = self.project()
        data = self.dashboard()
        award = next(i.award for i in data.items if i.id == 'first_goal')
        self.assertEqual(award.achieved_at, project.created_at)
        self.assertEqual(data.unread_ids, ['first_goal'])
        self.services.achievements.seen('u1', ['first_goal'])
        restored = build_services(SQLiteUnitOfWorkFactory(Database(self.db.path)), self.ai).achievements.sync('u1')
        self.assertIn('first_goal', self.earned(restored))
        self.assertEqual(restored.unread_ids, [])

    def test_guided_and_declared_assistance_never_award_independent_evidence(self):
        self.complete(mode='guided')
        self.complete(mode='independent', assistance=True)
        data = self.dashboard()
        self.assertEqual(data.completed_tasks, 2)
        self.assertEqual(data.independent_tasks, 0)
        self.assertEqual(data.independent_atoms, 0)
        self.assertEqual(self.earned(data), {'first_task'})

    def test_low_score_still_rewards_attempt_but_not_independent_support(self):
        self.ai.evaluation_override = lambda result: {**result, 'evidence': [
            {**e, 'score': 2.0} for e in result['evidence']]}
        self.complete(mode='independent')
        data = self.dashboard()
        self.assertIn('first_independent', self.earned(data))
        self.assertEqual(data.independent_atoms, 0)

    def test_five_tasks_deduplicate_retries_and_two_contexts_do_not_claim_mastery(self):
        result = self.complete(mode='independent')
        self.svc.submit('u1', result.session_id, '甲组完成率75%，乙组50%，尚需确认样本可比。', False)
        self.dashboard(); self.dashboard()
        for _ in range(3):
            self.complete(mode='independent')
        self.assertNotIn('five_tasks', self.earned(self.dashboard()))
        self.complete(skill_id='s2', mode='independent')
        data = self.dashboard()
        self.assertEqual(data.completed_tasks, 5)
        self.assertEqual(data.independent_atoms, 2)
        self.assertTrue({'five_tasks', 'two_contexts'} <= self.earned(data))

    def test_project_probe_is_a_process_badge_not_an_independent_task(self):
        project = self.action(self.project(), 'start')
        self.project_ai.states = {JOIN: 'uncertain'}
        self.project_ai.probe_id = JOIN
        project = self.answer(project, assistance_used=True)
        self.project_ai.states = {}; self.project_ai.probe_id = ''
        self.answer(project, value=None)
        data = self.dashboard()
        self.assertIn('first_probe', self.earned(data))
        self.assertEqual(data.completed_tasks, 1)
        self.assertEqual((data.independent_tasks, data.independent_atoms), (0, 0))

    def test_gap_help_new_independent_retest_awards_learning_loop(self):
        project = self.recovery()
        data = self.dashboard()
        self.assertTrue({'first_reflection', 'first_retest', 'learning_loop', 'three_atoms'} <= self.earned(data))
        award = next(i.award for i in data.items if i.id == 'learning_loop')
        self.assertIn(project.rounds[-1].round_id, award.source_path)
        self.assertEqual(data.completed_tasks, 2)

    def test_assisted_retest_and_wrong_numeric_result_cannot_award_learning_loop(self):
        self.recovery(assisted=True)
        data = self.dashboard()
        self.assertFalse({'first_retest', 'learning_loop'} & self.earned(data))
        # A new wrong independent retest remains an attempt, not a breakthrough.
        project = self.project_service.list('u1')[0]
        project = self.action(project, 'verify')
        self.answer(project, 999)
        data = self.dashboard()
        self.assertIn('first_retest', self.earned(data))
        self.assertNotIn('learning_loop', self.earned(data))

    def test_reused_material_or_later_help_cannot_retroactively_award_loop(self):
        project = self.recovery()
        earlier, later = project.rounds[0], project.rounds[-1]
        later = later.model_copy(update={'content': later.content.model_copy(update={'materials': earlier.content.materials})})
        reused = project.model_copy(update={'rounds': [*project.rounds[:-1], later]})
        state = {p.achievement_id: p for p in evaluate([reused], [], [], [])}
        self.assertIsNone(state['learning_loop'].proof)
        self.assertIsNone(state['first_retest'].proof)
        events = [e.model_copy(update={'created_at': '2099-01-01T00:00:00Z'}) if e.kind == 'help' else e for e in project.events]
        state = {p.achievement_id: p for p in evaluate([project.model_copy(update={'events': events})], [], [], [])}
        self.assertIsNone(state['learning_loop'].proof)

    def test_concurrent_sync_is_idempotent_and_acknowledgement_is_owner_scoped(self):
        self.complete(mode='independent')
        with ThreadPoolExecutor(max_workers=4) as pool:
            dashboards = list(pool.map(lambda _: self.dashboard(), range(4)))
        self.assertTrue(all(d.unlocked_count == 2 for d in dashboards))
        before = self.dashboard()
        self.services.achievements.seen('other', before.unread_ids)
        self.assertEqual(self.dashboard().unread_ids, before.unread_ids)
        self.services.achievements.seen('u1', before.unread_ids)
        first = self.services.achievements.get('u1')
        self.services.achievements.seen('u1', before.unread_ids)
        self.assertEqual(self.services.achievements.get('u1'), first)
        self.assertEqual(self.dashboard('other').unlocked_count, 0)

    def test_soft_deleted_records_preserve_saved_milestones_and_replay_source(self):
        result = self.complete(mode='independent')
        before = self.dashboard()
        self.services.records.delete('u1', result.record_id)
        after = self.dashboard()
        self.assertEqual(self.earned(before), self.earned(after))
        self.assertEqual(after.completed_tasks, 1)
        self.assertEqual(self.svc.session_details('u1', result.session_id).status, 'completed')

    def test_http_authentication_strict_input_and_sync_contract(self):
        status, _ = self.request('GET', '/api/v2/achievements', authenticated=False)
        self.assertEqual(status, 401)
        status, body = self.request('POST', '/api/v2/achievements/sync', {})
        self.assertEqual((status, body['total'], body['unlocked_count']), (200, 10, 0))
        status, _ = self.request('POST', '/api/v2/achievements/seen', {'ids': ['first_goal'], 'user_id': 'other'})
        self.assertEqual(status, 422)
        status, _ = self.request('POST', '/api/v2/achievements/seen', {'ids': ['invented']})
        self.assertEqual(status, 422)

    def test_v5_upgrade_preserves_accounts_projects_and_makes_consistent_backup(self):
        self.project()
        self.request('GET', '/api/v2/achievements')  # create an authenticated test account
        with self.db.transaction() as c:
            project_row = tuple(c.execute('SELECT * FROM learning_projects').fetchone())
            account_row = tuple(c.execute('SELECT * FROM accounts').fetchone())
            c.execute('DROP TABLE achievement_awards')
            c.execute('DROP TABLE project_atom_snapshots')
            c.execute('PRAGMA user_version=5')
        self.db.initialize(); self.db.initialize()
        self.assertEqual(self.db.check_health(), 7)
        with self.db.read() as c:
            self.assertEqual(tuple(c.execute('SELECT * FROM learning_projects').fetchone()), project_row)
            self.assertEqual(tuple(c.execute('SELECT * FROM accounts').fetchone()), account_row)
            self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
        backups = list((self.root/'backups').glob('before-v7-*.sqlite3'))
        self.assertEqual(len(backups), 1)
        connection = sqlite3.connect(backups[0])
        try:
            self.assertEqual(connection.execute('PRAGMA user_version').fetchone()[0], 5)
        finally:
            connection.close()
        self.assertIn('first_goal', self.earned(self.dashboard()))

    def test_failed_v5_migration_rolls_back_without_bumping_version(self):
        with self.db.transaction() as c:
            c.execute('DROP TABLE achievement_awards')
            c.execute('DROP TABLE project_atom_snapshots')
            c.execute('PRAGMA user_version=5')
        with patch('app.infrastructure.database.ACHIEVEMENT_SCHEMA', 'CREATE TABLE partial_awards(id TEXT); INVALID SQL;'):
            with self.assertRaises(sqlite3.OperationalError):
                self.db.initialize()
        with self.db.read() as c:
            self.assertEqual(c.execute('PRAGMA user_version').fetchone()[0], 5)
            self.assertIsNone(c.execute("SELECT name FROM sqlite_master WHERE name='partial_awards'").fetchone())

    def test_award_write_failure_rolls_back_entire_sync_and_retry_recovers(self):
        self.complete(mode='independent')
        from app.infrastructure.repositories.achievements import AchievementRepository
        original = AchievementRepository.add
        count = 0

        def fail_second(repository, user_id, award):
            nonlocal count
            count += 1
            if count == 2:
                raise sqlite3.OperationalError('test failure')
            original(repository, user_id, award)

        with patch.object(AchievementRepository, 'add', fail_second):
            with self.assertRaises(sqlite3.OperationalError):
                self.dashboard()
        with self.db.read() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM achievement_awards').fetchone()[0], 0)
        self.assertEqual(self.dashboard().unlocked_count, 2)
