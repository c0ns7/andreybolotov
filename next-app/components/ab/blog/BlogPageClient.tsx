"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { abApiJson, abAuthHeaders } from "../../../lib/ab-api";
import type { BlogComment, BlogPost, BlogTag } from "../../../lib/ab-blog-types";
import { useAbSession } from "../AbSessionContext";
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

function BlogStub() {
  return (
    <div className="blog-stub-page">
      <div className="blog-stub-page__icon" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </div>
      <h1 className="blog-stub-page__title">Блог скоро откроется</h1>
      <p className="blog-stub-page__text">
        Здесь будут истории победителей акций, благотворительные отчёты и новости проекта. Пока раздел доступен только
        администраторам.
      </p>
      <Link href="/home" className="btn btn--primary">
        На главную
      </Link>
    </div>
  );
}

export default function BlogPageClient() {
  const { session, authVerified, toast } = useAbSession();
  const isAdmin = authVerified && String(session?.role || "") === "admin";
  const token = session?.token || "";

  const [tab, setTab] = useState<Tab>("feed");
  const [sort, setSort] = useState<"newest" | "popular">("newest");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [tags, setTags] = useState<BlogTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [readPost, setReadPost] = useState<BlogPost | null>(null);
  const [comments, setComments] = useState<BlogComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [manageStatus, setManageStatus] = useState<"all" | "published" | "draft">("all");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formExcerpt, setFormExcerpt] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formKeywords, setFormKeywords] = useState("");
  const [formTags, setFormTags] = useState("");
  const [formCover, setFormCover] = useState("");
  const [formCoverMime, setFormCoverMime] = useState<string | null>(null);
  const [formStatus, setFormStatus] = useState<"draft" | "published">("draft");
  const [saving, setSaving] = useState(false);

  const adminHeaders = useMemo(() => abAuthHeaders(token), [token]);

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
    if (!token || !isAdmin) return;
    setLoading(true);
    try {
      const status = tab === "manage" ? manageStatus : "published";
      const base =
        tab === "manage"
          ? `/api/admin/blog/posts?sort=${sort}&status=${status}&limit=40&q=${encodeURIComponent(search)}&tag=${encodeURIComponent(tagFilter)}`
          : `/api/blog/posts?sort=${sort}&limit=40&q=${encodeURIComponent(search)}&tag=${encodeURIComponent(tagFilter)}`;
      const data = await abApiJson<{ posts: BlogPost[] }>(base, {
        headers: tab === "manage" ? adminHeaders : adminHeaders,
      });
      setPosts(data.posts || []);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка загрузки", "error");
    } finally {
      setLoading(false);
    }
  }, [token, isAdmin, tab, sort, search, tagFilter, manageStatus, adminHeaders, toast]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadTags();
  }, [isAdmin, loadTags]);

  useEffect(() => {
    if (!isAdmin) return;
    const t = window.setTimeout(() => {
      void loadPosts();
    }, 320);
    return () => window.clearTimeout(t);
  }, [isAdmin, loadPosts]);

  const openPost = async (post: BlogPost) => {
    setReadPost(post);
    setComments([]);
    try {
      await abApiJson(`/api/blog/posts/${post.id}/view`, { method: "POST", headers: adminHeaders });
      const data = await abApiJson<{ comments: BlogComment[] }>(`/api/blog/posts/${post.id}/comments`, {
        headers: adminHeaders,
      });
      setComments(data.comments || []);
    } catch {
      /* ignore */
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
    if (!readPost || !commentDraft.trim()) return;
    try {
      const data = await abApiJson<{ comment: BlogComment }>(`/api/blog/posts/${readPost.id}/comments`, {
        method: "POST",
        headers: { ...adminHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentDraft.trim() }),
      });
      if (data.comment) setComments((c) => [...c, data.comment!]);
      setCommentDraft("");
      setReadPost((p) => (p ? { ...p, comment_count: p.comment_count + 1 } : p));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "error");
    }
  };

  const uploadMedia = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/blog/upload", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(String(data.error || "Ошибка загрузки"), "error");
      return null;
    }
    return { url: String(data.url || ""), mime: String(data.mime || file.type) };
  };

  const openEditor = (post?: BlogPost) => {
    if (post) {
      setEditId(post.id);
      setFormTitle(post.title);
      setFormExcerpt(post.excerpt);
      setFormBody(post.body_html);
      setFormKeywords(post.keywords);
      setFormTags(post.tags.map((t) => t.label).join(", "));
      setFormCover(post.cover_url);
      setFormCoverMime(post.cover_mime);
      setFormStatus(post.status === "published" ? "published" : "draft");
    } else {
      setEditId(null);
      setFormTitle("");
      setFormExcerpt("");
      setFormBody("");
      setFormKeywords("");
      setFormTags("");
      setFormCover("");
      setFormCoverMime(null);
      setFormStatus("draft");
    }
    setEditorOpen(true);
  };

  const savePost = async (publish?: boolean) => {
    setSaving(true);
    const status = publish ? "published" : formStatus;
    const payload = {
      title: formTitle,
      excerpt: formExcerpt,
      body_html: formBody,
      keywords: formKeywords,
      cover_url: formCover,
      cover_mime: formCoverMime,
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

  if (!authVerified) {
    return <p className="blog-loading">Загрузка…</p>;
  }

  if (!isAdmin) {
    return <BlogStub />;
  }

  if (readPost) {
    return (
      <article className="blog-page blog-page--read">
        <header className="blog-page__top">
          <button type="button" className="btn btn--ghost blog-back" onClick={() => setReadPost(null)}>
            ← Назад
          </button>
        </header>
        {readPost.cover_url ? (
          readPost.cover_mime?.startsWith("video/") ? (
            <video className="blog-post-cover" src={readPost.cover_url} controls playsInline />
          ) : (
            <img className="blog-post-cover" src={readPost.cover_url} alt="" />
          )
        ) : null}
        <h1 className="blog-post-title">{readPost.title}</h1>
        <p className="blog-post-meta">
          {formatDate(readPost.published_at || readPost.created_at)} · {readPost.view_count} просмотров
        </p>
        <div className="blog-post-tags">
          {readPost.tags.map((t) => (
            <span key={t.id} className="blog-tag">
              {t.label}
            </span>
          ))}
        </div>
        <div className="blog-post-body" dangerouslySetInnerHTML={{ __html: readPost.body_html }} />
        <div className="blog-post-actions">
          <button
            type="button"
            className={"blog-like-btn" + (readPost.liked_by_me ? " is-liked" : "")}
            onClick={() => void toggleLike(readPost)}
          >
            ♥ {readPost.like_count}
          </button>
          <span className="blog-post-actions__comments">💬 {readPost.comment_count}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEditor(readPost)}>
            Редактировать
          </button>
          <button type="button" className="btn btn--ghost btn--sm blog-danger" onClick={() => void deletePost(readPost.id)}>
            Удалить
          </button>
        </div>
        <section className="blog-comments">
          <h2 className="blog-comments__title">Комментарии</h2>
          <ul className="blog-comments__list">
            {comments.map((c) => (
              <li key={c.id} className="blog-comment">
                <strong>{c.user_name}</strong>
                <span className="blog-comment__time">{formatDate(c.created_at)}</span>
                <p>{c.body}</p>
              </li>
            ))}
          </ul>
          <div className="blog-comments__form">
            <textarea
              className="input blog-comments__input"
              rows={3}
              placeholder="Написать комментарий…"
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
            />
            <button type="button" className="btn btn--primary" onClick={() => void sendComment()}>
              Отправить
            </button>
          </div>
        </section>
      </article>
    );
  }

  return (
    <div className="blog-page">
      <header className="blog-page__head">
        <h1 className="blog-page__title">Блог</h1>
        <p className="blog-page__sub">Победители акций, благотворительность, новости</p>
      </header>

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

      <div className="blog-filters">
        <input
          type="search"
          className="input blog-filters__search"
          placeholder="Поиск по заголовку, тексту, ключевым словам…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input blog-filters__select" value={sort} onChange={(e) => setSort(e.target.value as "newest" | "popular")}>
          <option value="newest">Сначала новые</option>
          <option value="popular">Популярные</option>
        </select>
        <select className="input blog-filters__select" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">Все теги</option>
          {tags.map((t) => (
            <option key={t.id} value={t.slug}>
              {t.label}
            </option>
          ))}
        </select>
        {tab === "manage" ? (
          <select
            className="input blog-filters__select"
            value={manageStatus}
            onChange={(e) => setManageStatus(e.target.value as "all" | "published" | "draft")}
          >
            <option value="all">Все статусы</option>
            <option value="published">Опубликованные</option>
            <option value="draft">Черновики</option>
          </select>
        ) : null}
        <button type="button" className="btn btn--primary" onClick={() => openEditor()}>
          + Новый пост
        </button>
      </div>

      {loading ? <p className="blog-loading">Загрузка…</p> : null}
      <ul className="blog-list">
        {posts.map((p) => (
          <li key={p.id} className="blog-card">
            {p.cover_url ? (
              p.cover_mime?.startsWith("video/") ? (
                <video className="blog-card__cover" src={p.cover_url} muted playsInline />
              ) : (
                <img className="blog-card__cover" src={p.cover_url} alt="" />
              )
            ) : (
              <div className="blog-card__cover blog-card__cover--empty" />
            )}
            <div className="blog-card__body">
              <span className={"blog-card__status blog-card__status--" + p.status}>{p.status === "published" ? "Опубликован" : "Черновик"}</span>
              <h2 className="blog-card__title">
                <button type="button" className="blog-card__link" onClick={() => void openPost(p)}>
                  {p.title}
                </button>
              </h2>
              {p.excerpt ? <p className="blog-card__excerpt">{p.excerpt}</p> : null}
              <div className="blog-card__meta">
                <span>{formatDate(p.published_at || p.created_at)}</span>
                <span>👁 {p.view_count}</span>
                <span>♥ {p.like_count}</span>
                <span>💬 {p.comment_count}</span>
              </div>
              <div className="blog-card__tags">
                {p.tags.map((t) => (
                  <span key={t.id} className="blog-tag">
                    {t.label}
                  </span>
                ))}
              </div>
              {tab === "manage" ? (
                <div className="blog-card__actions">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEditor(p)}>
                    Изменить
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm blog-danger" onClick={() => void deletePost(p.id)}>
                    Удалить
                  </button>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
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
              <label className="blog-field">
                <span>Обложка (фото или видео)</span>
                <input
                  type="file"
                  accept="image/*,video/*"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const up = await uploadMedia(f);
                    if (up) {
                      setFormCover(up.url);
                      setFormCoverMime(up.mime);
                    }
                  }}
                />
                {formCover ? (
                  formCoverMime?.startsWith("video/") ? (
                    <video src={formCover} controls className="blog-editor-cover-preview" />
                  ) : (
                    <img src={formCover} alt="" className="blog-editor-cover-preview" />
                  )
                ) : null}
              </label>
              <BlogRichEditor value={formBody} onChange={setFormBody} onUploadMedia={uploadMedia} />
            </div>
            <footer className="blog-editor-modal__foot">
              <button type="button" className="btn btn--ghost" disabled={saving} onClick={() => setEditorOpen(false)}>
                Отмена
              </button>
              <button type="button" className="btn btn--secondary" disabled={saving} onClick={() => void savePost(false)}>
                {formStatus === "published" ? "Сохранить" : "Черновик"}
              </button>
              <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void savePost(true)}>
                Опубликовать
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
