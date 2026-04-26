import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { pgPool } from "../server/pg.js";

function sqlitePathFromEnv(): string {
  const envPath = String(process.env.AB_SQLITE_PATH ?? "").trim();
  if (envPath) return path.resolve(envPath);
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../data/app.db");
}

async function copyTable(
  tableName: string,
  columns: string[],
  sqlite: Database.Database,
): Promise<void> {
  const selectSql = `SELECT ${columns.join(", ")} FROM ${tableName}`;
  const rows = sqlite.prepare(selectSql).all() as Record<string, unknown>[];
  if (!rows.length) {
    console.log(`[migrate] ${tableName}: 0 rows`);
    return;
  }
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (const row of chunk) {
      const tuple: string[] = [];
      for (const col of columns) {
        values.push(row[col]);
        tuple.push(`$${values.length}`);
      }
      tuples.push(`(${tuple.join(", ")})`);
    }
    const upsertSql = `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES ${tuples.join(", ")} ON CONFLICT DO NOTHING`;
    await pgPool.query(upsertSql, values);
  }
  console.log(`[migrate] ${tableName}: ${rows.length} rows`);
}

async function setIdentity(tableName: string): Promise<void> {
  await pgPool.query(
    `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${tableName}), 1), true)`,
    [tableName],
  );
}

async function main() {
  const sqliteFile = sqlitePathFromEnv();
  const sqlite = new Database(sqliteFile, { readonly: true });
  console.log("[migrate] sqlite:", sqliteFile);

  await copyTable(
    "users",
    [
      "id",
      "phone",
      "name",
      "email",
      "password_hash",
      "created_at",
      "role",
      "blocked",
      "email_notify_chat",
      "email_notify_raffles",
      "chat_unread_email_last_at",
      "email_notify_raffle_orders",
      "last_active_at",
    ],
    sqlite,
  );
  await copyTable("sessions", ["token", "user_id", "created_at"], sqlite);
  await copyTable(
    "support_messages",
    [
      "id",
      "user_id",
      "body",
      "is_staff",
      "created_at",
      "read_by_staff_at",
      "read_by_user_at",
      "attachment_url",
      "attachment_name",
      "attachment_mime",
    ],
    sqlite,
  );
  await copyTable(
    "raffles",
    [
      "id",
      "raffle_hash",
      "title",
      "cover_image_url",
      "price_rub",
      "cenopad_enabled",
      "cenopad_price_rub",
      "old_price_rub",
      "ticket_count",
      "collection_url",
      "tbank_collection_url",
      "collection_recipient",
      "sber_collection_recipient",
      "tbank_collection_recipient",
      "qr_image_url",
      "qr_recipient",
      "qr_payment_purpose",
      "sber_enabled",
      "tbank_enabled",
      "qr_enabled",
      "rules_url",
      "live_stream_note",
      "live_stream_url",
      "status",
      "sort_order",
      "wholesale_enabled",
      "promo_5_plus_1_enabled",
      "promo_5_plus_1_locked_free_count",
      "hidden_from_public",
      "launch_notify_sent_at",
      "created_at",
      "updated_at",
    ],
    sqlite,
  );
  await copyTable(
    "raffle_orders",
    [
      "id",
      "raffle_id",
      "user_id",
      "bank",
      "amount_rub",
      "ticket_count",
      "cenopad_applied",
      "status",
      "reserved_until",
      "reserve_extended_once",
      "reserve_reminder_sent_at",
      "receipt_url",
      "receipt_name",
      "receipt_mime",
      "receipt_reject_count",
      "last_reject_comment",
      "public_status_token",
      "receipt_sha256",
      "receipt_same_as_previous",
      "created_at",
      "updated_at",
    ],
    sqlite,
  );
  await copyTable(
    "raffle_ticket_holds",
    [
      "id",
      "raffle_id",
      "order_id",
      "user_id",
      "ticket_number",
      "is_bonus",
      "hold_status",
      "expires_at",
      "created_at",
    ],
    sqlite,
  );
  await copyTable(
    "raffle_order_events",
    ["id", "order_id", "kind", "detail", "created_at"],
    sqlite,
  );
  await copyTable("used_receipts", ["sha256", "first_order_id", "created_at"], sqlite);
  await copyTable("site_settings", ["id", "maintenance_enabled"], sqlite);
  await copyTable(
    "raffle_wholesale_assignments",
    ["id", "raffle_id", "user_id", "user_slot_index", "wholesale_number", "created_at"],
    sqlite,
  );
  await copyTable(
    "raffle_phone_preassignments",
    ["id", "raffle_id", "ticket_number", "phone", "created_at"],
    sqlite,
  );
  await copyTable(
    "password_reset_tokens",
    ["id", "user_id", "token_hash", "expires_at", "created_at"],
    sqlite,
  );

  await setIdentity("users");
  await setIdentity("support_messages");
  await setIdentity("raffles");
  await setIdentity("raffle_orders");
  await setIdentity("raffle_ticket_holds");
  await setIdentity("raffle_order_events");
  await setIdentity("raffle_wholesale_assignments");
  await setIdentity("raffle_phone_preassignments");
  await setIdentity("password_reset_tokens");

  sqlite.close();
  console.log("[migrate] done");
}

main()
  .catch((err) => {
    console.error("[migrate] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pgPool.end();
  });
