"""Database administration without starting HTTP or contacting a model."""
import argparse
import json
import sqlite3
from pathlib import Path
from .infrastructure.database import Database
from .infrastructure.catalog_seed import seed_catalog
from .settings import Settings


def main():
    parser = argparse.ArgumentParser(description="Flash Training SQLite management")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("migrate", help="Initialize schema v4 or back up and upgrade v2/v3; seed catalog once")
    commands.add_parser("inspect", help="Show schema version and row counts")
    backup = commands.add_parser("backup", help="Create a consistent SQLite backup (also works while server runs)")
    backup.add_argument("destination", type=Path)
    args = parser.parse_args()
    settings = Settings.from_env()
    db = Database(settings.database_path)
    if args.command == "migrate":
        db.initialize()
        seed_catalog(db, settings.catalog_path)
        print("Database schema v4 and career catalog v2 are ready.")
        return
    if not db.path.exists():
        parser.error("Database does not exist. Run migrate first.")
    if args.command == "backup":
        target = args.destination.resolve()
        if target == db.path.resolve() or target.exists():
            parser.error("Choose a new backup filename; existing files are never overwritten.")
        target.parent.mkdir(parents=True, exist_ok=True)
        # Reserve the target atomically rather than overwriting a racing writer.
        with target.open("xb"):
            pass
        source = db.connect()
        destination = sqlite3.connect(target)
        try:
            source.backup(destination)
            print(f"Backup saved: {target}")
        finally:
            destination.close()
            source.close()
        return
    with db.read() as conn:
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        counts = {name: conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0] for name in tables}
        result = {"database": str(db.path), "schema_version": conn.execute("PRAGMA user_version").fetchone()[0],
                  "integrity": conn.execute("PRAGMA integrity_check").fetchone()[0],
                  "foreign_key_violations": len(conn.execute("PRAGMA foreign_key_check").fetchall()), "tables": counts}
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
