"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

const COLORS = ["#0f172a", "#dc2626", "#ea580c", "#16a34a", "#2563eb", "#7c3aed", "#db2777"];

export type BlogRichEditorHandle = {
  getHtml: () => string;
};

type Props = {
  value: string;
  onChange: (html: string) => void;
  onUploadMedia?: (file: File) => Promise<{ url: string; mime: string } | null>;
};

const BlogRichEditor = forwardRef<BlogRichEditorHandle, Props>(function BlogRichEditor(
  { value, onChange, onUploadMedia },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const skipPropSyncRef = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      getHtml: () => {
        const el = editorRef.current;
        return String(el?.innerHTML ?? value ?? "").trim();
      },
    }),
    [value],
  );

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (skipPropSyncRef.current) {
      skipPropSyncRef.current = false;
      return;
    }
    const next = value || "";
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [value]);

  const sync = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    skipPropSyncRef.current = true;
    onChange(el.innerHTML);
  }, [onChange]);

  const cmd = (command: string, val?: string) => {
    document.execCommand(command, false, val);
    sync();
    editorRef.current?.focus();
  };

  const insertHtml = (html: string) => {
    document.execCommand("insertHTML", false, html);
    sync();
  };

  const onPickFile = async (accept: string) => {
    if (!onUploadMedia) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const res = await onUploadMedia(file);
      if (!res) return;
      const url = res.url;
      if (res.mime.startsWith("video/")) {
        insertHtml(
          `<p><video controls playsinline style="max-width:100%;border-radius:12px" src="${url}"></video></p>`,
        );
      } else {
        insertHtml(`<p><img src="${url}" alt="" style="max-width:100%;border-radius:12px" /></p>`);
      }
    };
    input.click();
  };

  return (
    <div className="blog-editor">
      <div className="blog-editor__toolbar" role="toolbar" aria-label="Форматирование">
        <button type="button" className="blog-editor__btn" onClick={() => cmd("bold")} title="Жирный">
          <b>B</b>
        </button>
        <button type="button" className="blog-editor__btn" onClick={() => cmd("italic")} title="Курсив">
          <i>I</i>
        </button>
        <button type="button" className="blog-editor__btn" onClick={() => cmd("underline")} title="Подчёркнутый">
          <u>U</u>
        </button>
        <span className="blog-editor__sep" />
        <button type="button" className="blog-editor__btn" onClick={() => cmd("formatBlock", "h2")} title="Заголовок">
          H2
        </button>
        <button type="button" className="blog-editor__btn" onClick={() => cmd("formatBlock", "p")} title="Абзац">
          P
        </button>
        <span className="blog-editor__sep" />
        <button type="button" className="blog-editor__btn" onClick={() => cmd("insertUnorderedList")} title="Список">
          •
        </button>
        <button
          type="button"
          className="blog-editor__btn"
          onClick={() => {
            const url = window.prompt("Ссылка (https://…)", "https://");
            if (url) cmd("createLink", url);
          }}
          title="Ссылка"
        >
          🔗
        </button>
        <span className="blog-editor__sep" />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="blog-editor__color"
            style={{ background: c }}
            title={`Цвет ${c}`}
            onClick={() => cmd("foreColor", c)}
          />
        ))}
        <span className="blog-editor__sep" />
        <button type="button" className="blog-editor__btn" onClick={() => onPickFile("image/*")} title="Фото">
          🖼
        </button>
        <button type="button" className="blog-editor__btn" onClick={() => onPickFile("video/*")} title="Видео">
          ▶
        </button>
      </div>
      <div
        ref={editorRef}
        className="blog-editor__area"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder="Текст поста…"
        onInput={sync}
        onBlur={sync}
      />
    </div>
  );
});

export default BlogRichEditor;
