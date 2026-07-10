const DEFAULT_MAX_URL =
  "https://max.ru/u/f9LHodD0cOKSJihr4puAfiyfPGQJWImlRAdNuRhpYwI7qse5YaB625-1d3w";

export async function POST() {
  let maxUrl = DEFAULT_MAX_URL;
  try {
    const origin = process.env.APP_PUBLIC_URL?.trim() || process.env.SITE_URL?.trim() || "http://127.0.0.1:3000";
    const res = await fetch(new URL("/api/site/status", origin.replace(/\/$/, "")).toString(), {
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    const url = String(data?.support_max_url || "").trim();
    if (url) maxUrl = url;
  } catch {
    /* keep default */
  }
  return Response.json(
    {
      error: `Сброс пароля по email отключён. Напишите администратору в MAX: ${maxUrl}`,
    },
    { status: 410 },
  );
}
