/// <reference types="node" />
// A stand-in for the Worker's D1 binding in tests: the same SQL, the
// Frontend's own migrations, on Node's SQLite. Open it again on the same file
// to restart the Worker with its stored state. `unavailable` makes every
// query fail, as an unreachable D1 would.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { SqlDatabase, SqlStatement } from "../lib/publications";

const migrations = new URL("../../migrations/", import.meta.url);

export interface TestD1 extends SqlDatabase {
  unavailable: boolean;
  /** Runs SQL directly, as a later migration or another Worker version would. */
  exec(sql: string): void;
  close(): void;
}

export function openTestD1(path = ":memory:"): TestD1 {
  const db = new DatabaseSync(path);
  const applied = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'publications'")
    .get();
  if (!applied) {
    for (const file of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      db.exec(readFileSync(new URL(file, migrations), "utf8"));
    }
  }

  const d1: TestD1 = {
    unavailable: false,
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
    prepare(query) {
      const statement = (values: unknown[]): SqlStatement => {
        const run = <T>(work: () => T) => {
          if (d1.unavailable)
            return Promise.reject(new Error("D1_ERROR: Network connection lost."));
          return Promise.resolve().then(work);
        };
        const prepared = () => db.prepare(query);
        const parameters = values as Array<string | number | null>;
        return {
          bind: (...next) => statement(next),
          first: <T>() => run(() => (prepared().get(...parameters) ?? null) as T | null),
          run: () =>
            run(() => ({ meta: { changes: Number(prepared().run(...parameters).changes) } })),
        };
      };
      return statement([]);
    },
  };
  return d1;
}
