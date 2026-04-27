import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
  },
  turbopack: {
    root: path.resolve(here, ".."),
  },
  /**
   * WebSocket: браузер подключается напрямую к Fastify (см. layout).
   * HTTP API: прокси в middleware → AB_UPSTREAM_ORIGIN (по умолчанию http://127.0.0.1:8787).
   */
  env: {
    NEXT_PUBLIC_AB_WS_ORIGIN: (process.env.NEXT_PUBLIC_AB_WS_ORIGIN || "").replace(/\/$/, ""),
  },
};

export default nextConfig;
