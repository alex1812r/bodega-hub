/**
 * Aplica un archivo .sql (o una consulta inline) contra el Postgres del proyecto.
 * Lee la conexion desde el .env del repo; no recibe secretos por linea de comandos.
 *
 *   node scripts/db-sql.mjs supabase/patches/20260903-algo.sql
 *   node scripts/db-sql.mjs -c "select 1"
 */
import fs from "node:fs";
import pg from "pg";

const ENV_PATH = new URL("../.env", import.meta.url);

const env = Object.fromEntries(
  fs
    .readFileSync(ENV_PATH, "utf8")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#\s*/, "").trim())
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);

const projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

const candidates = [
  { host: "aws-0-us-west-2.pooler.supabase.com", user: `postgres.${projectRef}` },
  { host: "aws-1-us-west-2.pooler.supabase.com", user: `postgres.${projectRef}` },
  { host: `db.${projectRef}.supabase.co`, user: "postgres" },
];

async function connect() {
  const errors = [];
  for (const { host, user } of candidates) {
    const client = new pg.Client({
      connectionTimeoutMillis: 10000,
      database: "postgres",
      host,
      password: env.SUPABASE_DB_PASS,
      port: 5432,
      ssl: { rejectUnauthorized: false },
      user,
    });
    try {
      await client.connect();
      return client;
    } catch (e) {
      errors.push(`${host}: ${String(e.message).slice(0, 120)}`);
    }
  }
  throw new Error(`No pude conectar.\n${errors.join("\n")}`);
}

const args = process.argv.slice(2);
const sql = args[0] === "-c" ? args.slice(1).join(" ") : fs.readFileSync(args[0], "utf8");

const client = await connect();
try {
  const res = await client.query(sql);
  for (const r of Array.isArray(res) ? res : [res]) {
    if (r.rows?.length) console.log(JSON.stringify(r.rows, null, 1));
    else console.log(`${r.command ?? "OK"} ${r.rowCount ?? ""}`.trim());
  }
} catch (e) {
  console.error("SQL ERROR:", e.message);
  if (e.position) console.error("position:", e.position);
  process.exitCode = 1;
} finally {
  await client.end();
}
