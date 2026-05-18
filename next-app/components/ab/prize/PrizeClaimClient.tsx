"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { abApiJson, abAuthHeaders } from "../../../lib/ab-api";
import { useAbSession } from "../AbSessionContext";

type PrizeDto = {
  id: number;
  title: string;
  description: string;
  status: string;
  response_message: string;
  claimed_at: number | null;
};

export default function PrizeClaimClient() {
  const params = useParams();
  const router = useRouter();
  const { session, authVerified, toast } = useAbSession();
  const prizeId = Number(params?.id);

  const [prize, setPrize] = useState<PrizeDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  const loadPrize = useCallback(async () => {
    if (!Number.isFinite(prizeId)) return;
    setLoading(true);
    try {
      const data = await abApiJson<{ prize: PrizeDto }>(`/api/prizes/${prizeId}`, {
        headers: abAuthHeaders(),
        cache: "no-store",
      });
      setPrize(data.prize);
      if (data.prize?.response_message) {
        setMessage(data.prize.response_message);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не удалось загрузить приз", "error");
      setPrize(null);
    } finally {
      setLoading(false);
    }
  }, [prizeId, toast]);

  useEffect(() => {
    if (!authVerified) return;
    if (!session?.token) {
      router.replace("/");
      return;
    }
    void loadPrize();
  }, [authVerified, session?.token, loadPrize, router]);

  const submit = async () => {
    if (!prize || sending) return;
    const text = message.trim();
    if (text.length < 2) {
      toast("Напишите ответ", "error");
      return;
    }
    setSending(true);
    try {
      await abApiJson(`/api/prizes/${prize.id}/claim`, {
        method: "POST",
        headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      toast("Ответ отправлен", "success");
      await loadPrize();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка отправки", "error");
    } finally {
      setSending(false);
    }
  };

  if (!authVerified || loading) {
    return (
      <div className="prize-claim-page">
        <p className="prize-claim-page__loading">Загрузка…</p>
      </div>
    );
  }

  if (!prize) {
    return (
      <div className="prize-claim-page">
        <Link href="/home/chat" className="prize-claim-page__back">
          ← В чат
        </Link>
        <p className="prize-claim-page__error">Приз не найден или недоступен.</p>
      </div>
    );
  }

  const submitted =
    !!prize.claimed_at || prize.status === "claimed" || prize.status === "processing" || prize.status === "done";

  return (
    <div className="prize-claim-page">
      <header className="prize-claim-page__head">
        <Link href="/home/chat" className="prize-claim-page__back">
          ← В чат
        </Link>
      </header>

      <div className="prize-claim-card">
        <div className="prize-claim-card__badge">🎁 Приз</div>
        <h1 className="prize-claim-card__title">{prize.title}</h1>

        {prize.description ? (
          <div className="prize-claim-card__hint">
            <strong>Что указать в ответе:</strong>
            <p>{prize.description}</p>
          </div>
        ) : null}

        {submitted ? (
          <div className="prize-claim-card__done">
            <p className="prize-claim-card__done-title">Ответ отправлен</p>
            <p className="prize-claim-card__done-text">Спасибо! Мы обработаем вашу заявку.</p>
            {prize.response_message ? (
              <div className="prize-claim-card__response">
                <p className="prize-claim-card__response-label">Ваш ответ</p>
                <p className="prize-claim-card__response-text">{prize.response_message}</p>
              </div>
            ) : null}
            <Link href="/home/chat" className="btn btn--primary prize-claim-card__btn">
              В чат
            </Link>
          </div>
        ) : (
          <>
            <p className="prize-claim-card__lead">Напишите ответ ниже и нажмите «Отправить».</p>
            <label className="form-group prize-claim-form">
              <span>Ваш ответ</span>
              <textarea
                className="input prize-claim-card__textarea"
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Например: телефон для перевода, адрес доставки или другие данные…"
                required
              />
            </label>
            <button
              type="button"
              className="btn btn--primary prize-claim-card__btn"
              disabled={sending}
              onClick={() => void submit()}
            >
              {sending ? "Отправка…" : "Отправить ответ"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
