import { pgAll, pgExec, pgGet } from "./pg-sql.js";

export type BlogPostRow = {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  body_html: string;
  cover_url: string;
  cover_mime: string | null;
  keywords: string;
  author_user_id: number | null;
  status: string;
  published_at: number | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  created_at: number;
  updated_at: number;
};

export type BlogTagRow = {
  id: number;
  slug: string;
  label: string;
};

export type BlogCommentRow = {
  id: number;
  post_id: number;
  user_id: number;
  body: string;
  parent_id: number | null;
  hidden: number;
  created_at: number;
  user_name: string;
  user_phone: string;
};

function slugifyTitle(title: string): string {
  const base = String(title || "")
    .trim()
    .toLowerCase()
    .replace(/[ё]/g, "e")
    .replace(/[а-я]/g, (ch) => {
      const map: Record<string, string> = {
        а: "a",
        б: "b",
        в: "v",
        г: "g",
        д: "d",
        е: "e",
        ж: "zh",
        з: "z",
        и: "i",
        й: "y",
        к: "k",
        л: "l",
        м: "m",
        н: "n",
        о: "o",
        п: "p",
        р: "r",
        с: "s",
        т: "t",
        у: "u",
        ф: "f",
        х: "h",
        ц: "ts",
        ч: "ch",
        ш: "sh",
        щ: "sch",
        ъ: "",
        ы: "y",
        ь: "",
        э: "e",
        ю: "yu",
        я: "ya",
      };
      return map[ch] ?? ch;
    })
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "post";
}

export async function ensureUniqueBlogSlug(base: string, excludeId?: number): Promise<string> {
  let slug = slugifyTitle(base);
  let n = 0;
  for (;;) {
    const candidate = n ? `${slug}-${n}` : slug;
    const row = await pgGet<{ id: number }>(`SELECT id FROM blog_posts WHERE slug = ? LIMIT 1`, [candidate]);
    if (!row || (excludeId != null && Number(row.id) === excludeId)) return candidate;
    n += 1;
  }
}

export function postToDto(row: BlogPostRow, tags: BlogTagRow[] = [], likedByMe = false) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    body_html: row.body_html,
    cover_url: row.cover_url,
    cover_mime: row.cover_mime,
    keywords: row.keywords,
    author_user_id: row.author_user_id,
    status: row.status,
    published_at: row.published_at,
    view_count: Number(row.view_count ?? 0),
    like_count: Number(row.like_count ?? 0),
    comment_count: Number(row.comment_count ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
    tags: tags.map((t) => ({ id: t.id, slug: t.slug, label: t.label })),
    liked_by_me: likedByMe,
  };
}

async function loadTagsForPosts(postIds: number[]): Promise<Map<number, BlogTagRow[]>> {
  const map = new Map<number, BlogTagRow[]>();
  if (!postIds.length) return map;
  const placeholders = postIds.map(() => "?").join(",");
  const rows = await pgAll<BlogTagRow & { post_id: number }>(
    `SELECT pt.post_id AS post_id, t.id, t.slug, t.label
       FROM blog_post_tags pt
       INNER JOIN blog_tags t ON t.id = pt.tag_id
       WHERE pt.post_id IN (${placeholders})`,
    postIds,
  );
  for (const r of rows) {
    const pid = Number(r.post_id);
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid)!.push({ id: r.id, slug: r.slug, label: r.label });
  }
  return map;
}

async function loadLikedSet(userId: number, postIds: number[]): Promise<Set<number>> {
  const set = new Set<number>();
  if (!postIds.length || !userId) return set;
  const placeholders = postIds.map(() => "?").join(",");
  const rows = await pgAll<{ post_id: number }>(
    `SELECT post_id FROM blog_post_likes WHERE user_id = ? AND post_id IN (${placeholders})`,
    [userId, ...postIds],
  );
  for (const r of rows) set.add(Number(r.post_id));
  return set;
}

export type ListBlogPostsOpts = {
  sort?: "newest" | "popular";
  search?: string;
  tagSlug?: string;
  status?: "published" | "draft" | "all";
  limit?: number;
  offset?: number;
  viewerUserId?: number;
};

export async function listBlogPosts(opts: ListBlogPostsOpts = {}) {
  const sort = opts.sort === "popular" ? "popular" : "newest";
  const limit = Math.max(1, Math.min(50, Math.floor(Number(opts.limit) || 20)));
  const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));
  const search = String(opts.search || "").trim().toLowerCase();
  const tagSlug = String(opts.tagSlug || "").trim();
  const status = opts.status || "published";

  const where: string[] = [];
  const params: unknown[] = [];

  if (status === "published") {
    where.push(`p.status = 'published'`);
  } else if (status === "draft") {
    where.push(`p.status = 'draft'`);
  }

  if (search) {
    where.push(
      `(LOWER(p.title) LIKE ? OR LOWER(p.excerpt) LIKE ? OR LOWER(p.keywords) LIKE ? OR LOWER(p.body_html) LIKE ?)`,
    );
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }

  if (tagSlug) {
    where.push(`EXISTS (
      SELECT 1 FROM blog_post_tags pt
      INNER JOIN blog_tags t ON t.id = pt.tag_id
      WHERE pt.post_id = p.id AND t.slug = ?
    )`);
    params.push(tagSlug);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql =
    sort === "popular"
      ? `ORDER BY p.like_count DESC, p.view_count DESC, COALESCE(p.published_at, p.created_at) DESC`
      : `ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id DESC`;

  const rows = await pgAll<BlogPostRow>(
    `SELECT p.* FROM blog_posts p ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
    [...params, limit + 1, offset],
  );
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const ids = slice.map((r) => r.id);
  const tagsMap = await loadTagsForPosts(ids);
  const liked = await loadLikedSet(Number(opts.viewerUserId) || 0, ids);
  return {
    posts: slice.map((r) => postToDto(r, tagsMap.get(r.id) || [], liked.has(r.id))),
    has_more: hasMore,
    next_offset: offset + slice.length,
  };
}

export async function getBlogPostBySlug(slug: string, viewerUserId?: number) {
  const row = await pgGet<BlogPostRow>(`SELECT * FROM blog_posts WHERE slug = ? LIMIT 1`, [slug]);
  if (!row) return null;
  const tags = await pgAll<BlogTagRow>(
    `SELECT t.id, t.slug, t.label FROM blog_tags t
     INNER JOIN blog_post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ?`,
    [row.id],
  );
  const liked = await loadLikedSet(Number(viewerUserId) || 0, [row.id]);
  return postToDto(row, tags, liked.has(row.id));
}

export async function getBlogPostById(id: number, viewerUserId?: number) {
  const row = await pgGet<BlogPostRow>(`SELECT * FROM blog_posts WHERE id = ? LIMIT 1`, [id]);
  if (!row) return null;
  const tags = await pgAll<BlogTagRow>(
    `SELECT t.id, t.slug, t.label FROM blog_tags t
     INNER JOIN blog_post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ?`,
    [row.id],
  );
  const liked = await loadLikedSet(Number(viewerUserId) || 0, [row.id]);
  return postToDto(row, tags, liked.has(row.id));
}

export async function listAllBlogTags(): Promise<BlogTagRow[]> {
  return await pgAll<BlogTagRow>(`SELECT id, slug, label FROM blog_tags ORDER BY label ASC`);
}

async function upsertTagByLabel(label: string): Promise<number> {
  const clean = String(label || "").trim().slice(0, 64);
  if (!clean) return 0;
  const slug = slugifyTitle(clean);
  const existing = await pgGet<{ id: number }>(`SELECT id FROM blog_tags WHERE slug = ? LIMIT 1`, [slug]);
  if (existing) return Number(existing.id);
  const now = Date.now();
  const inserted = await pgGet<{ id: number }>(
    `INSERT INTO blog_tags (slug, label, created_at) VALUES (?, ?, ?) RETURNING id`,
    [slug, clean, now],
  );
  return Number(inserted?.id || 0);
}

async function setPostTags(postId: number, tagLabels: string[]) {
  await pgExec(`DELETE FROM blog_post_tags WHERE post_id = ?`, [postId]);
  const seen = new Set<string>();
  for (const raw of tagLabels) {
    const label = String(raw || "").trim();
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const tagId = await upsertTagByLabel(label);
    if (tagId) {
      await pgExec(`INSERT INTO blog_post_tags (post_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [
        postId,
        tagId,
      ]);
    }
  }
}

export type SaveBlogPostInput = {
  title: string;
  excerpt?: string;
  body_html: string;
  cover_url?: string;
  cover_mime?: string | null;
  keywords?: string;
  status?: "draft" | "published";
  tag_labels?: string[];
  slug?: string;
};

export async function createBlogPost(authorUserId: number, input: SaveBlogPostInput) {
  const now = Date.now();
  const title = String(input.title || "").trim().slice(0, 300);
  if (!title) return { ok: false as const, error: "Укажите заголовок" };
  const body = String(input.body_html || "").trim();
  if (!body) return { ok: false as const, error: "Добавьте текст поста" };
  const status = input.status === "published" ? "published" : "draft";
  const slug = input.slug ? slugifyTitle(input.slug) : await ensureUniqueBlogSlug(title);
  const publishedAt = status === "published" ? now : null;
  const row = await pgGet<BlogPostRow>(
    `INSERT INTO blog_posts (
      slug, title, excerpt, body_html, cover_url, cover_mime, keywords,
      author_user_id, status, published_at, view_count, like_count, comment_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?) RETURNING *`,
    [
      slug,
      title,
      String(input.excerpt || "").trim().slice(0, 500),
      body.slice(0, 500_000),
      String(input.cover_url || "").trim().slice(0, 500),
      input.cover_mime ? String(input.cover_mime).slice(0, 120) : null,
      String(input.keywords || "").trim().slice(0, 500),
      authorUserId,
      status,
      publishedAt,
      now,
      now,
    ],
  );
  if (!row) return { ok: false as const, error: "Не удалось создать пост" };
  await setPostTags(row.id, Array.isArray(input.tag_labels) ? input.tag_labels : []);
  return { ok: true as const, post: await getBlogPostById(row.id, authorUserId) };
}

export async function updateBlogPost(postId: number, input: SaveBlogPostInput) {
  const existing = await pgGet<BlogPostRow>(`SELECT * FROM blog_posts WHERE id = ?`, [postId]);
  if (!existing) return { ok: false as const, error: "Пост не найден" };
  const now = Date.now();
  const title = String(input.title || "").trim().slice(0, 300);
  if (!title) return { ok: false as const, error: "Укажите заголовок" };
  const body = String(input.body_html || "").trim();
  if (!body) return { ok: false as const, error: "Добавьте текст поста" };
  const status = input.status === "published" ? "published" : input.status === "draft" ? "draft" : existing.status;
  let publishedAt = existing.published_at;
  if (status === "published" && !publishedAt) publishedAt = now;
  if (status === "draft") publishedAt = null;
  const slug = input.slug
    ? await ensureUniqueBlogSlug(input.slug, postId)
    : existing.slug;
  await pgExec(
    `UPDATE blog_posts SET slug = ?, title = ?, excerpt = ?, body_html = ?, cover_url = ?, cover_mime = ?,
     keywords = ?, status = ?, published_at = ?, updated_at = ? WHERE id = ?`,
    [
      slug,
      title,
      String(input.excerpt || "").trim().slice(0, 500),
      body.slice(0, 500_000),
      String(input.cover_url ?? existing.cover_url).trim().slice(0, 500),
      input.cover_mime != null ? String(input.cover_mime).slice(0, 120) : existing.cover_mime,
      String(input.keywords ?? existing.keywords).trim().slice(0, 500),
      status,
      publishedAt,
      now,
      postId,
    ],
  );
  await setPostTags(postId, Array.isArray(input.tag_labels) ? input.tag_labels : []);
  return { ok: true as const, post: await getBlogPostById(postId) };
}

export async function deleteBlogPost(postId: number) {
  await pgExec(`DELETE FROM blog_posts WHERE id = ?`, [postId]);
  return { ok: true as const };
}

export async function recordBlogPostView(postId: number, viewerUserId?: number) {
  const post = await pgGet<{ id: number; status: string }>(`SELECT id, status FROM blog_posts WHERE id = ?`, [
    postId,
  ]);
  if (!post || post.status !== "published") return { ok: false as const };
  const now = Date.now();
  await pgExec(`UPDATE blog_posts SET view_count = view_count + 1 WHERE id = ?`, [postId]);
  await pgExec(
    `INSERT INTO blog_post_views (post_id, viewer_user_id, viewed_at) VALUES (?, ?, ?)`,
    [postId, viewerUserId ?? null, now],
  );
  return { ok: true as const };
}

export async function toggleBlogPostLike(postId: number, userId: number) {
  const post = await pgGet<{ id: number; status: string; like_count: number }>(
    `SELECT id, status, like_count FROM blog_posts WHERE id = ?`,
    [postId],
  );
  if (!post || post.status !== "published") return { ok: false as const, error: "Пост недоступен" };
  const existing = await pgGet<{ post_id: number }>(
    `SELECT post_id FROM blog_post_likes WHERE post_id = ? AND user_id = ?`,
    [postId, userId],
  );
  const now = Date.now();
  if (existing) {
    await pgExec(`DELETE FROM blog_post_likes WHERE post_id = ? AND user_id = ?`, [postId, userId]);
    await pgExec(`UPDATE blog_posts SET like_count = GREATEST(0, like_count - 1) WHERE id = ?`, [postId]);
    const row = await pgGet<{ like_count: number }>(`SELECT like_count FROM blog_posts WHERE id = ?`, [postId]);
    return { ok: true as const, liked: false, like_count: Number(row?.like_count ?? 0) };
  }
  await pgExec(`INSERT INTO blog_post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)`, [
    postId,
    userId,
    now,
  ]);
  await pgExec(`UPDATE blog_posts SET like_count = like_count + 1 WHERE id = ?`, [postId]);
  const row = await pgGet<{ like_count: number }>(`SELECT like_count FROM blog_posts WHERE id = ?`, [postId]);
  return { ok: true as const, liked: true, like_count: Number(row?.like_count ?? 0) };
}

export async function listBlogComments(postId: number) {
  return await pgAll<BlogCommentRow>(
    `SELECT c.id, c.post_id, c.user_id, c.body, c.parent_id, c.hidden, c.created_at,
            u.name AS user_name, u.phone AS user_phone
       FROM blog_comments c
       INNER JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? AND c.hidden = 0
       ORDER BY c.created_at ASC`,
    [postId],
  );
}

export async function addBlogComment(postId: number, userId: number, body: string, parentId?: number) {
  const text = String(body || "").trim().slice(0, 2000);
  if (!text) return { ok: false as const, error: "Пустой комментарий" };
  const post = await pgGet<{ id: number; status: string }>(`SELECT id, status FROM blog_posts WHERE id = ?`, [
    postId,
  ]);
  if (!post || post.status !== "published") return { ok: false as const, error: "Пост недоступен" };
  const now = Date.now();
  const row = await pgGet<{ id: number }>(
    `INSERT INTO blog_comments (post_id, user_id, body, parent_id, hidden, created_at)
     VALUES (?, ?, ?, ?, 0, ?) RETURNING id`,
    [postId, userId, text, parentId ?? null, now],
  );
  await pgExec(`UPDATE blog_posts SET comment_count = comment_count + 1 WHERE id = ?`, [postId]);
  const comments = await listBlogComments(postId);
  const created = comments.find((c) => c.id === Number(row?.id));
  return { ok: true as const, comment: created || null };
}

export async function hideBlogComment(commentId: number) {
  const row = await pgGet<{ post_id: number; hidden: number }>(
    `SELECT post_id, hidden FROM blog_comments WHERE id = ?`,
    [commentId],
  );
  if (!row || row.hidden) return { ok: false as const };
  await pgExec(`UPDATE blog_comments SET hidden = 1 WHERE id = ?`, [commentId]);
  await pgExec(`UPDATE blog_posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = ?`, [
    row.post_id,
  ]);
  return { ok: true as const };
}
