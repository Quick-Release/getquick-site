/// <reference types="node" />
// A stand-in for the Worker's D1 binding in tests: the same SQL, the
// Frontend's own migrations, on Node's SQLite. Open it again on the same file
// to restart the Worker with its stored state. `unavailable` makes every
// query fail, as an unreachable D1 would. `batch` runs in one transaction, as
// D1's does.
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
  // Each statement's rows, for batch to run it inside its transaction.
  const rowsOf = new WeakMap<SqlStatement, () => unknown[]>();
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
    async batch<T>(statements: SqlStatement[]) {
      await Promise.resolve();
      if (d1.unavailable) throw new Error("D1_ERROR: Network connection lost.");
      db.exec("BEGIN");
      try {
        const results = statements.map((statement) => ({
          results: rowsOf.get(statement)!() as T[],
        }));
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(query) {
      const statement = (values: unknown[]): SqlStatement => {
        const run = <T>(work: () => T) => {
          if (d1.unavailable)
            return Promise.reject(new Error("D1_ERROR: Network connection lost."));
          return Promise.resolve().then(work);
        };
        const prepared = () => db.prepare(query);
        const parameters = values as Array<string | number | null>;
        const bound: SqlStatement = {
          bind: (...next) => statement(next),
          first: <T>() => run(() => (prepared().get(...parameters) ?? null) as T | null),
          all: <T>() => run(() => ({ results: prepared().all(...parameters) as T[] })),
          run: () =>
            run(() => ({ meta: { changes: Number(prepared().run(...parameters).changes) } })),
        };
        rowsOf.set(bound, () => prepared().all(...parameters));
        return bound;
      };
      return statement([]);
    },
  };
  return d1;
}
