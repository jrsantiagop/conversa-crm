/**
 * Supabase / PostgreSQL smoke check for Conversa CRM.
 *
 * Usage:
 *   node --env-file=.env.local scripts/supabase-check.mjs
 *
 * Prints only the schema name, the number of tables and row counts. It never
 * prints DATABASE_URL or any credential; error messages are redacted first.
 */

import { Client } from "pg";

const EXPECTED_TABLES = [
  "workspaces",
  "users",
  "contacts",
  "inboxes",
  "conversations",
  "messages",
  "knowledge_articles",
  "deals",
  "tasks",
];

const connectionString = process.env.DATABASE_URL;

/** Make sure no connection detail can leak through an error message. */
function redact(message) {
  let text = String(message);
  if (connectionString) {
    text = text.split(connectionString).join("[redacted connection string]");
  }
  return text
    .replace(/\bpostgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\bpassword\s*=\s*\S+/gi, "password=[redacted]")
    .replace(/\/\/[^/@\s]+:[^/@\s]+@/g, "//[redacted]@");
}

async function main() {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Put it in .env.local, then run: " +
        "node --env-file=.env.local scripts/supabase-check.mjs",
    );
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();

    const schemaResult = await client.query("SELECT current_schema() AS schema");
    const schema = schemaResult.rows[0]?.schema ?? "public";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
      throw new Error("PostgreSQL returned an unexpected schema name.");
    }

    const tablesResult = await client.query(
      "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1",
      [schema],
    );
    const found = new Set(tablesResult.rows.map((row) => row.tablename));
    const missing = EXPECTED_TABLES.filter((table) => !found.has(table));

    if (missing.length > 0) {
      console.error(
        `Schema check failed: ${missing.length} of ${EXPECTED_TABLES.length} expected tables are missing.`,
      );
      console.error(`Missing tables: ${missing.join(", ")}`);
      console.error(
        "Apply supabase/migrations/0001_init.sql in the Supabase SQL Editor and run this check again.",
      );
      process.exitCode = 1;
      return;
    }

    // Table names come from the hardcoded allow-list above, never from input.
    // Quoting identifiers keeps the generated query safe and deterministic.
    const countsSql = EXPECTED_TABLES.map(
      (table) => `(SELECT count(*)::bigint AS total FROM "${schema}"."${table}")`,
    ).join(" UNION ALL ");
    const countsResult = await client.query(countsSql);

    console.log(`Connected to PostgreSQL. Schema: ${schema}.`);
    console.log(`Tables found: ${found.size} (${EXPECTED_TABLES.length} expected).`);
    console.log();
    console.log("Table                     Rows");
    console.log("------------------------- ----------");
    EXPECTED_TABLES.forEach((table, index) => {
      const total = countsResult.rows[index]?.total ?? "?";
      console.log(`${table.padEnd(25)} ${String(total).padStart(10)}`);
    });
    console.log();
    console.log(`OK: all ${EXPECTED_TABLES.length} expected tables are present.`);
  } finally {
    try {
      await client.end();
    } catch {
      // Ignore cleanup errors; the outcome was already reported above.
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Database check failed: ${redact(message)}`);
  process.exitCode = 1;
});
