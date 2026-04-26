import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { pgPool } from "../server/pg.js";

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.join(here, "pg-schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pgPool.query(sql);
  console.log("[pg-init] schema applied");
}

main()
  .catch((err) => {
    console.error("[pg-init] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pgPool.end();
  });
