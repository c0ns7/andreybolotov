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
function normalizeMediaUrl(url: string): string {
  const u = String(url || "").trim();
  if (!u) return "";
  try {
    return new URL(u, "https://local.invalid").pathname;
  } catch {
    return u.split("?")[0]?.split("#")[0] || u;
  }
}

/** Убирает из HTML картинки/видео, которые уже показаны в галерее поста. */
export function stripBlogBodyDuplicateMedia(html: string, media: { url: string }[]): string {
  const raw = String(html || "").trim();
  if (!raw || !media.length) return raw;
  const paths = new Set(media.map((m) => normalizeMediaUrl(m.url)).filter(Boolean));
  if (!paths.size) return raw;

  if (typeof DOMParser === "undefined") {
    return raw
      .replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (tag, src) =>
        paths.has(normalizeMediaUrl(src)) ? "" : tag,
      )
      .replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, (tag) => {
        const m = tag.match(/\bsrc=["']([^"']+)["']/i);
        return m && paths.has(normalizeMediaUrl(m[1])) ? "" : tag;
      })
      .replace(/<p>\s*<\/p>/gi, "");
  }

  const doc = new DOMParser().parseFromString(raw, "text/html");
  doc.body.querySelectorAll("img, video").forEach((el) => {
    const src = el.getAttribute("src") || "";
    if (paths.has(normalizeMediaUrl(src))) el.remove();
  });
  doc.body.querySelectorAll("p").forEach((p) => {
    if (!p.textContent?.trim() && !p.querySelector("img, video, iframe")) p.remove();
  });
  return doc.body.innerHTML.trim();
}

function normalizePlainText(s: string): string {
  return stripBlogHtmlText(s).replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = row[j]!;
      row[j] = next;
    }
  }
  return row[b.length]!;
}

/** Почти одинаковый текст (опечатка, обрезанный символ, лишний пробел). */
export function blogPlainTextsDuplicate(a: string, b: string): boolean {
  const na = normalizePlainText(a);
  const nb = normalizePlainText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return true;
  const dist = levenshtein(na, nb);
  if (dist / maxLen <= 0.08) return true;
  if (Math.abs(na.length - nb.length) <= 4) {
    const shorter = na.length <= nb.length ? na : nb;
    const longer = na.length <= nb.length ? nb : na;
    if (longer.includes(shorter) && shorter.length / longer.length >= 0.9) return true;
  }
  return false;
}

/** Убирает из начала body абзацы, совпадающие с кратким описанием (excerpt уже показывается отдельно). */
export function stripBlogBodyDuplicateExcerpt(html: string, excerpt: string): string {
  const raw = String(html || "").trim();
  const ex = String(excerpt || "").trim();
  if (!raw || !ex) return raw;
  const exNorm = normalizePlainText(ex);
  if (!exNorm) return raw;

  if (typeof DOMParser === "undefined") {
    const bodyNorm = normalizePlainText(raw);
    return blogPlainTextsDuplicate(bodyNorm, exNorm) ? "" : raw;
  }

  const doc = new DOMParser().parseFromString(raw, "text/html");
  const isMatch = (el: Element) => {
    const text = normalizePlainText(el.textContent || "");
    if (!text) return !el.querySelector("img, video, iframe, audio, picture");
    return blogPlainTextsDuplicate(text, exNorm);
  };

  while (doc.body.firstElementChild && isMatch(doc.body.firstElementChild)) {
    doc.body.firstElementChild.remove();
  }
  const result = doc.body.innerHTML.trim();
  if (blogPlainTextsDuplicate(result, ex)) return "";
  return result;
}

export function resolveBlogBodyHtml(
  html: string,
  excerpt: string,
  media: { url: string; mime?: string | null }[],
): string {
  const raw = String(html || "").trim();
  if (blogHtmlHasContent(raw)) return raw;
  const ex = String(excerpt || "").trim();
  if (ex) return "";
  const first = media.find((m) => String(m.url || "").trim());
  if (!first) return "";
  const url = escapeHtmlAttr(String(first.url).trim());
  const mime = String(first.mime || "");
  if (mime.startsWith("video/")) {
    return `<p><video controls playsinline style="max-width:100%;border-radius:12px" src="${url}"></video></p>`;
  }
  return `<p><img src="${url}" alt="" style="max-width:100%;border-radius:12px" /></p>`;
}
