"""Run with python -m unittest discover -s tests -v; uses only temporary SQLite and FakeAI."""
import asyncio
import copy
import json
import sqlite3
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.bootstrap import build_services
from app.application.auth import password_digest, token_digest
from app.domain.accounts import Account, AccountCredentials
from app.domain.commands import AtomicCreate, SkillPatch
from app.errors import AIError, AppError
from app.infrastructure.ai import OpenAIJSONClient
from app.infrastructure.catalog_seed import seed_catalog
from app.infrastructure.database import Database
from app.infrastructure.repositories.progress import ProgressRepository
from app.infrastructure.repositories.skills import SkillRepository
from app.infrastructure.serialization import dump
from app.infrastructure.unit_of_work import SQLiteUnitOfWorkFactory
from app.main import create_app
from app.settings import Settings


CONTENT = {
    "title": "教学模拟：检查交付物", "description": "根据模拟材料提交结论、依据与下一步。",
    "materials": "教学模拟材料：甲组12人，完成9人；乙组10人，完成5人。",
    "hint": "先检查分母和可比性。", "example_answer": "甲组完成率75%，乙组50%；需确认样本可比。",
}


class FakeAI:
    """Inject into create_app(settings, ai=FakeAI()); no network or real credentials.

    Generates evidence for exactly payload['target_atoms'], grounded in the supplied
    answer. Tests can set response/evaluation_override, failure, or barrier to exercise
    validation and concurrent writes. Calls remain available for snapshot assertions.
    """

    configured = True

    def __init__(self):
        self.failure = False
        self.barrier = None
        self.response = None
        self.evaluation_override = None
        self.calls = []
        self.generations = 0
        self.evaluations = 0
        self.reference = None

    def generate_json(self, task, payload):
        self.calls.append((task, copy.deepcopy(payload)))
        if self.failure:
            raise AIError("test unavailable")
        if self.response is not None:
            return copy.deepcopy(self.response)
        if "answer" in payload:
            self.evaluations += 1
            self.reference = copy.deepcopy(payload["question"])
            if self.barrier:
                self.barrier.wait(timeout=10)
            result = {"score": 8.0, "strengths": ["结论有依据"], "improvements": ["补充边界"],
                      "aiComment": "模拟评分", "evidence": [
                          {"atomic_skill_id": atom["atomic_skill_id"], "status": "observed", "score": 8.0,
                           "quote": payload["answer"][:80], "reason": "符合本原子量表主要标准。",
                           "next_action": "补充适用边界。"} for atom in payload["target_atoms"]]}
            if self.evaluation_override:
                result = self.evaluation_override(result)
            return result
        if "goal" in payload:
            atom = payload["catalog"][0]
            return {"description": "模拟工作任务", "task_brief": "分析模拟材料并提交结论",
                    "deliverable": "文字结论", "context": atom["contexts"][0],
                    "role_id": payload["role_ids"][0], "atomic_skills": [atom["atomic_skill_id"]]}
        self.generations += 1
        return dict(CONTENT)


def catalog_fixture():
    atom = {"atomic_skill_id": "a1", "name": "比较", "description": "比较有依据的差异", "categories": ["分析"],
            "action": "比较", "input_spec": "模拟表格", "output_spec": "结论及边界", "boundary": "不推断因果",
            "rubric": ["使用正确分母", "注明适用边界"], "knowledge_ids": ["k1"], "prerequisite_ids": [],
            "contexts": ["数据分析", "科研"], "version": 1}
    task = {"skill_id": "s1", "name": "对比报告", "display_name": "对比报告", "description": "模拟对比报告",
            "atomic_skills": ["a1", "a2"], "default_params": {"difficulty": "入门", "duration": "5分钟"},
            "role_id": "r1", "context": "数据分析", "task_brief": "解释差异", "deliverable": "文字报告"}
    return {"version": 2, "roles": [{"role_id": "r1", "name": "分析师", "description": "分析模拟材料"}],
            "knowledge": [{"knowledge_id": "k1", "name": "比率", "description": "分子与分母", "course": "统计"}],
            "atoms": [atom, {**atom, "atomic_skill_id": "a2", "name": "解释", "prerequisite_ids": ["a1"]}],
            "tasks": [task, {**task, "skill_id": "s2", "name": "科研比较", "display_name": "科研比较",
                              "context": "科研", "atomic_skills": ["a1"]},
                      {**task, "skill_id": "s3", "name": "基础比较", "display_name": "基础比较", "atomic_skills": ["a1"]}]}


class TrainingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.catalog = catalog_fixture()
        self.catalog_path = self.root / "catalog.json"
        self.catalog_path.write_text(dump(self.catalog), encoding="utf-8")
        self.settings = Settings(database_path=self.root / "test.sqlite3", catalog_path=self.catalog_path)
        self.db = Database(self.settings.database_path)
        self.db.initialize()
        seed_catalog(self.db, self.catalog_path)
        self.work = SQLiteUnitOfWorkFactory(self.db)
        self.ai = FakeAI()
        self.services = build_services(self.work, self.ai)
        self.svc, self.skills = self.services.practice, self.services.skills
        self.records, self.evidence = self.services.records, self.services.evidence

    def tearDown(self):
        self.tmp.cleanup()

    def count(self, table):
        with self.db.read() as connection:
            return connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    def complete(self, skill_id="s1", mode="guided", user_id="u1", assistance=False):
        session = self.svc.start(user_id, skill_id, {"mode": mode})
        return self.svc.submit(user_id, session.session_id, "甲组完成率75%，乙组50%，尚需确认样本可比。", assistance)

    def summary(self, atom_id="a1", user_id="u1"):
        return next(item for item in self.evidence.dashboard(user_id).atomic_skills if item.atomic_skill_id == atom_id)

    async def _request(self, method, path, body=None, query=b"", ai=None, authenticated=True):
        app = create_app(self.settings, ai=ai or self.ai)
        messages, sent = [], False
        headers = [(b"content-type", b"application/json"), (b"x-requested-with", b"FlashTrain")]
        if authenticated:
            if not getattr(self, "_http_token", None):
                self._http_token = "temporary-http-test-session"
                salt, now = "00" * 16, int(time.time())
                credentials = AccountCredentials(Account(user_id="u1", username="http_test", display_name="HTTP learner"),
                    salt, password_digest("temporary-test-password", salt))
                with self.work.write() as unit:
                    unit.users.add_account(credentials)
                    unit.users.add_session(token_digest(self._http_token), "u1", now + 3600, now)
            headers.append((b"cookie", f"flash_session={self._http_token}".encode()))

        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": json.dumps(body).encode() if body is not None else b"", "more_body": False}
            return {"type": "http.disconnect"}

        async def send(message):
            messages.append(message)

        scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method,
                 "scheme": "http", "path": path, "raw_path": path.encode(), "query_string": query,
                 "headers": headers, "client": ("127.0.0.1", 1234), "server": ("127.0.0.1", 8001)}
        async with app.router.lifespan_context(app):
            await app(scope, receive, send)
        status = next(message["status"] for message in messages if message["type"] == "http.response.start")
        value = b"".join(message.get("body", b"") for message in messages if message["type"] == "http.response.body")
        return status, json.loads(value)

    def request(self, *args, **kwargs):
        return asyncio.run(self._request(*args, **kwargs))

    def test_real_catalog_has_three_roles_and_complete_graph_references(self):
        real = Database(self.root / "real.sqlite3")
        real.initialize()
        seed_catalog(real, Settings().catalog_path)
        graph = build_services(SQLiteUnitOfWorkFactory(real), self.ai).graph.graph()
        self.assertEqual(len(graph.roles), 3)
        self.assertGreaterEqual(len(graph.tasks), 6)
        self.assertGreaterEqual(len(graph.atoms), 8)
        identifiers = {node.id for node in graph.nodes}
        self.assertEqual(len(identifiers), len(graph.nodes))
        for edge in graph.edges:
            self.assertIn(edge.source, identifiers)
            self.assertIn(edge.target, identifiers)
        self.assertEqual({node.type for node in graph.nodes}, {"role", "task", "atom", "knowledge"})

    def test_catalog_seed_is_idempotent_and_preserves_user_edits(self):
        self.skills.update("s1", SkillPatch(description="用户修改"))
        seed_catalog(self.db, self.catalog_path)
        self.assertEqual(self.count("skills"), 3)
        self.assertEqual(self.skills.get("s1").description, "用户修改")

    def test_graph_keeps_prerequisites_directional_and_definitions_unscored(self):
        graph = self.services.graph.graph()
        edges = {(edge.source, edge.target, edge.relation) for edge in graph.edges}
        self.assertIn(("atom:a1", "atom:a2", "prerequisite"), edges)
        self.assertNotIn(("atom:a2", "atom:a1", "prerequisite"), edges)
        self.assertIn(("knowledge:k1", "atom:a1", "supports"), edges)
        self.assertIn(("role:r1", "task:s1", "contains"), edges)
        self.complete()
        mapping = self.services.progress.mapping("u1", "s1")
        self.assertTrue(all(atom.score is None and atom.current_score is None for atom in mapping.atomic_skills))

    def test_invalid_catalog_references_and_cycles_write_nothing(self):
        cases = []
        for field, value in (("knowledge_ids", ["missing"]), ("prerequisite_ids", ["missing"]),
                             ("prerequisite_ids", ["a1"]), ("contexts", ["科研"])):
            fixture = catalog_fixture()
            fixture["atoms"][0][field] = value
            cases.append(fixture)
        duplicate = catalog_fixture()
        duplicate["atoms"].append(copy.deepcopy(duplicate["atoms"][0]))
        cases.append(duplicate)
        for index, fixture in enumerate(cases):
            with self.subTest(index=index):
                target = Database(self.root / f"bad{index}.sqlite3")
                target.initialize()
                self.catalog_path.write_text(dump(fixture), encoding="utf-8")
                with self.assertRaises(ValueError):
                    seed_catalog(target, self.catalog_path)
                with target.read() as connection:
                    for table in ("roles", "knowledge_concepts", "atomic_skills", "skills", "catalog_metadata"):
                        self.assertEqual(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0)

    def test_v1_database_is_rejected_without_modification(self):
        path = self.root / "old.sqlite3"
        with closing(sqlite3.connect(path)) as connection:
            with connection:
                connection.execute("CREATE TABLE sentinel (value TEXT)")
                connection.execute("INSERT INTO sentinel VALUES ('original')")
                connection.execute("PRAGMA user_version=1")
        with self.assertRaises(RuntimeError):
            Database(path).initialize()
        with closing(sqlite3.connect(path)) as connection:
            self.assertEqual(connection.execute("SELECT value FROM sentinel").fetchone()[0], "original")
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 1)

    def test_modes_hide_answers_until_completed_in_start_details_history_and_http(self):
        for mode in ("guided", "independent", "transfer"):
            with self.subTest(mode=mode):
                session = self.svc.start("u1", "s1", {"mode": mode})
                detail = self.svc.session_details("u1", session.session_id)
                history = next(item for item in self.svc.history("u1") if item.session_id == session.session_id)
                for content in (session.content, detail.content, history.content):
                    self.assertEqual(bool(content.hint), mode == "guided")
                    self.assertEqual(bool(content.example_answer), mode == "guided")
                    self.assertTrue(content.materials)
                status, value = self.request("GET", "/api/v1/practice/history")
                self.assertEqual(status, 200)
                item = next(item for item in value["history"] if item["session_id"] == session.session_id)
                self.assertEqual(bool(item["content"]["example_answer"]), mode == "guided")
                self.svc.submit("u1", session.session_id, "答案")
                self.assertTrue(self.svc.session_details("u1", session.session_id).content.example_answer)
                self.assertTrue(next(item for item in self.svc.history("u1") if item.session_id == session.session_id).content.hint)

    def test_preview_generation_also_hides_independent_and_transfer_hints(self):
        for mode in ("independent", "transfer"):
            generated = self.svc.generate("s1", {"mode": mode})
            self.assertEqual((generated.hint, generated.example_answer), ("", ""))
        self.assertEqual(self.count("practice_sessions"), 0)

    def test_invalid_generated_materials_or_reference_answer_cannot_create_session(self):
        for changes in ({"materials": ""}, {"materials": "   "}, {"example_answer": ""}, {"title": ""}):
            with self.subTest(changes=changes):
                self.ai.response = {**CONTENT, **changes}
                with self.assertRaises(AIError):
                    self.svc.start("u1", "s1", {})
                self.assertEqual(self.count("practice_sessions"), 0)
                self.assertEqual(self.count("users"), 0)

    def test_session_uses_saved_question_atoms_task_and_params_after_restart(self):
        session = self.svc.start("u1", "s1", {"duration": "1分钟", "target_atomic_ids": ["a1"]})
        self.skills.update("s1", SkillPatch(default_params={"difficulty": "专家"}, description="changed", atomic_skills=["a2"]))
        with self.db.transaction() as connection:
            definition = session.atom_snapshot[0].model_dump(exclude={"atomic_skill_id", "name", "description", "categories"})
            definition.update(rubric=["全新量表"], version=2)
            connection.execute("UPDATE atomic_skills SET definition_json=? WHERE atomic_skill_id='a1'", (dump(definition),))
        reopened = build_services(SQLiteUnitOfWorkFactory(Database(self.settings.database_path)), self.ai)
        result = reopened.practice.submit("u1", session.session_id, "实际答案")
        generated_payload, evaluated_payload = self.ai.calls[0][1], self.ai.calls[1][1]
        self.assertEqual(generated_payload["task"], evaluated_payload["task"])
        self.assertEqual(generated_payload["params"], evaluated_payload["params"])
        self.assertEqual(generated_payload["target_atoms"], evaluated_payload["target_atoms"])
        self.assertEqual(self.ai.reference, session.content.model_dump(mode="json"))
        self.assertEqual(result.evaluation_result.atomic_skill_scores, {"a1": 8.0})
        self.assertEqual(reopened.records.list("u1")[0].score, 80)
        self.assertEqual(reopened.records.list("u1")[0].target_atomic_ids, ["a1"])

    def test_invalid_modes_and_target_sets_do_not_call_ai_or_write(self):
        cases = [{"mode": "unknown"}, {"target_atomic_ids": []}, {"target_atomic_ids": ["missing"]},
                 {"target_atomic_ids": ["a1", "a1"]}, {"target_atomic_ids": "a1"}, {"target_atomic_ids": [1]}]
        for params in cases:
            with self.subTest(params=params), self.assertRaises(AppError):
                self.svc.start("u1", "s1", params)
        self.assertEqual(self.ai.calls, [])
        self.assertEqual(self.count("users"), 0)

    def test_duplicate_submit_is_idempotent_and_conflicting_answer_is_rejected(self):
        session = self.svc.start("u1", "s1", {})
        first = self.svc.submit("u1", session.session_id, "答案")
        self.assertEqual(first, self.svc.submit("u1", session.session_id, "答案"))
        with self.assertRaises(AppError) as error:
            self.svc.submit("u1", session.session_id, "另一个答案")
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(self.ai.evaluations, 1)
        self.assertEqual((self.count("practice_attempts"), self.count("practice_records"), self.count("atom_evidence")), (1, 1, 2))

    def test_concurrent_identical_submissions_write_once(self):
        session = self.svc.start("u1", "s1", {})
        self.ai.barrier = threading.Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.svc.submit, "u1", session.session_id, "答案") for _ in range(2)]
            results = [future.result(timeout=20) for future in futures]
        self.assertEqual(results[0], results[1])
        self.assertEqual(self.count("practice_attempts"), 1)
        self.assertEqual(self.count("atom_evidence"), 2)

    def test_concurrent_conflicting_submissions_accept_only_one_answer(self):
        session = self.svc.start("u1", "s1", {})
        self.ai.barrier = threading.Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.svc.submit, "u1", session.session_id, answer) for answer in ("答案甲", "答案乙")]
            results = []
            for future in futures:
                try:
                    results.append(future.result(timeout=20))
                except AppError as error:
                    self.assertEqual(error.code, "session_answer_conflict")
        self.assertEqual(len(results), 1)
        self.assertEqual(self.count("practice_records"), 1)

    def test_ai_failure_keeps_active_session_and_retry_can_complete(self):
        session = self.svc.start("u1", "s1", {})
        self.ai.failure = True
        with self.assertRaises(AIError):
            self.svc.submit("u1", session.session_id, "答案")
        self.assertEqual(self.svc.session_details("u1", session.session_id).status, "active")
        self.assertEqual(self.count("practice_attempts"), 0)
        self.ai.failure = False
        self.svc.submit("u1", session.session_id, "答案")
        self.assertEqual(self.count("practice_records"), 1)

    def test_mid_transaction_evidence_failure_rolls_back_entire_submission(self):
        session = self.svc.start("u1", "s1", {})
        original = ProgressRepository.add_evidence
        calls = 0

        def fail_second(repository, user_id, evidence):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("simulated disk failure")
            return original(repository, user_id, evidence)

        with patch.object(ProgressRepository, "add_evidence", fail_second), self.assertRaises(RuntimeError):
            self.svc.submit("u1", session.session_id, "答案")
        for table in ("practice_records", "practice_attempts", "atom_evidence"):
            self.assertEqual(self.count(table), 0)
        self.assertEqual(self.svc.session_details("u1", session.session_id).status, "active")
        self.svc.submit("u1", session.session_id, "答案")
        self.assertEqual(self.count("atom_evidence"), 2)

    def test_invalid_evidence_set_quotes_scores_and_statuses_never_write(self):
        def modify(mutator):
            def override(result):
                mutator(result["evidence"])
                return result
            return override

        mutations = [lambda items: items.pop(), lambda items: items.append(copy.deepcopy(items[0])),
                     lambda items: items[0].update(atomic_skill_id="extra"),
                     lambda items: items[0].update(quote="从未写过的引用"),
                     lambda items: items[0].update(quote=""),
                     lambda items: items[0].update(score=11), lambda items: items[0].update(score=-1),
                     lambda items: items[0].update(score=True), lambda items: items[0].update(score="8"),
                     lambda items: items[0].update(score=float("nan")),
                     lambda items: items[0].update(status="not_observable"),
                     lambda items: items[0].update(score=None), lambda items: items[0].update(reason="")]
        session = self.svc.start("u1", "s1", {})
        for index, mutation in enumerate(mutations):
            with self.subTest(index=index):
                self.ai.evaluation_override = modify(mutation)
                with self.assertRaises(AIError):
                    self.svc.submit("u1", session.session_id, "实际答案")
                self.assertEqual(self.count("atom_evidence"), 0)
                self.assertEqual(self.count("practice_records"), 0)

    def test_zero_score_for_omitted_work_is_valid_and_distinct_from_unobservable(self):
        def zero(result):
            result["evidence"][0].update(score=0.0, quote="")
            return result
        self.ai.evaluation_override = zero
        result = self.complete()
        self.assertEqual(result.evaluation_result.atomic_skill_scores, {"a1": 0, "a2": 8})
        self.assertEqual(result.evaluation_result.score, 4)
        state = self.summary().contexts[0]
        self.assertEqual((state.last_score, state.status, state.evidence_count), (0, "developing", 1))

    def test_partial_unobservable_is_retained_but_excluded_from_average_and_state(self):
        def partial(result):
            result["evidence"][0].update(status="not_observable", score=None, quote="")
            result["score"] = 1.0
            return result
        self.ai.evaluation_override = partial
        result = self.complete()
        self.assertEqual(result.evaluation_result.score, 8)
        self.assertEqual(result.evaluation_result.atomic_skill_scores, {"a2": 8})
        self.assertEqual(self.count("atom_evidence"), 2)
        self.assertEqual(self.summary().contexts[0].status, "unmeasured")
        self.assertIsNone(self.summary().contexts[0].last_score)

    def test_all_unobservable_rejects_without_recording_grade(self):
        def unavailable(result):
            for item in result["evidence"]:
                item.update(status="not_observable", score=None, quote="")
            return result
        self.ai.evaluation_override = unavailable
        with self.assertRaises(AIError) as error:
            self.complete()
        self.assertEqual(error.exception.code, "ai_unobservable_task")
        self.assertEqual(self.count("atom_evidence"), 0)
        self.assertEqual(self.count("practice_records"), 0)

    def test_guided_assisted_and_independent_evidence_are_distinct(self):
        self.complete("s3", "guided")
        self.assertEqual(self.summary().contexts[0].status, "assisted")
        self.assertEqual(self.summary().contexts[0].independent_count, 0)
        self.complete("s3", "independent", assistance=True)
        self.assertEqual(self.summary().contexts[0].status, "assisted")
        self.complete("s3", "independent")
        self.assertEqual(self.summary().contexts[0].status, "independent")
        self.assertEqual(self.summary().contexts[0].independent_count, 1)

    def test_contexts_do_not_share_scores_and_transfer_requires_two_successful_contexts(self):
        self.complete("s3", "transfer")
        first = self.summary()
        self.assertEqual([(state.context, state.status) for state in first.contexts], [("数据分析", "independent"), ("科研", "unmeasured")])
        self.assertFalse(first.transfer_observed)
        self.complete("s3", "transfer")
        self.assertFalse(self.summary().transfer_observed)
        self.complete("s2", "guided")
        self.assertFalse(self.summary().transfer_observed)
        self.complete("s2", "independent")
        self.assertTrue(self.summary().transfer_observed)

    def test_two_contexts_without_transfer_mode_do_not_claim_transfer(self):
        self.complete("s3", "independent")
        self.complete("s2", "independent")
        self.assertFalse(self.summary().transfer_observed)

    def test_recommendations_prioritize_prerequisites_without_locking_tasks(self):
        recommendations = self.evidence.recommendations("u1").recommendations
        self.assertEqual(recommendations[0].skill_id, "s3")
        self.assertIn("前置", recommendations[0].reason)
        self.assertEqual(recommendations[0].target_atomic_ids[0], "a1")
        self.assertEqual(self.svc.start("u1", "s1", {}).status, "active")
        self.assertEqual(self.ai.generations, 1)

    def test_recommendations_suggest_independence_and_separate_transfer_evidence(self):
        self.complete("s3", "guided")
        reasons = " ".join(item.reason for item in self.evidence.recommendations("u1").recommendations)
        self.assertIn("独立", reasons)
        self.complete("s3", "independent")
        recommendations = self.evidence.recommendations("u1").recommendations
        destination = next(item for item in recommendations if item.skill_id == "s2")
        self.assertIn("迁移", destination.reason)
        self.assertIn("不传播", destination.reason)
        for recommendation in recommendations:
            self.assertTrue(set(recommendation.target_atomic_ids) <= set(self.skills.get(recommendation.skill_id).atomic_skills))

    def test_recommendations_exclude_disabled_tasks_and_do_not_call_ai(self):
        self.skills.update("s3", SkillPatch(enabled=False))
        self.skills.delete("s2")
        recommendations = self.evidence.recommendations("u1").recommendations
        self.assertEqual([item.skill_id for item in recommendations], ["s1"])
        self.assertEqual(self.ai.calls, [])

    def test_later_weak_evidence_changes_current_state_without_erasing_prior_observations(self):
        self.complete("s3", "independent")
        def weak(result):
            result["evidence"][0]["score"] = 3.0
            return result
        self.ai.evaluation_override = weak
        self.complete("s3", "independent")
        state = self.summary().contexts[0]
        self.assertEqual((state.status, state.last_score, state.evidence_count, state.independent_count), ("developing", 3, 2, 1))

    def test_user_isolation_covers_sessions_history_records_evidence_and_recommendations(self):
        session = self.svc.start("u1", "s1", {})
        for operation in (lambda: self.svc.submit("u2", session.session_id, "答案"),
                          lambda: self.svc.session_details("u2", session.session_id)):
            with self.assertRaises(AppError) as error:
                operation()
            self.assertEqual(error.exception.status, 404)
        self.assertEqual(self.ai.evaluations, 0)
        self.svc.submit("u1", session.session_id, "答案")
        self.assertEqual(self.svc.history("u2"), [])
        self.assertEqual(self.records.list("u2"), [])
        self.assertEqual(self.evidence.dashboard("u2").recent_evidence, [])
        self.assertTrue(all(state.status == "unmeasured" for summary in self.evidence.dashboard("u2").atomic_skills for state in summary.contexts))

    def test_delete_task_and_record_preserves_snapshot_and_evidence(self):
        session = self.svc.start("u1", "s1", {})
        self.skills.delete("s1")
        result = self.svc.submit("u1", session.session_id, "答案")
        with self.assertRaises(AppError):
            self.svc.start("u1", "s1", {})
        with self.assertRaises(AppError):
            self.records.delete("u2", result.record_id)
        self.records.delete("u1", result.record_id)
        self.assertEqual(self.records.list("u1"), [])
        self.assertEqual(len(self.evidence.dashboard("u1").recent_evidence), 2)
        self.assertEqual(self.svc.session_details("u1", session.session_id).status, "completed")

    def test_task_mapping_validation_is_atomic(self):
        for changes in ({"description": "changed", "atomic_skills": ["missing"]},
                        {"atomic_skills": ["a1", "a1"]}, {"role_id": "missing"}, {"context": "不存在"}):
            with self.subTest(changes=changes), self.assertRaises(AppError):
                self.skills.update("s1", SkillPatch(**changes))
            self.assertEqual(self.skills.get("s1").description, "模拟对比报告")

    def test_atom_creation_validates_reference_integrity_and_reuses_existing_ids(self):
        atom = self.catalog["atoms"][0]
        fields = {key: value for key, value in atom.items() if key not in {"atomic_skill_id", "version"}}
        fields.update(name="新的行动原子", prerequisite_ids=["a1"])
        for changes in ({"knowledge_ids": ["missing"]}, {"prerequisite_ids": ["missing"]},
                        {"knowledge_ids": ["k1", "k1"]}, {"contexts": ["科研", "科研"]}, {"name": "比较"}):
            with self.subTest(changes=changes), self.assertRaises(AppError):
                self.skills.create_atom(AtomicCreate(**{**fields, **changes}))
            self.assertEqual(self.count("atomic_skills"), 2)
        created = self.skills.create_atom(AtomicCreate(**fields))
        self.assertEqual(created.knowledge_ids, ["k1"])
        self.assertEqual(created.prerequisite_ids, ["a1"])
        self.assertEqual(self.count("atomic_skills"), 3)

    def test_custom_task_reuses_catalog_atoms_and_saves_mapping(self):
        created = self.skills.custom("新的分析任务")
        self.assertEqual(created.atomic_skills, ["a1"])
        self.assertEqual(self.count("atomic_skills"), 2)
        self.assertEqual(self.count("skills"), 4)
        self.assertEqual(self.count("skill_atoms"), 5)
        self.svc.start("u1", created.skill_id, {})

    def test_custom_task_rejects_unsupported_atoms_context_role_and_duplicates(self):
        base = {"description": "任务", "task_brief": "分析材料", "deliverable": "结论", "context": "数据分析",
                "role_id": "r1", "atomic_skills": ["a1"]}
        for changes in ({"atomic_skills": []}, {"atomic_skills": ["missing"]}, {"atomic_skills": ["a1", "a1"]},
                        {"context": "未知"}, {"role_id": "missing"}):
            with self.subTest(changes=changes):
                self.ai.response = {**base, **changes}
                with self.assertRaises(AIError):
                    self.skills.custom("不能映射的任务")
                self.assertEqual(self.count("skills"), 3)
                self.assertEqual(self.count("atomic_skills"), 2)

    def test_custom_task_database_failure_rolls_back_mapping(self):
        with patch.object(SkillRepository, "add", side_effect=RuntimeError("simulated write failure")), self.assertRaises(RuntimeError):
            self.skills.custom("新任务")
        self.assertEqual(self.count("skills"), 3)
        self.assertEqual(self.count("skill_atoms"), 4)

    def test_foreign_keys_score_and_evidence_consistency_are_enforced(self):
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db.transaction() as connection:
                connection.execute("INSERT INTO skill_atoms VALUES ('missing','a1',0)")
        session = self.svc.start("u1", "s3", {})
        for status, score in (("observed", None), ("not_observable", 8), ("observed", 20)):
            with self.subTest(status=status, score=score), self.assertRaises(sqlite3.IntegrityError):
                with self.db.transaction() as connection:
                    connection.execute("""INSERT INTO atom_evidence
                        (session_id,user_id,atomic_skill_id,context,mode,assistance_used,status,score,quote,reason,next_action,created_at)
                        VALUES (?,?,?,'数据分析','guided',1,?,?,'','reason','action','2026-01-01')""",
                        (session.session_id, "u1", "a1", status, score))
        self.assertEqual(self.count("atom_evidence"), 0)

    def test_read_scope_rejects_writes(self):
        with self.assertRaises(sqlite3.OperationalError):
            with self.work.read() as unit:
                unit.users.ensure("must-not-be-created")
        self.assertEqual(self.count("users"), 0)

    def test_model_calls_have_no_open_unit_of_work(self):
        class TrackedWork:
            scopes = 0

            @contextmanager
            def read(inner):
                with self.work.read() as unit:
                    inner.scopes += 1
                    try:
                        yield unit
                    finally:
                        inner.scopes -= 1

            @contextmanager
            def write(inner):
                with self.work.write() as unit:
                    inner.scopes += 1
                    try:
                        yield unit
                    finally:
                        inner.scopes -= 1

        tracked = TrackedWork()
        services = build_services(tracked, self.ai)
        original = self.ai.generate_json

        def generate(task, payload):
            self.assertEqual(tracked.scopes, 0)
            return original(task, payload)

        with patch.object(self.ai, "generate_json", side_effect=generate):
            session = services.practice.start("u1", "s1", {})
            services.practice.submit("u1", session.session_id, "答案")
            services.skills.custom("新任务")

    def test_task_deleted_during_generation_cannot_create_session(self):
        def generate(task, payload):
            self.skills.delete("s1")
            return dict(CONTENT)
        with patch.object(self.ai, "generate_json", side_effect=generate), self.assertRaises(AppError):
            self.svc.start("u1", "s1", {})
        self.assertEqual(self.count("practice_sessions"), 0)
        self.assertEqual(self.count("users"), 0)

    def test_http_full_flow_and_lost_response_recovery(self):
        self.assertEqual(self.request("GET", "/api/v2/graph")[0], 200)
        status, value = self.request("POST", "/api/v1/practice/start", {"skill_id": "s1", "params": {"mode": "independent"}})
        self.assertEqual(status, 201)
        session_id = value["data"]["session_id"]
        self.assertEqual(value["data"]["content"]["example_answer"], "")
        status, submitted = self.request("POST", "/api/v1/practice/submit", {"session_id": session_id, "answer": "实际答案"})
        self.assertEqual(status, 200)
        status, recovered = self.request("GET", f"/api/v1/practice/sessions/{session_id}")
        self.assertEqual(status, 200)
        self.assertEqual(recovered["data"]["answer"], "实际答案")
        self.assertEqual(recovered["data"]["evaluation_result"], submitted["data"]["evaluation_result"])
        self.assertTrue(recovered["data"]["content"]["example_answer"])
        status, records = self.request("GET", "/api/practice/records")
        self.assertEqual((status, records["records"][0]["score"]), (200, 80))
        status, dashboard = self.request("GET", "/api/v2/evidence")
        self.assertEqual((status, len(dashboard["recent_evidence"])), (200, 2))
        self.assertEqual(self.request("GET", "/api/v2/recommendations")[0], 200)
        self.assertEqual(self.request("GET", "/api/user/profile")[1]["skills"]["s1"]["practice_count"], 1)

    def test_http_retires_global_progress_and_manual_scores_without_writes(self):
        cases = [("GET", "/api/v1/atomic/users/u1/skills"), ("POST", "/api/v1/atomic/users/u1/skills/a1/score"),
                 ("POST", "/api/v1/knowledge-tracing/update-mastery"), ("GET", "/api/v1/knowledge-tracing/predict/u1/a1"),
                 ("GET", "/api/v1/knowledge-tracing/mastery/all/u1"), ("POST", "/api/v1/atomic/optimize"),
                 ("POST", "/api/practice/record"), ("POST", "/api/user/skill/update")]
        for method, path in cases:
            with self.subTest(path=path):
                self.assertEqual(self.request(method, path, {"score": 10}, authenticated=False)[0], 410)
        self.assertEqual(self.count("users"), 0)
        self.assertEqual(self.count("atom_evidence"), 0)

    def test_http_boundaries_and_unconfigured_ai(self):
        client = OpenAIJSONClient(self.settings)
        status, health = self.request("GET", "/api/health", ai=client)
        self.assertEqual((status, health["ai_configured"]), (200, False))
        status, error = self.request("POST", "/api/v1/practice/start", {"skill_id": "s1"}, ai=client)
        self.assertEqual((status, error["code"]), (503, "ai_not_configured"))
        for body in ({"session_id": "x", "answer": "  "},
                     {"session_id": "x", "answer": "答案", "assistance_used": "false"}):
            self.assertEqual(self.request("POST", "/api/v1/practice/submit", body)[0], 422)
        self.assertEqual(self.request("GET", "/api/v1/skills/missing")[0], 404)

    def test_http_custom_task_crud_and_mapping(self):
        status, created = self.request("POST", "/api/skills/custom", {"skill_name": "新工作任务"})
        self.assertEqual(status, 201)
        skill_id = created["skill"]["skill_id"]
        self.assertEqual(self.request("PATCH", f"/api/v1/skills/{skill_id}", {"enabled": False})[0], 200)
        self.assertEqual(self.request("PATCH", f"/api/v1/skills/{skill_id}", {"enabled": None})[0], 422)
        self.assertEqual(self.request("DELETE", f"/api/skills/{skill_id}")[0], 200)

    def test_http_explicit_task_creation_preserves_shared_atom_definitions(self):
        fields = {key: value for key, value in self.catalog["tasks"][0].items() if key != "skill_id"}
        fields.update(name="手动任务", display_name="手动任务", atomic_skills=["a1"])
        status, created = self.request("POST", "/api/v1/skills", fields)
        self.assertEqual(status, 201)
        self.assertEqual(created["skill"]["atomic_skills"], ["a1"])
        self.assertEqual(self.count("atomic_skills"), 2)
        self.assertEqual(self.request("POST", "/api/v1/skills", fields)[0], 409)

    def test_preview_evaluation_never_writes_evidence(self):
        status, value = self.request("POST", "/api/v1/practice/evaluate", {"skill_id": "s1", "content": "实际答案", "reference": "模拟题"})
        self.assertEqual((status, value["evaluation"]["score"]), (200, 8))
        for table in ("practice_sessions", "practice_attempts", "practice_records", "atom_evidence"):
            self.assertEqual(self.count(table), 0)

    def test_transport_responses_and_chat_preserve_multiline_json_and_disable_retry(self):
        raw = json.dumps(CONTENT, ensure_ascii=False, indent=2)
        response = SimpleNamespace(output_text=raw, status="completed")
        completion = SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=raw))])
        for style in ("responses", "chat_completions"):
            with self.subTest(style=style), patch("openai.OpenAI") as factory:
                sdk = factory.return_value.__enter__.return_value
                sdk.responses.create.return_value = response
                sdk.chat.completions.create.return_value = completion
                settings = replace(self.settings, ai_api_key="test", ai_model="test", ai_api_style=style)
                self.assertEqual(OpenAIJSONClient(settings).generate_json("task", {"材料": "第一行\n第二行"}), CONTENT)
                self.assertEqual(factory.call_args.kwargs["max_retries"], 0)
                request = sdk.responses.create.call_args if style == "responses" else sdk.chat.completions.create.call_args
                input_text = request.kwargs["input"] if style == "responses" else request.kwargs["messages"][1]["content"]
                self.assertIn("json", input_text.lower())
                self.assertIn("第一行\\n第二行", input_text)

    def test_transport_rejects_invalid_json_nonobject_and_incomplete_output(self):
        for raw, status in (("not json", "completed"), ("[]", "completed"), ("{}", "incomplete")):
            with self.subTest(raw=raw, status=status), patch("openai.OpenAI") as factory:
                sdk = factory.return_value.__enter__.return_value
                sdk.responses.create.return_value = SimpleNamespace(output_text=raw, status=status)
                with self.assertRaises(AIError):
                    OpenAIJSONClient(replace(self.settings, ai_api_key="test", ai_model="test")).generate_json("task", {})

    def test_chat_transport_rejects_truncated_response(self):
        with patch("openai.OpenAI") as factory:
            sdk = factory.return_value.__enter__.return_value
            sdk.chat.completions.create.return_value = SimpleNamespace(choices=[
                SimpleNamespace(finish_reason="length", message=SimpleNamespace(content="{}"))])
            settings = replace(self.settings, ai_api_key="test", ai_model="test", ai_api_style="chat_completions")
            with self.assertRaises(AIError) as error:
                OpenAIJSONClient(settings).generate_json("task", {})
            self.assertEqual(error.exception.code, "ai_incomplete_response")

    def test_transport_maps_upstream_auth_and_rate_limit_without_retry(self):
        class UpstreamError(Exception):
            def __init__(self, status_code):
                self.status_code = status_code

        for upstream, status, code in ((401, 502, "ai_auth_failed"), (403, 502, "ai_auth_failed"), (429, 503, "ai_rate_limited")):
            with self.subTest(upstream=upstream), patch("openai.OpenAI") as factory:
                sdk = factory.return_value.__enter__.return_value
                sdk.responses.create.side_effect = UpstreamError(upstream)
                settings = replace(self.settings, ai_api_key="test", ai_model="test")
                with self.assertRaises(AIError) as error:
                    OpenAIJSONClient(settings).generate_json("task", {})
                self.assertEqual((error.exception.status, error.exception.code), (status, code))
                self.assertEqual(sdk.responses.create.call_count, 1)


if __name__ == "__main__":
    unittest.main()
