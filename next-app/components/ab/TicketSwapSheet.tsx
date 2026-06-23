"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import { abApiJson, abAuthHeaders, AbApiError } from "../../lib/ab-api";
import { USER_TICKET_SWAPS_PER_SITE_DAY } from "../../lib/ab-ticket-swap";

type SwapContext = {
  raffle_id: number;
  confirmed_tickets: number[];
  swaps_limit: number;
  swaps_used_today: number;
  swaps_remaining: number;
  sequential_batch_size: number;
  sequential_windows: Array<{ from: number; to: number }> | null;
};

type Props = {
  open: boolean;
  raffleId: number;
  raffleTitle: string;
  onClose: () => void;
  onSwapped: () => void;
  toast: (message: string, kind?: "success" | "error" | "warning" | "info" | "neutral") => void;
};

type SearchMode = "enter" | "random";

function isInVisibleWindows(n: number, ctx: SwapContext): boolean {
  const batch = Math.max(0, Math.floor(Number(ctx.sequential_batch_size) || 0));
  if (batch <= 0) return true;
  const windows = Array.isArray(ctx.sequential_windows) ? ctx.sequential_windows : [];
  if (!windows.length) return true;
  return windows.some((w) => n >= w.from && n <= w.to);
}

export default function TicketSwapSheet({ open, raffleId, raffleTitle, onClose, onSwapped, toast }: Props) {
  const [loading, setLoading] = useState(false);
  const [ctx, setCtx] = useState<SwapContext | null>(null);
  const [error, setError] = useState("");
  const [activeFrom, setActiveFrom] = useState<number | null>(null);
  const [newNumber, setNewNumber] = useState("");
  const [lookupKind, setLookupKind] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [randomBusy, setRandomBusy] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>("enter");

  const resetPickState = useCallback(() => {
    setNewNumber("");
    setLookupKind(null);
    setSearchMode("enter");
  }, []);

  const load = useCallback(async () => {
    if (!raffleId) return;
    setLoading(true);
    setError("");
    try {
      const data = await abApiJson<SwapContext>(`/api/raffles/${String(raffleId)}/ticket-swap`);
      setCtx(data);
      setActiveFrom(data.confirmed_tickets[0] ?? null);
      resetPickState();
    } catch (e) {
      setCtx(null);
      setError(e instanceof AbApiError ? e.message : "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [raffleId, resetPickState]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open || !ctx || activeFrom == null) return;
    const raw = String(newNumber || "").replace(/\D/g, "");
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n <= 0) {
      setLookupKind(null);
      return;
    }
    if (!isInVisibleWindows(n, ctx)) {
      setLookupKind("out_of_range");
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLookupBusy(true);
      void fetch(`/api/raffles/${String(raffleId)}/ticket-lookup?n=${String(n)}`, {
        headers: abAuthHeaders(),
        cache: "no-store",
      })
        .then((r) => r.json().catch(() => ({})))
        .then((d: { kind?: string }) => {
          if (cancelled) return;
          setLookupKind(String(d.kind || "invalid"));
        })
        .catch(() => {
          if (!cancelled) setLookupKind(null);
        })
        .finally(() => {
          if (!cancelled) setLookupBusy(false);
        });
    }, 320);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, ctx, activeFrom, newNumber, raffleId]);

  const pickRandomFree = async () => {
    if (!ctx || activeFrom == null || randomBusy || ctx.swaps_remaining <= 0) return;
    setRandomBusy(true);
    try {
      const data = await abApiJson<{ n: number }>(`/api/raffles/${String(raffleId)}/ticket-swap/random-free`);
      const n = Math.floor(Number(data.n));
      if (!Number.isFinite(n) || n <= 0) throw new Error("Не удалось подобрать номерок");
      setNewNumber(String(n));
      setLookupKind("free");
      setSearchMode("enter");
      toast(`Подобран свободный номерок: ${n}`, "info");
    } catch (e) {
      toast(e instanceof AbApiError ? e.message : "Не удалось подобрать номерок", "error");
    } finally {
      setRandomBusy(false);
    }
  };

  const submitSwap = async () => {
    if (!ctx || activeFrom == null || submitBusy) return;
    const toN = Math.floor(Number(String(newNumber).replace(/\D/g, "")));
    if (!Number.isFinite(toN) || toN <= 0) {
      toast("Укажите новый номерок", "warning");
      return;
    }
    if (!isInVisibleWindows(toN, ctx)) {
      toast("Номерок вне открытых блоков", "warning");
      return;
    }
    if (lookupKind !== "free") {
      toast("Выберите свободный номерок", "warning");
      return;
    }
    setSubmitBusy(true);
    try {
      await abApiJson(`/api/raffles/${String(raffleId)}/ticket-swap`, {
        method: "POST",
        headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ from: activeFrom, to: toN }),
      });
      toast(`Номерок ${activeFrom} заменён на ${toN}`, "success");
      onSwapped();
      await load();
    } catch (e) {
      toast(e instanceof AbApiError ? e.message : "Не удалось заменить номерок", "error");
    } finally {
      setSubmitBusy(false);
    }
  };

  const swapsLeft = ctx?.swaps_remaining ?? 0;
  const canSwap = swapsLeft > 0;
  const toN = Math.floor(Number(String(newNumber).replace(/\D/g, "")));
  const readyToSwap = canSwap && activeFrom != null && lookupKind === "free" && Number.isFinite(toN) && toN > 0;

  const badgeText =
    lookupBusy && newNumber
      ? "…"
      : lookupKind === "free"
        ? "Свободен"
        : lookupKind === "taken"
          ? "Занят"
          : lookupKind === "out_of_range"
            ? "Вне блока"
            : lookupKind === "self_confirmed" || lookupKind === "self_reserved" || lookupKind === "self_pending"
              ? "Ваш"
              : lookupKind === "invalid" && newNumber
                ? "Нет в акции"
                : "";
  const fieldKind =
    lookupKind === "free"
      ? "free"
      : lookupKind === "taken"
        ? "taken"
        : lookupKind === "out_of_range" || lookupKind === "invalid"
          ? "invalid"
          : "";
  const badgeClass =
    lookupKind === "free"
      ? "ticket-search-status-badge--free"
      : lookupKind === "taken"
        ? "ticket-search-status-badge--taken"
        : lookupKind === "self_confirmed" || lookupKind === "self_reserved" || lookupKind === "self_pending"
          ? "ticket-search-status-badge--self"
          : lookupKind === "out_of_range" || lookupKind === "invalid"
            ? "ticket-search-status-badge--invalid"
            : "ticket-search-status-badge--empty";

  return (
    <div
      id="modal-ticket-swap"
      className={"modal-overlay history-modal ticket-swap-modal" + (open ? " is-open" : "")}
      aria-hidden={open ? "false" : "true"}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-ticket-swap-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="history-modal__dialog" role="document">
        <button type="button" className="history-modal__close" aria-label="Закрыть" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
        <div className="history-modal__inner">
          <div className="history-modal__head">
            <button type="button" className="history-modal__back" aria-label="Назад" onClick={onClose}>
              <ArrowLeft size={20} aria-hidden="true" />
            </button>
            <h2 id="modal-ticket-swap-title" className="history-modal__title">
              Управление номерками
            </h2>
          </div>

          <div className="history-modal__body custom-scrollbar ticket-swap-modal__body">
            {loading ? (
              <div className="history-modal__loader-wrap" role="status" aria-live="polite">
                <div className="history-modal__loader" />
              </div>
            ) : null}

            {!loading && error ? <p className="history-modal__status history-modal__status--error">{error}</p> : null}

            {!loading && ctx ? (
              <div className="ticket-swap-modal__content">
                <p className="ticket-swap-modal__raffle">{raffleTitle}</p>
                <p className="ticket-swap-modal__quota">
                  Замен сегодня: <strong>{ctx.swaps_used_today}</strong> /{" "}
                  <strong>{ctx.swaps_limit || USER_TICKET_SWAPS_PER_SITE_DAY}</strong>
                  {swapsLeft > 0 ? (
                    <>
                      {" "}
                      · осталось <strong>{swapsLeft}</strong>
                    </>
                  ) : (
                    <span className="ticket-swap-modal__quota-warn"> · лимит исчерпан</span>
                  )}
                </p>

                <section className="ticket-swap-modal__section">
                  <h3 className="ticket-swap-modal__section-title">Какой номерок заменить</h3>
                  <p className="ticket-swap-modal__section-hint">Выберите один из ваших оплаченных номерков.</p>
                  <div className="ticket-swap-modal__mine-chips" role="listbox" aria-label="Ваши номерки">
                    {ctx.confirmed_tickets.map((n) => (
                      <button
                        key={String(n)}
                        type="button"
                        role="option"
                        aria-selected={activeFrom === n}
                        disabled={!canSwap}
                        className={
                          "ticket-swap-modal__mine-chip" + (activeFrom === n ? " is-active" : "")
                        }
                        onClick={() => {
                          setActiveFrom(n);
                          resetPickState();
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="ticket-swap-modal__section">
                  <h3 className="ticket-swap-modal__section-title">Новый номерок</h3>
                  <p className="ticket-swap-modal__section-hint">
                    Только свободные номерки из открытых сейчас блоков. Старый номерок освободится.
                  </p>

                  <div className="ticket-search-sheet__segment" role="tablist" aria-label="Режим поиска">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={searchMode === "enter"}
                      className={
                        "ticket-search-sheet__seg" + (searchMode === "enter" ? " ticket-search-sheet__seg--active" : "")
                      }
                      onClick={() => setSearchMode("enter")}
                    >
                      Ввести номер
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={searchMode === "random"}
                      className={
                        "ticket-search-sheet__seg" + (searchMode === "random" ? " ticket-search-sheet__seg--active" : "")
                      }
                      onClick={() => setSearchMode("random")}
                      disabled={!canSwap || activeFrom == null}
                    >
                      Случайный выбор
                    </button>
                  </div>

                  {searchMode === "enter" ? (
                    <div className="ticket-swap-modal__search-panel">
                      <h4 className="ticket-search-sheet__label">Номер билета</h4>
                      <div
                        className={
                          "ticket-search-sheet__field" + (fieldKind ? ` ticket-search-sheet__field--${fieldKind}` : "")
                        }
                      >
                        <input
                          className="ticket-search-sheet__input"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete="off"
                          value={newNumber}
                          disabled={!canSwap || activeFrom == null}
                          placeholder="Введите номер"
                          onChange={(e) => setNewNumber(e.target.value.replace(/[^\d]/g, ""))}
                        />
                        <span
                          className={"ticket-search-status-badge " + badgeClass}
                          aria-live="polite"
                        >
                          {badgeText}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="ticket-swap-modal__search-panel">
                      <p className="ticket-swap-modal__random-text">
                        Подберём случайный свободный номерок среди доступных сейчас.
                      </p>
                      <button
                        type="button"
                        className="btn btn--primary ticket-search-sheet__cta ticket-search-sheet__cta--blue"
                        disabled={randomBusy || !canSwap || activeFrom == null}
                        onClick={() => void pickRandomFree()}
                      >
                        {randomBusy ? "Подбор…" : "Случайный свободный номерок"}
                      </button>
                    </div>
                  )}
                </section>

                {readyToSwap && activeFrom != null ? (
                  <div className="ticket-swap-modal__preview">
                    <span className="ticket-swap-modal__preview-label">Замена</span>
                    <span className="ticket-swap-modal__preview-nums">
                      № {activeFrom} → № {toN}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className={
              "ticket-swap-modal__confirm" + (readyToSwap ? " ticket-swap-modal__confirm--ready" : "")
            }
            disabled={!readyToSwap || submitBusy}
            onClick={() => void submitSwap()}
          >
            {submitBusy ? "Сохранение…" : readyToSwap ? `Заменить № ${activeFrom} на № ${toN}` : "Выберите номерки"}
          </button>
          <button type="button" className="history-modal__btn-back" onClick={onClose}>
            Назад
          </button>
        </div>
      </div>
    </div>
  );
}
