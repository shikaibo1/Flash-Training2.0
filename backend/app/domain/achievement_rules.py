"""Deterministic rules over saved snapshots. No model calls, browser scores or clocks."""
from datetime import datetime, timezone
from urllib.parse import quote
from .achievements import CATALOG, AchievementProgress, AchievementProof
from .models import EvidenceRecord, SessionHistory
from .projects import LearningProject, ProjectObservation


def time_key(value: str) -> float:
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return (parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)).timestamp()


def evaluate(projects: list[LearningProject], history: list[SessionHistory],
             evidence: list[EvidenceRecord], observations: list[ProjectObservation]):
    candidates: dict[str, dict[str, AchievementProof]] = {item.id: {} for item in CATALOG}

    def add(kind, identity, stamp, path, label):
        proof = AchievementProof(achieved_at=stamp, source_path=path, source_label=label)
        previous = candidates[kind].get(identity)
        if previous is None or time_key(stamp) < time_key(previous.achieved_at):
            candidates[kind][identity] = proof

    grouped: dict[str, list[EvidenceRecord]] = {}
    for record in evidence:
        grouped.setdefault(record.session_id, []).append(record)
    for session in history:
        if session.status != 'completed' or not session.end_time:
            continue
        records = grouped.get(session.session_id, [])
        path = f'/practice/{quote(session.skill_id, safe="")}?session_id={quote(session.session_id, safe="")}'
        identity = f'practice:{session.session_id}'
        add('first_task', identity, session.end_time, path, session.content.title)
        add('five_tasks', identity, session.end_time, path, session.content.title)
        if records:
            add('two_contexts', records[0].context, session.end_time, path, session.content.title)
        # Requiring every saved atom to agree prevents a partial snapshot from claiming independence.
        independent = bool(records) and all(not r.assistance_used and r.mode in ('independent', 'transfer') for r in records)
        if independent:
            add('first_independent', identity, session.end_time, path, session.content.title)
            for record in records:
                if record.status == 'observed' and record.score is not None and record.score >= 7 and record.quote.strip():
                    add('three_atoms', record.atomic_skill_id, record.created_at, path, session.content.title)

    observations_by_round: dict[tuple[str, str], list[ProjectObservation]] = {}
    for observation in observations:
        observations_by_round.setdefault((observation.project_id, observation.round_id), []).append(observation)
    for project in projects:
        path = f'/projects/{quote(project.project_id, safe="")}'
        add('first_goal', project.project_id, project.created_at, path, project.goal)
        events = sorted(project.events, key=lambda e: (time_key(e.created_at), e.event_id))
        for event in events:
            if event.kind == 'reflection':
                add('first_reflection', event.event_id, event.created_at, path, project.goal)
        rounds = {r.round_id: r for r in project.rounds}
        gap_found, help_after_gap = False, False
        materials: set[str] = set()
        # Follow recorded events, so later help cannot retroactively validate an earlier retest.
        for event in events:
            if event.kind == 'help' and gap_found:
                help_after_gap = True
            round_ = rounds.get(event.round_id)
            if event.kind != 'assessment' or round_ is None or round_.assessment is None or not round_.answer.strip():
                continue
            round_path = f'{path}#round-{quote(round_.round_id, safe="")}'
            identity = f'project:{project.project_id}:{round_.round_id}'
            records = observations_by_round.get((project.project_id, round_.round_id), [])
            assisted = round_.assistance_used or any(o.assistance_used for o in records)
            if round_.stage == 'probe':
                add('first_probe', identity, event.created_at, round_path, round_.content.title)
                continue
            add('first_task', identity, event.created_at, round_path, round_.content.title)
            add('five_tasks', identity, event.created_at, round_path, round_.content.title)
            if project.skill:
                add('two_contexts', project.skill.context, event.created_at, round_path, round_.content.title)
            if not assisted:
                add('first_independent', identity, event.created_at, round_path, round_.content.title)
                for observation in records:
                    if observation.stage != 'probe' and observation.finding.state == 'supported' and observation.finding.quote.strip():
                        add('three_atoms', observation.atomic_skill_id, observation.created_at, round_path, round_.content.title)
            novel = bool(materials) and round_.content.materials.strip() not in materials
            if round_.stage == 'verification' and novel and not assisted:
                add('first_retest', identity, event.created_at, round_path, round_.content.title)
                targets = set(round_.target_ids)
                findings = round_.assessment.findings
                supported = (bool(targets) and len(findings) == len(targets)
                             and {f.atomic_skill_id for f in findings} == targets
                             and all(f.state == 'supported' and f.quote.strip() for f in findings))
                if supported and help_after_gap:
                    add('learning_loop', identity, event.created_at, round_path, round_.content.title)
            materials.add(round_.content.materials.strip())
            if any(f.state == 'gap' for f in round_.assessment.findings):
                gap_found = True
                help_after_gap = False

    progress = []
    for definition in CATALOG:
        proofs = sorted(candidates[definition.id].values(), key=lambda p: (time_key(p.achieved_at), p.source_path))
        progress.append(AchievementProgress(achievement_id=definition.id, count=len(proofs),
            proof=proofs[definition.target - 1] if len(proofs) >= definition.target else None))
    return progress
