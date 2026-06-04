import type { FastifyBaseLogger } from "fastify";
import { pgPool } from "./pg.js";

type Logger = FastifyBaseLogger | { error: (...args: unknown[]) => void };

/** Не даём необработанным ошибкам валить Node — иначе nginx отдаёт 502. */
export function attachProcessStabilityGuards(log?: Logger): void {
  const logger = log ?? console;

  process.on("uncaughtException", (err) => {
    logger.error({ err }, "uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "unhandledRejection");
  });

  pgPool.on("error", (err) => {
    logger.error({ err }, "postgres pool error");
  });
}

/** Безопасный фоновый тик (иначе `void fn()` даёт unhandledRejection и exit code 1). */
export function runSafeAsync(
  label: string,
  fn: () => Promise<unknown>,
  log?: Logger,
): void {
  const logger = log ?? console;
  fn().catch((err) => {
    logger.error({ err, label }, "background task failed");
  });
}

export function startSafeInterval(
  label: string,
  fn: () => Promise<unknown>,
  ms: number,
  log?: Logger,
): ReturnType<typeof setInterval> {
  runSafeAsync(label, fn, log);
  const id = setInterval(() => runSafeAsync(label, fn, log), ms);
  if (typeof id.unref === "function") id.unref();
  return id;
}
