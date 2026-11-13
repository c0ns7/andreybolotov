"use client";

import { Gift, RefreshCw, TriangleAlert } from "lucide-react";

type Props = {
  variant: "error" | "empty";
  onRetry?: () => void;
  retrying?: boolean;
  onOpenChat?: () => void;
};

export default function HomeFeedEmpty({ variant, onRetry, retrying = false, onOpenChat }: Props) {
  const isError = variant === "error";

  return (
    <div
      className={"home-feed-empty" + (isError ? " home-feed-empty--error" : "")}
      role="status"
      aria-live="polite"
    >
      <div className="home-feed-empty__card">
        <div className="home-feed-empty__glow" aria-hidden="true" />
        <div className="home-feed-empty__icon-wrap" aria-hidden="true">
          {isError ? (
            <TriangleAlert size={36} strokeWidth={1.75} />
          ) : (
            <Gift size={36} strokeWidth={1.75} />
          )}
        </div>
        <h2 className="home-feed-empty__title">
          {isError ? "Не удалось загрузить акции" : "Пока нет акций"}
        </h2>
        <p className="home-feed-empty__text">
          {isError
            ? "Возможно, пропал интернет или сервер временно недоступен. Проверьте подключение и нажмите «Обновить»."
            : "Когда появится новая акция, она будет здесь. А пока загляните в билеты или напишите нам — всегда рады помочь."}
        </p>
        <div className="home-feed-empty__actions">
          {isError ? (
            <>
              <button
                type="button"
                className={
                  "home-feed-empty__btn home-feed-empty__btn--primary" +
                  (retrying ? " home-feed-empty__btn--loading" : "")
                }
                onClick={onRetry}
                disabled={retrying}
              >
                <RefreshCw
                  size={18}
                  strokeWidth={2.25}
                  className="home-feed-empty__btn-icon"
                  aria-hidden="true"
                />
                <span>{retrying ? "Обновляем…" : "Обновить"}</span>
              </button>
              {onOpenChat ? (
                <button
                  type="button"
                  className="home-feed-empty__btn home-feed-empty__btn--ghost"
                  onClick={onOpenChat}
                  disabled={retrying}
                >
                  Чат поддержки
                </button>
              ) : null}
            </>
          ) : onOpenChat ? (
            <button type="button" className="home-feed-empty__btn home-feed-empty__btn--primary" onClick={onOpenChat}>
              Написать в чат поддержки
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
