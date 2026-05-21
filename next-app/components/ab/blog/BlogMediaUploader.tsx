"use client";

import { GripVertical, Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import { BLOG_MEDIA_MAX, type BlogMediaItem } from "../../../lib/ab-blog-types";

export type BlogUploadProgress = {
  localId: string;
  name: string;
  progress: number;
  busy: boolean;
  error: string;
  done: boolean;
};

type Props = {
  items: BlogMediaItem[];
  uploads: BlogUploadProgress[];
  onPickFiles: (files: FileList | File[]) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
};

export default function BlogMediaUploader({
  items,
  uploads,
  onPickFiles,
  onRemove,
  onMove,
  disabled,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canAdd = items.length + uploads.filter((u) => u.busy).length < BLOG_MEDIA_MAX;

  return (
    <div className="blog-media-uploader">
      <div className="blog-media-uploader__head">
        <span className="blog-media-uploader__label">
          Медиа ({items.length}/{BLOG_MEDIA_MAX})
        </span>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={disabled || !canAdd}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={16} aria-hidden="true" />
          Добавить
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onPickFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {uploads.length ? (
        <ul className="blog-media-uploader__progress-list">
          {uploads.map((u) => (
            <li key={u.localId} className={"blog-media-uploader__progress" + (u.error ? " is-error" : u.done ? " is-done" : "")}>
              <span className="blog-media-uploader__progress-name">{u.name}</span>
              <div className="blog-media-uploader__progress-track" aria-hidden="true">
                <div
                  className="blog-media-uploader__progress-bar"
                  style={{ width: Math.round((u.error ? 0 : u.progress) * 100) + "%" }}
                />
              </div>
              <span className="blog-media-uploader__progress-label">
                {u.error || (u.busy ? "Загрузка… " + Math.round(u.progress * 100) + "%" : u.done ? "Готово" : "")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {items.length ? (
        <ul className="blog-media-uploader__grid">
          {items.map((item, i) => (
            <li key={item.id ? "id-" + item.id : "u-" + item.url} className="blog-media-uploader__item">
              <div className="blog-media-uploader__thumb">
                {item.mime?.startsWith("video/") ? (
                  <video src={item.url} muted playsInline />
                ) : (
                  <img src={item.url} alt="" />
                )}
              </div>
              <div className="blog-media-uploader__item-actions">
                <button
                  type="button"
                  className="blog-media-uploader__move"
                  disabled={disabled || i === 0}
                  onClick={() => onMove(i, i - 1)}
                  aria-label="Выше"
                >
                  <GripVertical size={16} />
                </button>
                <button
                  type="button"
                  className="blog-media-uploader__move"
                  disabled={disabled || i >= items.length - 1}
                  onClick={() => onMove(i, i + 1)}
                  aria-label="Ниже"
                >
                  <GripVertical size={16} />
                </button>
                <button
                  type="button"
                  className="blog-media-uploader__remove"
                  disabled={disabled}
                  onClick={() => onRemove(i)}
                  aria-label="Удалить"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="blog-media-uploader__hint">До {BLOG_MEDIA_MAX} фото или видео. Первое — обложка в ленте.</p>
      )}
    </div>
  );
}
