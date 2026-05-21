import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

const ROOTS_PUBLIC = [
  path.resolve(process.cwd(), "public"),
  path.resolve(process.cwd(), "..", "public"),
];

function contentTypeByExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function cacheControlByExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  // JS/CSS should always be fresh because admin/public scripts change frequently.
  if (ext === ".js" || ext === ".css") return "no-store";
  return "public, max-age=3600";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path: parts } = await context.params;
  const rel = Array.isArray(parts) ? parts.join("/") : "";
  if (!rel) return new Response("Not Found", { status: 404 });
  for (const root of ROOTS_PUBLIC) {
    const rootAbs = path.resolve(root);
    const abs = path.resolve(rootAbs, rel);
    if (!abs.startsWith(rootAbs)) continue;
    if (!existsSync(abs)) continue;
    try {
      const data = await fs.readFile(abs);
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": contentTypeByExt(abs),
          "Cache-Control": cacheControlByExt(abs),
        },
      });
    } catch {
      /* try next root */
    }
  }
  return new Response("Not Found", { status: 404 });
}
