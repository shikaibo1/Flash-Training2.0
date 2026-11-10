from __future__ import annotations
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator
from ..domain.ports import UnitOfWork
from .database import Database
from .repositories.skills import SkillRepository
from .repositories.practice import PracticeRepository
from .repositories.progress import ProgressRepository
from .repositories.users import UserRepository
from .repositories.projects import ProjectRepository


@dataclass(frozen=True)
class SQLiteUnitOfWork:
    skills: SkillRepository
    practices: PracticeRepository
    progress: ProgressRepository
    users: UserRepository
    projects: ProjectRepository


class SQLiteUnitOfWorkFactory:
    """A scope owns one connection. Commit only on successful write scope exit."""
    def __init__(self, database: Database):
        self._database = database

    @contextmanager
    def read(self) -> Iterator[UnitOfWork]:
        with self._database.read() as connection:
            yield self._bind(connection)

    @contextmanager
    def write(self) -> Iterator[UnitOfWork]:
        with self._database.transaction() as connection:
            yield self._bind(connection)

    @staticmethod
    def _bind(connection) -> SQLiteUnitOfWork:
        return SQLiteUnitOfWork(SkillRepository(connection), PracticeRepository(connection),
                                ProgressRepository(connection), UserRepository(connection), ProjectRepository(connection))
