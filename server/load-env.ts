/**
 * Загрузка .env из корня репозитория (рядом с package.json), а не из process.cwd().
 * Иначе при запуске API из другой папки SMTP_* и SMTP_DEBUG не подхватываются.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(serverDir, "..");
const envPath = path.join(projectRoot, ".env");
const envLocalPath = path.join(projectRoot, ".env.local");

dotenv.config({ path: envPath });
dotenv.config({ path: envLocalPath });

const debugBoot =
  String(process.env.SMTP_DEBUG ?? "")
    .trim()
    .toLowerCase() === "1" ||
  String(process.env.SMTP_DEBUG ?? "")
    .trim()
    .toLowerCase() === "true";

if (debugBoot) {
  console.log("[env] debug mode enabled");
}
