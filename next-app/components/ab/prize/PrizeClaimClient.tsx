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
  prize_type: "physical" | "money";
  status: string;
  claim_data: Record<string, string> | null;
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

  const [recipientName, setRecipientName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [bank, setBank] = useState("");
  const [comment, setComment] = useState("");

  const loadPrize = useCallback(async () => {
    if (!Number.isFinite(prizeId)) return;
    setLoading(true);
    try {
      const data = await abApiJson<{ prize: PrizeDto }>(`/api/prizes/${prizeId}`, {
        headers: abAuthHeaders(),
        cache: "no-store",
      });
      setPrize(data.prize);
      if (data.prize?.claim_data && typeof data.prize.claim_data === "object") {
        const c = data.prize.claim_data;
        setRecipientName(String(c.recipient_name || ""));
        setAddress(String(c.address || ""));
        setPhone(String(c.phone || session?.phone || ""));
        setBank(String(c.bank || ""));
        setComment(String(c.comment || ""));
      } else if (session?.phone) {
        setPhone(session.phone.replace(/\D/g, "").slice(-11));
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не удалось загрузить приз", "error");
      setPrize(null);
    } finally {
      setLoading(false);
    }
  }, [prizeId, session?.phone, toast]);

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
    setSending(true);
    try {
      const body =
        prize.prize_type === "money"
          ? { phone, bank, recipient_name: recipientName, comment }
          : { recipient_name: recipientName, address, comment };
      await abApiJson(`/api/prizes/${prize.id}/claim`, {
        method: "POST",
        headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      toast("Данные отправлены. Мы свяжемся с вами при необходимости.", "success");
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

  const submitted = !!prize.claimed_at || prize.status === "claimed" || prize.status === "processing" || prize.status === "done";

  return (
    <div className="prize-claim-page">
      <header className="prize-claim-page__head">
        <Link href="/home/chat" className="prize-claim-page__back">
          ← В чат
        </Link>
      </header>

      <div className="prize-claim-card">
        <div className="prize-claim-card__badge">🎁 Ваш приз</div>
        <h1 className="prize-claim-card__title">{prize.title}</h1>
        {prize.description ? <p className="prize-claim-card__desc">{prize.description}</p> : null}

        {submitted ? (
          <div className="prize-claim-card__done">
            <p className="prize-claim-card__done-title">Данные уже отправлены</p>
            <p className="prize-claim-card__done-text">
              Спасибо! Мы обработаем вашу заявку. При необходимости напишем в чат поддержки.
            </p>
            {prize.claim_data ? (
              <dl className="prize-claim-card__summary">
                {prize.prize_type === "money" ? (
                  <>
                    <dt>Телефон</dt>
                    <dd>{prize.claim_data.phone}</dd>
                    <dt>Банк</dt>
                    <dd>{prize.claim_data.bank}</dd>
                    <dt>Получатель</dt>
                    <dd>{prize.claim_data.recipient_name}</dd>
                  </>
                ) : (
                  <>
                    <dt>Получатель</dt>
                    <dd>{prize.claim_data.recipient_name}</dd>
                    <dt>Адрес</dt>
                    <dd>{prize.claim_data.address}</dd>
                  </>
                )}
              </dl>
            ) : null}
            <Link href="/home/chat" className="btn btn--primary prize-claim-card__btn">
              В чат поддержки
            </Link>
          </div>
        ) : (
          <>
            <p className="prize-claim-card__hint">
              {prize.prize_type === "money"
                ? "Укажите телефон для перевода, банк и ФИО получателя."
                : "Укажите ФИО получателя и полный адрес доставки."}
            </p>
            <form
              className="prize-claim-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <label className="form-group">
                <span>ФИО получателя</span>
                <input className="input" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} required />
              </label>
              {prize.prize_type === "money" ? (
                <>
                  <label className="form-group">
                    <span>Телефон</span>
                    <input
                      className="input"
                      type="tel"
                      inputMode="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                    />
                  </label>
                  <label className="form-group">
                    <span>Банк</span>
                    <input className="input" value={bank} onChange={(e) => setBank(e.target.value)} required />
                  </label>
                </>
              ) : (
                <label className="form-group">
                  <span>Адрес доставки</span>
                  <textarea
                    className="input"
                    rows={3}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    required
                    placeholder="Индекс, город, улица, дом, квартира"
                  />
                </label>
              )}
              <label className="form-group">
                <span>Комментарий (необязательно)</span>
                <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
              <button type="submit" className="btn btn--primary prize-claim-card__btn" disabled={sending}>
                {sending ? "Отправка…" : "Отправить данные"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
