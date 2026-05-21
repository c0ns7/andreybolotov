"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Eye,
  Heart,
  MessageCircle,
  PenLine,
  Plus,
  Search,
  Share2,
  Trash2,
} from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { abApiJson, abAuthHeaders } from "../../../lib/ab-api";
import type { BlogComment, BlogMediaItem, BlogPost, BlogTag } from "../../../lib/ab-blog-types";
import { BLOG_MEDIA_MAX } from "../../../lib/ab-blog-types";
import { useSiteFlags } from "../../../lib/use-site-flags";
import { useAbSession } from "../AbSessionContext";
import BlogPageHeader from "./BlogPageHeader";
import BlogMediaUploader, { type BlogUploadProgress } from "./BlogMediaUploader";
import { BlogMediaCarousel, BlogMediaLightbox } from "./BlogMediaGallery";
import BlogRichEditor from "./BlogRichEditor";

type Tab = "feed" | "manage";

function formatDate(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateShort(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function estimateReadMinutes(html: string) {
  const words = stripHtml(html).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 180));
}

function BlogDisabledStub() {
  return (
    <div className="blog-stub-page">
      <BlogPageHeader title="Блог" backHref="/home" backLabel="На главную" sticky={false} />
      <div className="blog-stub-page__card">
        <div className="blog-stub-page__icon" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </div>
        <h2 className="blog-stub-page__title">Блог временно недоступен</h2>
        <p className="blog-stub-page__text">
          Раздел отключён администратором. Загляните позже — здесь появятся истории победителей, отчёты и новости проекта.
        </p>
        <Link href="/home" className="btn btn--primary blog-stub-page__btn">
          На главную
        </Link>
      </div>
    </div>
  );
}

function newLocalId() {
  return "u-" + String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8);
}

function BlogPageClientInner() {
  const { session, authVerified, toast } = useAbSession();
  const { blog_enabled: blogEnabled, loaded: siteFlagsLoaded } = useSiteFlags();
  const searchParams = useSearchParams();
  const isAdmin = authVerified && String(session?.role || "") === "admin";
  const canUseBlog = blogEnabled || isAdmin;
  const token = session?.token || "";

  const [tab, setTab] = useState<Tab>("feed");
  const [sort, setSort] = useState<"newest" | "popular">("newest");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [tags, setTags] = useState<BlogTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [readPost, setReadPost] = useState<BlogPost | null>(null);
  const [readLoading, setReadLoading] = useState(false);
  const [comments, setComments] = useState<BlogComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSending, setCommentSending] = useState(false);
  const commentsRef = useRef<HTMLElement>(null);
  const [manageStatus, setManageStatus] = useState<"all" | "published" | "draft">("all");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formExcerpt, setFormExcerpt] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formKeywords, setFormKeywords] = useState("");
  const [formTags, setFormTags] = useState("");
  const [formMedia, setFormMedia] = useState<BlogMediaItem[]>([]);
  const [mediaUploads, setMediaUploads] = useState<BlogUploadProgress[]>([]);
  const [formStatus, setFormStatus] = useState<"draft" | "published">("draft");
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState<{ media: BlogMediaItem[]; index: number } | null>(null);
  const deepLinkHandled = useRef(false);

  const adminHeaders = useMemo(() => abAuthHeaders(), [token]);

  const mediaUploading = mediaUploads.some((u) => u.busy);

  const loadTags = useCallback(async () => {
    if (!token || !isAdmin) return;
    try {
      const data = await abApiJson<{ tags: BlogTag[] }>("/api/admin/blog/tags", { headers: adminHeaders });
      setTags(data.tags || []);
    } catch {
      /* ignore */
    }
  }, [token, isAdmin, adminHeaders]);

  const loadPosts = useCallback(async () => {
    if (!token || !canUseBlog) return;
    if (tab === "manage" && !isAdmin) return;
    setLoading(true);
    try {
      const status = tab === "manage" ? manageStatus : "published";
      const base =
        tab === "manage"
          ? `/api/admin/blog/posts?sort=${sort}&status=${status}&limit=40&q=${encodeURIComponent(search)}&tag=${encodeURIComponent(tagFilter)}`
          : `/api/blog/posts?sort=${sort}&limit=40&q=${encodeURIComponent(search)}&tag=${encodeURIComponent(tagFilter)}`;
      const data = await abApiJson<{ posts: BlogPost[] }>(base, { headers: adminHeaders });
      setPosts(data.posts || []);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка загрузки", "error");
    } finally {
      setLoading(false);
    }
  }, [token, canUseBlog, isAdmin, tab, sort, search, tagFilter, manageStatus, adminHeaders, toast]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadTags();
  }, [isAdmin, loadTags]);

  useEffect(() => {
    if (!canUseBlog) return;
    const t = window.setTimeout(() => {
      void loadPosts();
    }, 320);
    return () => window.clearTimeout(t);
  }, [canUseBlog, loadPosts]);

  useEffect(() => {
    if (!readPost) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setReadPost(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readPost]);

  const openPost = async (post: BlogPost) => {
    setReadPost(post);
    setReadLoading(true);
    setComments([]);
    setCommentDraft("");
    try {
      if (post.status === "published") {
        await abApiJson(`/api/blog/posts/${post.id}/view`, { method: "POST", headers: adminHeaders });
        const [full, commentsData] = await Promise.all([
          abApiJson<{ post: BlogPost }>(`/api/blog/posts/${encodeURIComponent(post.slug)}`, { headers: adminHeaders }),
          abApiJson<{ comments: BlogComment[] }>(`/api/blog/posts/${post.id}/comments`, { headers: adminHeaders }),
        ]);
        if (full.post) {
          setReadPost(full.post);
          setPosts((list) => list.map((p) => (p.id === post.id ? { ...p, ...full.post, view_count: full.post.view_count } : p)));
        }
        setComments(commentsData.comments || []);
      } else {
        setReadPost(post);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не удалось открыть пост", "error");
    } finally {
      setReadLoading(false);
    }
  };

  useEffect(() => {
    const slug = searchParams.get("post");
    if (!slug || deepLinkHandled.current || !canUseBlog || !token) return;
    deepLinkHandled.current = true;
    void (async () => {
      try {
        const data = await abApiJson<{ post: BlogPost }>(`/api/blog/posts/${encodeURIComponent(slug)}`, {
          headers: adminHeaders,
        });
        if (data.post) await openPost(data.post);
      } catch {
        /* ignore */
      }
    })();
  }, [searchParams, canUseBlog, token, adminHeaders]);

  const handleCardOpen = (post: BlogPost) => {
    if (tab === "manage" && post.status === "draft") {
      openEditor(post);
      return;
    }
    void openPost(post);
  };

  const scrollToComments = () => {
    commentsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const sharePost = async (post: BlogPost) => {
    const url = `${window.location.origin}/home/blog?post=${encodeURIComponent(post.slug)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: post.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast("Ссылка скопирована", "success");
    } catch {
      /* cancelled or denied */
    }
  };

  const toggleLike = async (post: BlogPost) => {
    try {
      const data = await abApiJson<{ liked: boolean; like_count: number }>(`/api/blog/posts/${post.id}/like`, {
        method: "POST",
        headers: adminHeaders,
      });
      const patch = (p: BlogPost) =>
        p.id === post.id ? { ...p, liked_by_me: data.liked, like_count: data.like_count } : p;
      setPosts((list) => list.map(patch));
      if (readPost?.id === post.id) setReadPost((p) => (p ? patch(p) : p));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "error");
    }
  };

  const sendComment = async () => {
    if (!readPost || !commentDraft.trim() || commentSending) return;
    setCommentSending(true);
    try {
      const data = await abApiJson<{ comment: BlogComment }>(`/api/blog/posts/${readPost.id}/comments`, {
        method: "POST",
        headers: { ...adminHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentDraft.trim() }),
      });
      if (data.comment) setComments((c) => [...c, data.comment!]);
      setCommentDraft("");
      const nextCount = readPost.comment_count + 1;
      setReadPost((p) => (p ? { ...p, comment_count: nextCount } : p));
      setPosts((list) => list.map((p) => (p.id === readPost.id ? { ...p, comment_count: nextCount } : p)));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "error");
    } finally {
      setCommentSending(false);
    }
  };

  const uploadOneFile = (file: File, localId: string) =>
    new Promise<{ url: string; mime: string } | null>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/admin/blog/upload");
      xhr.setRequestHeader("Authorization", "Bearer " + token);
      xhr.upload.onprogress = (ev) => {
        const p =
          ev.lengthComputable && ev.total > 0
            ? ev.loaded / ev.total
            : file.size > 0
              ? Math.min(0.95, ev.loaded / file.size)
              : 0.05;
        setMediaUploads((list) =>
          list.map((u) => (u.localId === localId ? { ...u, progress: Math.max(0.02, p), busy: true } : u)),
        );
      };
      xhr.onload = () => {
        const data = JSON.parse(xhr.responseText || "{}") as { url?: string; mime?: string; error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && data.url) {
          setMediaUploads((list) =>
            list.map((u) =>
              u.localId === localId ? { ...u, busy: false, progress: 1, done: true, error: "" } : u,
            ),
          );
          resolve({ url: data.url, mime: String(data.mime || file.type) });
          return;
        }
        const err = data.error || "Ошибка загрузки";
        setMediaUploads((list) =>
          list.map((u) => (u.localId === localId ? { ...u, busy: false, error: err, progress: 0 } : u)),
        );
        resolve(null);
      };
      xhr.onerror = () => {
        setMediaUploads((list) =>
          list.map((u) => (u.localId === localId ? { ...u, busy: false, error: "Сеть недоступна" } : u)),
        );
        resolve(null);
      };
      const fd = new FormData();
      fd.append("file", file);
      xhr.send(fd);
    });

  const queueMediaFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const room = BLOG_MEDIA_MAX - formMedia.length - mediaUploads.filter((u) => u.busy).length;
    if (room <= 0) {
      toast(`Не больше ${BLOG_MEDIA_MAX} медиа`, "warning");
      return;
    }
    for (const file of arr.slice(0, room)) {
      const localId = newLocalId();
      setMediaUploads((list) => [
        ...list,
        { localId, name: file.name, progress: 0.02, busy: true, error: "", done: false },
      ]);
      const up = await uploadOneFile(file, localId);
      if (up) {
        setFormMedia((m) => [...m, { id: 0, url: up.url, mime: up.mime }]);
      }
      setMediaUploads((list) => list.filter((u) => u.localId !== localId));
    }
  };

  const uploadMedia = async (file: File) => {
    const localId = newLocalId();
    setMediaUploads([{ localId, name: file.name, progress: 0.02, busy: true, error: "", done: false }]);
    const up = await uploadOneFile(file, localId);
    setMediaUploads([]);
    if (!up) return null;
    return up;
  };

  const openEditor = (post?: BlogPost) => {
    setMediaUploads([]);
    if (post) {
      setEditId(post.id);
      setFormTitle(post.title);
      setFormExcerpt(post.excerpt);
      setFormBody(post.body_html);
      setFormKeywords(post.keywords);
      setFormTags(post.tags.map((t) => t.label).join(", "));
      setFormMedia(post.media?.length ? post.media : post.cover_url ? [{ id: 0, url: post.cover_url, mime: post.cover_mime }] : []);
      setFormStatus(post.status === "published" ? "published" : "draft");
    } else {
      setEditId(null);
      setFormTitle("");
      setFormExcerpt("");
      setFormBody("");
      setFormKeywords("");
      setFormTags("");
      setFormMedia([]);
      setFormStatus("draft");
    }
    setEditorOpen(true);
  };

  const savePost = async (publish?: boolean) => {
    if (mediaUploading) {
      toast("Дождитесь окончания загрузки медиа", "warning");
      return;
    }
    setSaving(true);
    const status = publish ? "published" : formStatus;
    const first = formMedia[0];
    const payload = {
      title: formTitle,
      excerpt: formExcerpt,
      body_html: formBody,
      keywords: formKeywords,
      cover_url: first?.url || "",
      cover_mime: first?.mime ?? null,
      media: formMedia.map((m) => ({ url: m.url, mime: m.mime })),
      status,
      tag_labels: formTags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    try {
      if (editId) {
        await abApiJson(`/api/admin/blog/posts/${editId}`, {
          method: "PATCH",
          headers: { ...adminHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast(status === "published" ? "Пост опубликован" : "Сохранено", "success");
      } else {
        await abApiJson("/api/admin/blog/posts", {
          method: "POST",
          headers: { ...adminHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast(status === "published" ? "Пост создан и опубликован" : "Черновик сохранён", "success");
      }
      setEditorOpen(false);
      void loadPosts();
      void loadTags();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка сохранения", "error");
    } finally {
      setSaving(false);
    }
  };

  const deletePost = async (id: number) => {
    if (!window.confirm("Удалить пост безвозвратно?")) return;
    try {
      await abApiJson(`/api/admin/blog/posts/${id}`, { method: "DELETE", headers: adminHeaders });
      toast("Пост удалён", "success");
      if (readPost?.id === id) setReadPost(null);
      void loadPosts();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "error");
    }
  };

  if (!authVerified || !siteFlagsLoaded) {
    return <p className="blog-loading">Загрузка…</p>;
  }

  if (!canUseBlog) {
    return <BlogDisabledStub />;
  }

  if (readPost) {
    const articleMedia = readPost.media?.length
      ? readPost.media
      : readPost.cover_url
        ? [{ id: 0, url: readPost.cover_url, mime: readPost.cover_mime }]
        : [];
    const readMin = estimateReadMinutes(readPost.body_html);
    return (
      <article className="blog-article">
        <BlogPageHeader
          title={readPost.title}
          backOnClick={() => setReadPost(null)}
          backLabel="К ленте блога"
          actions={
            <button type="button" className="blog-page__icon-action" onClick={() => void sharePost(readPost)} aria-label="Поделиться">
              <Share2 size={20} />
            </button>
          }
        />

        <div className="blog-article__hero">
          <BlogMediaCarousel
            media={articleMedia}
            variant="hero"
            onOpen={(i) => setLightbox({ media: articleMedia, index: i })}
          />
          {readPost.status === "draft" ? <span className="blog-article__draft-badge">Черновик</span> : null}
        </div>
        {lightbox ? (
          <BlogMediaLightbox media={lightbox.media} startIndex={lightbox.index} onClose={() => setLightbox(null)} />
        ) : null}

        <div className="blog-article__content">
          {readLoading ? <p className="blog-article__loading">Загрузка…</p> : null}

          <div className="blog-article__tags">
            {readPost.tags.map((t) => (
              <span key={t.id} className="blog-tag">
                {t.label}
              </span>
            ))}
          </div>

          <h1 className="blog-article__title">{readPost.title}</h1>

          <p className="blog-article__meta">
            <time dateTime={new Date(readPost.published_at || readPost.created_at).toISOString()}>
              {formatDateShort(readPost.published_at || readPost.created_at)}
            </time>
            <span className="blog-article__meta-sep">·</span>
            <span>{readMin} мин чтения</span>
            {readPost.status === "published" ? (
              <>
                <span className="blog-article__meta-sep">·</span>
                <span className="blog-article__meta-views">
                  <Eye size={14} aria-hidden="true" />
                  {readPost.view_count}
                </span>
              </>
            ) : null}
          </p>

          {readPost.excerpt ? <p className="blog-article__lead">{readPost.excerpt}</p> : null}

          <div className="blog-article__engage">
            <button
              type="button"
              className={"blog-engage-btn blog-engage-btn--like" + (readPost.liked_by_me ? " is-liked" : "")}
              onClick={() => void toggleLike(readPost)}
              aria-pressed={readPost.liked_by_me}
            >
              <Heart size={18} fill={readPost.liked_by_me ? "currentColor" : "none"} />
              <span>{readPost.like_count}</span>
            </button>
            <button type="button" className="blog-engage-btn" onClick={scrollToComments}>
              <MessageCircle size={18} />
              <span>{readPost.comment_count}</span>
            </button>
            <button type="button" className="blog-engage-btn blog-engage-btn--ghost" onClick={() => void sharePost(readPost)}>
              <Share2 size={18} />
              <span>Поделиться</span>
            </button>
          </div>

          <div className="blog-article__body" dangerouslySetInnerHTML={{ __html: readPost.body_html }} />

          {isAdmin ? (
          <div className="blog-article__admin">
            <button type="button" className="blog-article__admin-btn" onClick={() => openEditor(readPost)}>
              <PenLine size={16} />
              Редактировать
            </button>
            <button type="button" className="blog-article__admin-btn blog-article__admin-btn--danger" onClick={() => void deletePost(readPost.id)}>
              <Trash2 size={16} />
              Удалить
            </button>
          </div>
          ) : null}

          <section ref={commentsRef} className="blog-article__comments" id="comments">
            <header className="blog-article__comments-head">
              <h2>Комментарии</h2>
              <span className="blog-article__comments-count">{readPost.comment_count}</span>
            </header>

            {comments.length ? (
              <ul className="blog-comments__list">
                {comments.map((c) => (
                  <li key={c.id} className="blog-comment">
                    <div className="blog-comment__avatar" aria-hidden="true">
                      {(c.user_name || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="blog-comment__body">
                      <div className="blog-comment__head">
                        <strong>{c.user_name}</strong>
                        <time className="blog-comment__time">{formatDate(c.created_at)}</time>
                      </div>
                      <p className="blog-comment__text">{c.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="blog-article__comments-empty">Пока нет комментариев — будьте первым.</p>
            )}

            <div className="blog-comments__composer">
              <textarea
                className="input blog-comments__input"
                rows={3}
                placeholder="Написать комментарий…"
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void sendComment();
                }}
              />
              <button
                type="button"
                className="btn btn--primary"
                disabled={commentSending || !commentDraft.trim()}
                onClick={() => void sendComment()}
              >
                {commentSending ? "Отправка…" : "Отправить"}
              </button>
            </div>
          </section>
        </div>

        <footer className="blog-article__bar">
          <button
            type="button"
            className={"blog-article__bar-btn" + (readPost.liked_by_me ? " is-liked" : "")}
            onClick={() => void toggleLike(readPost)}
            aria-label="Нравится"
          >
            <Heart size={22} fill={readPost.liked_by_me ? "currentColor" : "none"} />
          </button>
          <button type="button" className="blog-article__bar-btn" onClick={scrollToComments} aria-label="Комментарии">
            <MessageCircle size={22} />
          </button>
          <button type="button" className="blog-article__bar-btn" onClick={() => void sharePost(readPost)} aria-label="Поделиться">
            <Share2 size={22} />
          </button>
        </footer>
      </article>

    );
  }

  return (
    <div className="blog-page blog-page--feed">
      <BlogPageHeader
        title="Блог"
        subtitle="Победители акций, благотворительность, новости"
        backHref="/home"
        backLabel="На главную"
        actions={
          isAdmin ? (
            <button type="button" className="blog-page__icon-action blog-page__icon-action--primary" onClick={() => openEditor()} aria-label="Новый пост">
              <Plus size={22} />
            </button>
          ) : undefined
        }
      />

      {isAdmin && !blogEnabled ? (
        <p className="blog-admin-banner" role="status">
          Блог скрыт для пользователей. Включите в админке → Настройки.
        </p>
      ) : null}

      {isAdmin ? (
      <div className="blog-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={"blog-tabs__btn" + (tab === "feed" ? " is-active" : "")}
          onClick={() => setTab("feed")}
        >
          Лента
        </button>
        <button
          type="button"
          role="tab"
          className={"blog-tabs__btn" + (tab === "manage" ? " is-active" : "")}
          onClick={() => setTab("manage")}
        >
          Управление
        </button>
      </div>
      ) : null}

      <div className="blog-toolbar">
        <label className="blog-toolbar__search">
          <Search size={18} className="blog-toolbar__search-icon" aria-hidden="true" />
          <input
            type="search"
            className="input blog-toolbar__search-input"
            placeholder="Поиск по заголовку и тексту…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="blog-toolbar__row">
          <select className="input blog-toolbar__select" value={sort} onChange={(e) => setSort(e.target.value as "newest" | "popular")}>
            <option value="newest">Сначала новые</option>
            <option value="popular">Популярные</option>
          </select>
          <select className="input blog-toolbar__select" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">Все теги</option>
            {tags.map((t) => (
              <option key={t.id} value={t.slug}>
                {t.label}
              </option>
            ))}
          </select>
          {tab === "manage" ? (
            <select
              className="input blog-toolbar__select"
              value={manageStatus}
              onChange={(e) => setManageStatus(e.target.value as "all" | "published" | "draft")}
            >
              <option value="all">Все статусы</option>
              <option value="published">Опубликованные</option>
              <option value="draft">Черновики</option>
            </select>
          ) : null}
        </div>
        {isAdmin ? (
          <button type="button" className="btn btn--primary blog-toolbar__create" onClick={() => openEditor()}>
            <Plus size={18} aria-hidden="true" />
            Новый пост
          </button>
        ) : null}
      </div>

      {loading ? (
        <ul className="blog-list blog-list--skeleton" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <li key={n} className="blog-skeleton-card">
              <div className="blog-skeleton-card__media" />
              <div className="blog-skeleton-card__line blog-skeleton-card__line--title" />
              <div className="blog-skeleton-card__line" />
              <div className="blog-skeleton-card__line blog-skeleton-card__line--short" />
            </li>
          ))}
        </ul>
      ) : null}
      {!loading ? (
      <ul className="blog-list">
        {posts.map((p) => (
          <li key={p.id}>
            <article
              className="blog-card blog-card--clickable"
              role="button"
              tabIndex={0}
              onClick={() => handleCardOpen(p)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCardOpen(p);
                }
              }}
            >
              <div className="blog-card__media">
                <BlogMediaCarousel
                  media={
                    p.media?.length ? p.media : p.cover_url ? [{ id: 0, url: p.cover_url, mime: p.cover_mime }] : []
                  }
                  variant="card"
                  onOpen={(i) => {
                    const m = p.media?.length ? p.media : p.cover_url ? [{ id: 0, url: p.cover_url, mime: p.cover_mime }] : [];
                    setLightbox({ media: m, index: i });
                  }}
                />
                {tab === "manage" ? (
                <span className={"blog-card__status blog-card__status--" + p.status}>
                  {p.status === "published" ? "Опубликован" : "Черновик"}
                </span>
                ) : null}
              </div>
              <div className="blog-card__body">
                <h2 className="blog-card__title">{p.title}</h2>
                {p.excerpt ? <p className="blog-card__excerpt">{p.excerpt}</p> : null}
                <div className="blog-card__meta">
                  <span>{formatDateShort(p.published_at || p.created_at)}</span>
                  <span className="blog-card__stat">
                    <Eye size={14} aria-hidden="true" />
                    {p.view_count}
                  </span>
                  <span className="blog-card__stat">
                    <Heart size={14} aria-hidden="true" />
                    {p.like_count}
                  </span>
                  <span className="blog-card__stat">
                    <MessageCircle size={14} aria-hidden="true" />
                    {p.comment_count}
                  </span>
                </div>
                {p.tags.length ? (
                  <div className="blog-card__tags">
                    {p.tags.map((t) => (
                      <span key={t.id} className="blog-tag">
                        {t.label}
                      </span>
                    ))}
                  </div>
                ) : null}
                <span className="blog-card__cta">Читать подробнее</span>
              </div>
              {tab === "manage" ? (
                <div className="blog-card__actions" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEditor(p)}>
                    Изменить
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm blog-danger" onClick={() => void deletePost(p.id)}>
                    Удалить
                  </button>
                </div>
              ) : null}
            </article>
          </li>
        ))}

      </ul>
      ) : null}
      {!loading && !posts.length ? <p className="blog-empty">Пока нет постов</p> : null}

      {editorOpen ? (
        <div className="blog-editor-modal" role="dialog" aria-modal="true">
          <div className="blog-editor-modal__backdrop" onClick={() => setEditorOpen(false)} />
          <div className="blog-editor-modal__panel">
            <header className="blog-editor-modal__head">
              <h2>{editId ? "Редактировать пост" : "Новый пост"}</h2>
              <button type="button" className="blog-editor-modal__close" onClick={() => setEditorOpen(false)} aria-label="Закрыть">
                ×
              </button>
            </header>
            <div className="blog-editor-modal__form">
              <label className="blog-field">
                <span>Заголовок</span>
                <input className="input" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
              </label>
              <label className="blog-field">
                <span>Краткое описание</span>
                <textarea className="input" rows={2} value={formExcerpt} onChange={(e) => setFormExcerpt(e.target.value)} />
              </label>
              <label className="blog-field">
                <span>Ключевые слова (через запятую)</span>
                <input className="input" value={formKeywords} onChange={(e) => setFormKeywords(e.target.value)} />
              </label>
              <label className="blog-field">
                <span>Теги (через запятую)</span>
                <input
                  className="input"
                  placeholder="победители, благотворительность"
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                />
              </label>
              <BlogMediaUploader
                items={formMedia}
                uploads={mediaUploads}
                onPickFiles={(files) => void queueMediaFiles(files)}
                onRemove={(i) => setFormMedia((m) => m.filter((_, j) => j !== i))}
                onMove={(from, to) =>
                  setFormMedia((m) => {
                    if (to < 0 || to >= m.length) return m;
                    const next = m.slice();
                    const [item] = next.splice(from, 1);
                    next.splice(to, 0, item!);
                    return next;
                  })
                }
                disabled={saving}
              />
              <BlogRichEditor value={formBody} onChange={setFormBody} onUploadMedia={uploadMedia} />
            </div>
            <footer className="blog-editor-modal__foot">
              <button type="button" className="btn btn--ghost" disabled={saving || mediaUploading} onClick={() => setEditorOpen(false)}>
                Отмена
              </button>
              <button type="button" className="btn btn--secondary" disabled={saving || mediaUploading} onClick={() => void savePost(false)}>
                {formStatus === "published" ? "Сохранить" : "Черновик"}
              </button>
              <button type="button" className="btn btn--primary" disabled={saving || mediaUploading} onClick={() => void savePost(true)}>
                Опубликовать
              </button>
            </footer>
          </div>
        </div>
      ) : null}
      {lightbox && !readPost ? (
        <BlogMediaLightbox media={lightbox.media} startIndex={lightbox.index} onClose={() => setLightbox(null)} />
      ) : null}
    </div>
  );
}

export default function BlogPageClient() {
  return (
    <Suspense fallback={<p className="blog-loading">Загрузка…</p>}>
      <BlogPageClientInner />
    </Suspense>
  );
}
