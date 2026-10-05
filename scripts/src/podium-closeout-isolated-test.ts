import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pool } from "@workspace/db";

const closeoutTestPath = "../artifacts/api-server/src/services/podium-closeout.db.test.ts";
const sourceTables = [
  "users",
  "sessions",
  "challenges",
  "entries",
  "daily_step_records",
  "wallet_ledger_entries",
] as const;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function createIsolatedSchema(schemaName: string) {
  const schema = quoteIdentifier(schemaName);
  await pool.query(`CREATE SCHEMA ${schema}`);

  for (const tableName of sourceTables) {
    await pool.query(
      `CREATE TABLE ${schema}.${quoteIdentifier(tableName)} (LIKE public.${quoteIdentifier(tableName)} INCLUDING ALL)`,
    );
  }

  await pool.query(
    `ALTER TABLE ${schema}.challenges
       ADD COLUMN IF NOT EXISTS closeout_alert_claim_id varchar,
       ADD COLUMN IF NOT EXISTS closeout_alert_claimed_at timestamptz,
       ADD COLUMN IF NOT EXISTS closeout_alert_sent_at timestamptz`,
  );

  const serialColumns = await pool.query<{
    table_name: (typeof sourceTables)[number];
    column_name: string;
  }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
        AND column_default LIKE 'nextval(%'`,
    [sourceTables],
  );

  for (const { table_name: tableName, column_name: columnName } of serialColumns.rows) {
    const sequenceName = `${tableName}_${columnName}_test_seq`;
    const sequence = `${schema}.${quoteIdentifier(sequenceName)}`;
    const table = `${schema}.${quoteIdentifier(tableName)}`;
    const column = quoteIdentifier(columnName);

    await pool.query(`CREATE SEQUENCE ${sequence}`);
    await pool.query(
      `ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT nextval('${schemaName}.${sequenceName}'::regclass)`,
    );
    await pool.query(`ALTER SEQUENCE ${sequence} OWNED BY ${table}.${column}`);
  }

  const foreignKeys = [
    `ALTER TABLE ${schema}.entries
       ADD CONSTRAINT entries_test_user_fk
       FOREIGN KEY (user_id) REFERENCES ${schema}.users (id) ON DELETE CASCADE`,
    `ALTER TABLE ${schema}.entries
       ADD CONSTRAINT entries_test_challenge_fk
       FOREIGN KEY (challenge_id) REFERENCES ${schema}.challenges (id) ON DELETE CASCADE`,
    `ALTER TABLE ${schema}.daily_step_records
       ADD CONSTRAINT daily_step_records_test_user_fk
       FOREIGN KEY (user_id) REFERENCES ${schema}.users (id) ON DELETE CASCADE`,
    `ALTER TABLE ${schema}.daily_step_records
       ADD CONSTRAINT daily_step_records_test_challenge_fk
       FOREIGN KEY (challenge_id) REFERENCES ${schema}.challenges (id) ON DELETE SET NULL`,
    `ALTER TABLE ${schema}.wallet_ledger_entries
       ADD CONSTRAINT wallet_ledger_entries_test_user_fk
       FOREIGN KEY (user_id) REFERENCES ${schema}.users (id) ON DELETE CASCADE`,
    `ALTER TABLE ${schema}.wallet_ledger_entries
       ADD CONSTRAINT wallet_ledger_entries_test_challenge_fk
       FOREIGN KEY (challenge_id) REFERENCES ${schema}.challenges (id) ON DELETE SET NULL`,
  ];

  for (const statement of foreignKeys) await pool.query(statement);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run the isolated podium closeout test.");
  }

  const schemaName = `podium_closeout_test_${randomUUID().replaceAll("-", "")}`;
  const schema = quoteIdentifier(schemaName);
  let testExitCode = 1;

  try {
    await createIsolatedSchema(schemaName);

    const isolatedDatabaseUrl = new URL(databaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schemaName}`);
    const result = spawnSync("pnpm", ["exec", "tsx", "--test", closeoutTestPath], {
      env: {
        ...process.env,
        DATABASE_URL: isolatedDatabaseUrl.toString(),
        PODIUM_CLOSEOUT_TEST_SCHEMA: schemaName,
      },
      stdio: "inherit",
    });

    if (result.error) throw result.error;
    testExitCode = result.status ?? 1;
  } finally {
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
    }
  }

  if (testExitCode !== 0) process.exitCode = testExitCode;
}

await main();