export function stripBlogHtmlText(html: string): string {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Есть ли в HTML осмысленный текст или встроенные медиа. */
export function blogHtmlHasContent(html: string): boolean {
  const raw = String(html || "").trim();
  if (!raw) return false;
  if (stripBlogHtmlText(raw).length > 0) return true;
  return /<(img|video|iframe|audio|picture|source)\b/i.test(raw);
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Текст из редактора + запасной вариант из описания или первого медиа. */
export function resolveBlogBodyHtml(
  html: string,
  excerpt: string,
  media: { url: string; mime?: string | null }[],
): string {
  const raw = String(html || "").trim();
  if (blogHtmlHasContent(raw)) return raw;
  const ex = String(excerpt || "").trim();
  if (ex) return `<p>${escapeHtmlAttr(ex)}</p>`;
  const first = media.find((m) => String(m.url || "").trim());
  if (!first) return "";
  const url = escapeHtmlAttr(String(first.url).trim());
  const mime = String(first.mime || "");
  if (mime.startsWith("video/")) {
    return `<p><video controls playsinline style="max-width:100%;border-radius:12px" src="${url}"></video></p>`;
  }
  return `<p><img src="${url}" alt="" style="max-width:100%;border-radius:12px" /></p>`;
}
