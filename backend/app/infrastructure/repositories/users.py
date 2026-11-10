from __future__ import annotations
import sqlite3
from ...domain.learning import utc_now
from ...domain.accounts import Account, AccountCredentials


class UserRepository:
    def __init__(self, connection: sqlite3.Connection):
        self._conn = connection

    def ensure(self, user_id: str) -> None:
        self._conn.execute("INSERT OR IGNORE INTO users VALUES (?,?)", (user_id, utc_now()))

    def account(self, username: str) -> AccountCredentials | None:
        record = self._conn.execute("SELECT * FROM accounts WHERE username=?", (username,)).fetchone()
        if record is None:
            return None
        return AccountCredentials(Account(user_id=record["user_id"], username=record["username"],
            display_name=record["display_name"]), record["password_salt"], record["password_hash"])

    def add_account(self, credentials: AccountCredentials) -> None:
        account = credentials.account
        self.ensure(account.user_id)
        self._conn.execute("INSERT INTO accounts VALUES (?,?,?,?,?)", (account.user_id,
            account.username, account.display_name, credentials.salt, credentials.password_hash))

    def add_session(self, token_hash: str, user_id: str, expires_at: int, now: int) -> None:
        self._conn.execute("DELETE FROM auth_sessions WHERE expires_at<=?", (now,))
        self._conn.execute("INSERT INTO auth_sessions VALUES (?,?,?)", (token_hash, user_id, expires_at))

    def session_account(self, token_hash: str, now: int) -> Account | None:
        record = self._conn.execute("""SELECT a.user_id,a.username,a.display_name FROM accounts a
            JOIN auth_sessions s ON a.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>?""",
            (token_hash, now)).fetchone()
        return Account(**dict(record)) if record else None

    def delete_session(self, token_hash: str) -> None:
        self._conn.execute("DELETE FROM auth_sessions WHERE token_hash=?", (token_hash,))

    def allow_auth_attempt(self, bucket: str, now: int) -> bool:
        self._conn.execute("DELETE FROM auth_attempts WHERE window_start<=?", (now - 60,))
        self._conn.execute("""INSERT INTO auth_attempts VALUES (?,?,1)
            ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1""", (bucket, now))
        attempts = self._conn.execute("SELECT attempts FROM auth_attempts WHERE bucket=?", (bucket,)).fetchone()[0]
        return attempts <= 20
