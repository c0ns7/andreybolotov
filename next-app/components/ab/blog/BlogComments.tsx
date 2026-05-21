"use client";

import { Heart, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { abApiJson } from "../../../lib/ab-api";
import type { BlogComment, BlogCommentSort } from "../../../lib/ab-blog-types";
import { BLOG_COMMENTS_PAGE_SIZE } from "../../../lib/ab-blog-types";

function formatCommentTime(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 45_000) return "только что";
  if (diff < 3600_000) {
    const m = Math.max(1, Math.floor(diff / 60_000));
    return `${m} мин`;
  }
  if (diff < 86400_000) {
    const h = Math.floor(diff / 3600_000);
    return `${h} ч`;
  }
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function avatarHue(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function sortTop(list: BlogComment[]) {
  return [...list].sort((a, b) => b.like_count - a.like_count || b.created_at - a.created_at);
}

type Props = {
  postId: number;
  totalCount: number;
  refreshKey?: number;
  headers: Record<string, string>;
  isAdmin: boolean;
  sessionUserId: number;
  onCountChange: (count: number) => void;
  toast: (message: string, kind?: "success" | "error" | "warning" | "info" | "neutral") => void;
};

export default function BlogComments({
  postId,
  totalCount,
  refreshKey = 0,
  headers,
  isAdmin,
  sessionUserId,
  onCountChange,
  toast,
}: Props) {
  const [sort, setSort] = useState<BlogCommentSort>("top");
  const [comments, setComments] = useState<BlogComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [likingId, setLikingId] = useState<number | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreLock = useRef(false);
  const offsetRef = useRef(0);

  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      const data = await abApiJson<{
        comments: BlogComment[];
        has_more: boolean;
      }>(
        `/api/blog/posts/${postId}/comments?sort=${sort}&limit=${BLOG_COMMENTS_PAGE_SIZE}&offset=${offset}`,
        { headers },
      );
      const batch = data.comments || [];
      setHasMore(!!data.has_more);
      offsetRef.current = offset + batch.length;
      setComments((prev) => {
        if (!append) return batch;
        const seen = new Set(prev.map((c) => c.id));
        const merged = [...prev];
        for (const c of batch) {
          if (!seen.has(c.id)) merged.push(c);
        }
        return merged;
      });
    },
    [postId, sort, headers],
  );

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setHasMore(false);
    offsetRef.current = 0;
    try {
      await fetchPage(0, false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не удалось загрузить комментарии", "error");
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [fetchPage, toast]);

  const loadMore = useCallback(async () => {
    if (loadMoreLock.current || loading || loadingMore || !hasMore) return;
    loadMoreLock.current = true;
    setLoadingMore(true);
    try {
      await fetchPage(offsetRef.current, true);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не удалось подгрузить", "error");
    } finally {
      setLoadingMore(false);
      loadMoreLock.current = false;
    }
  }, [fetchPage, hasMore, loading, loadingMore, toast]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial, refreshKey]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || loading) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root: null, rootMargin: "120px 0px", threshold: 0 },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [loadMore, loading, hasMore, comments.length]);

  const sendComment = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      const data = await abApiJson<{ comment: BlogComment }>(`/api/blog/posts/${postId}/comments`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft.trim() }),
      });
      if (data.comment) {
        setComments((list) => {
          if (list.some((c) => c.id === data.comment.id)) return list;
          const next = sort === "new" ? [data.comment, ...list] : sortTop([...list, data.comment]);
          return next;
        });
        offsetRef.current += 1;
        onCountChange(totalCount + 1);
      }
      setDraft("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "error");
    } finally {
      setSending(false);
    }
  };

  const toggleCommentLike = async (comment: BlogComment) => {
    if (likingId != null) return;
    setLikingId(comment.id);
    try {
      const data = await abApiJson<{ liked: boolean; like_count: number }>(
        `/api/blog/comments/${comment.id}/like`,
        { method: "POST", headers },
      );
      setComments((list) => {
        const next = list.map((c) =>
          c.id === comment.id ? { ...c, liked_by_me: data.liked, like_count: data.like_count } : c,
        );
        if (sort !== "top") return next;
        return sortTop(next);
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "error");
    } finally {
      setLikingId(null);
    }
  };

  const deleteComment = async (commentId: number) => {
    if (!window.confirm("Удалить комментарий?")) return;
    try {
      await abApiJson(`/api/blog/comments/${commentId}`, { method: "DELETE", headers });
      setComments((list) => list.filter((c) => c.id !== commentId));
      offsetRef.current = Math.max(0, offsetRef.current - 1);
      onCountChange(Math.max(0, totalCount - 1));
      toast("Комментарий удалён", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не удалось удалить", "error");
    }
  };

  return (
    <section className="blog-cmt" id="comments" aria-labelledby="blog-cmt-title">
      <header className="blog-cmt__head">
        <div className="blog-cmt__title-row">
          <h2 id="blog-cmt-title" className="blog-cmt__title">
            Комментарии
          </h2>
          <span className="blog-cmt__count" aria-label={`${totalCount} комментариев`}>
            {totalCount}
          </span>
        </div>
        <div className="blog-cmt__sort" role="tablist" aria-label="Сортировка комментариев">
          <button
            type="button"
            role="tab"
            aria-selected={sort === "top"}
            className={"blog-cmt__sort-btn" + (sort === "top" ? " is-active" : "")}
            onClick={() => setSort("top")}
          >
            Интересные
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sort === "new"}
            className={"blog-cmt__sort-btn" + (sort === "new" ? " is-active" : "")}
            onClick={() => setSort("new")}
          >
            Новые
          </button>
        </div>
      </header>

      {loading ? (
        <ul className="blog-cmt__list blog-cmt__list--loading" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <li key={n} className="blog-cmt__skel">
              <div className="blog-cmt__skel-ava" />
              <div className="blog-cmt__skel-lines">
                <div className="blog-cmt__skel-line blog-cmt__skel-line--short" />
                <div className="blog-cmt__skel-line" />
              </div>
            </li>
          ))}
        </ul>
      ) : comments.length ? (
        <>
          <ul className="blog-cmt__list">
            {comments.map((c) => {
              const canDelete = isAdmin || (sessionUserId > 0 && Number(c.user_id) === sessionUserId);
              const name = c.user_name || "Участник";
              const hue = avatarHue(name);
              return (
                <li key={c.id} className="blog-cmt__item">
                  <article className="blog-cmt__card">
                    <div
                      className="blog-cmt__avatar"
                      style={{ background: `hsl(${hue} 68% 48%)` }}
                      aria-hidden="true"
                    >
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div className="blog-cmt__main">
                      <header className="blog-cmt__meta">
                        <span className="blog-cmt__author">{name}</span>
                        <time className="blog-cmt__time" dateTime={new Date(c.created_at).toISOString()}>
                          {formatCommentTime(c.created_at)}
                        </time>
                      </header>
                      <p className="blog-cmt__text">{c.body}</p>
                      <footer className="blog-cmt__actions">
                        <button
                          type="button"
                          className={
                            "blog-cmt__like" +
                            (c.liked_by_me ? " is-liked" : "") +
                            (likingId === c.id ? " is-busy" : "")
                          }
                          onClick={() => void toggleCommentLike(c)}
                          aria-pressed={c.liked_by_me}
                          aria-label={c.liked_by_me ? "Убрать лайк" : "Нравится"}
                          disabled={likingId === c.id}
                        >
                          <Heart size={16} fill={c.liked_by_me ? "currentColor" : "none"} aria-hidden="true" />
                          <span>{c.like_count > 0 ? c.like_count : "Нравится"}</span>
                        </button>
                        {canDelete ? (
                          <button
                            type="button"
                            className="blog-cmt__delete"
                            aria-label="Удалить комментарий"
                            onClick={() => void deleteComment(c.id)}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        ) : null}
                      </footer>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
          <div ref={sentinelRef} className="blog-cmt__sentinel" aria-hidden="true" />
          {loadingMore ? (
            <p className="blog-cmt__more" role="status">
              Загрузка…
            </p>
          ) : null}
        </>
      ) : (
        <p className="blog-cmt__empty">Пока нет комментариев — напишите первым.</p>
      )}

      <form
        className="blog-cmt__composer"
        onSubmit={(e) => {
          e.preventDefault();
          void sendComment();
        }}
      >
        <label className="blog-cmt__composer-label" htmlFor="blog-cmt-input">
          Ваш комментарий
        </label>
        <textarea
          id="blog-cmt-input"
          className="input blog-cmt__input"
          rows={3}
          placeholder="Написать комментарий…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void sendComment();
            }
          }}
        />
        <button type="submit" className="btn btn--primary blog-cmt__submit" disabled={sending || !draft.trim()}>
          {sending ? "Отправка…" : "Отправить"}
        </button>
      </form>
    </section>
  );
}
