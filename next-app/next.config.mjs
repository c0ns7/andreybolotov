import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
    /** proxy.ts буферизует тело запроса; без этого лимит по умолчанию может резать загрузки */
    proxyClientMaxBodySize: "500mb",
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
    /** Прямой URL API для загрузок (обход nginx 1 МБ), например https://api.example.com */
    NEXT_PUBLIC_AB_HTTP_ORIGIN: (process.env.NEXT_PUBLIC_AB_HTTP_ORIGIN || "").replace(/\/$/, ""),
    /** Только большие upload (поддомен без Cloudflare, nginx 500M). Пример: https://api.andreybolotov.ru */
    NEXT_PUBLIC_AB_UPLOAD_ORIGIN: (process.env.NEXT_PUBLIC_AB_UPLOAD_ORIGIN || "").replace(/\/$/, ""),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/admin",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
