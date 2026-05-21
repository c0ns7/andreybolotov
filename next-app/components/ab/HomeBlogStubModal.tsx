"use client";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function HomeBlogStubModal({ open, onClose }: Props) {
  return (
    <div
      id="modal-blog-stub"
      className={"modal-overlay blog-stub-modal" + (open ? " is-open" : "")}
      aria-hidden={open ? "false" : "true"}
      role="dialog"
      aria-modal="true"
      aria-labelledby="blog-stub-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="blog-stub-modal__dialog" role="document">
        <button type="button" className="blog-stub-modal__close" aria-label="Закрыть" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <div className="blog-stub-modal__icon-wrap" aria-hidden="true">
          <div className="blog-stub-modal__icon-glow" />
          <svg className="blog-stub-modal__icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            <path d="M15 6l3 3" />
          </svg>
        </div>
        <h2 id="blog-stub-title" className="blog-stub-modal__title">
          Блог временно недоступен
        </h2>
        <p className="blog-stub-modal__lead">Раздел отключён</p>
        <p className="blog-stub-modal__text">
          Администратор временно закрыл блог. Новости и истории участников появятся здесь, когда раздел снова откроют.
        </p>
        <button type="button" className="btn btn--primary blog-stub-modal__btn" onClick={onClose}>
          Понятно
        </button>
      </div>
    </div>
  );
}
