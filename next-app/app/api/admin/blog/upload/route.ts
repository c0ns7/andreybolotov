import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** До 10 мин на приём большого видео при прокси через Next */
export const maxDuration = 600;

function upstreamOrigin(): string {
  return (process.env.AB_UPSTREAM_ORIGIN || "http://127.0.0.1:8787").replace(/\/$/, "");
}

export async function POST(request: NextRequest) {
  const target = `${upstreamOrigin()}/api/admin/blog/upload`;
  const headers = new Headers();
  const auth = request.headers.get("authorization");
  if (auth) headers.set("authorization", auth);
  const ct = request.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  const cl = request.headers.get("content-length");
  if (cl) headers.set("content-length", cl);

  let res: Response;
  try {
    res = await fetch(target, {
      method: "POST",
      headers,
      body: request.body,
      duplex: "half",
    } as RequestInit);
  } catch {
    return NextResponse.json({ error: "Не удалось связаться с API." }, { status: 502 });
  }

  const buf = await res.arrayBuffer();
  return new NextResponse(buf, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "application/json; charset=utf-8" },
  });
}
