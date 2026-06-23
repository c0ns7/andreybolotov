"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { abApiJson, abAuthHeaders, AbApiError } from "../../lib/ab-api";
import { USER_TICKET_SWAPS_PER_SITE_DAY } from "../../lib/ab-ticket-swap";

type SwapContext = {
  raffle_id: number;
  confirmed_tickets: number[];
  swaps_limit: number;
  swaps_used_today: number;
  swaps_remaining: number;
  day_resets_at_ms: number;
  sequential_batch_size: number;
  sequential_windows: Array<{ from: number; to: number }> | null;
  ticket_start_number: number;
  ticket_end_number: number;
};

type Props = {
  open: boolean;
  raffleId: number;
  raffleTitle: string;
  onClose: () => void;
  onSwapped: () => void;
  toast: (message: string, kind?: "success" | "error" | "warning" | "info" | "neutral") => void;
};

function buildRangeTabs(ctx: SwapContext | null): Array<{ key: string; label: string; from: number; to: number }> {
  if (!ctx) return [];
  const windows = Array.isArray(ctx.sequential_windows) ? ctx.sequential_windows : null;
  if (windows && windows.length) {
    const tabs: Array<{ key: string; label: string; from: number; to: number }> = [];
    const chunk = 500;
    for (const w of windows) {
      const winFrom = Math.max(ctx.ticket_start_number, Math.floor(w.from));
      const winTo = Math.min(ctx.ticket_end_number, Math.floor(w.to));
      if (winTo < winFrom) continue;
      if (winTo - winFrom + 1 <= chunk) {
        tabs.push({ key: `${winFrom}-${winTo}`, label: `${winFrom}–${winTo}`, from: winFrom, to: winTo });
        continue;
      }
      for (let from = winFrom; from <= winTo; from += chunk) {
        const to = Math.min(from + chunk - 1, winTo);
        tabs.push({ key: `${from}-${to}`, label: `${from}–${to}`, from, to });
      }
    }
    return tabs.length ? tabs : [{ key: "all", label: "Все", from: ctx.ticket_start_number, to: ctx.ticket_end_number }];
  }
  return [{ key: "all", label: "Все", from: ctx.ticket_start_number, to: ctx.ticket_end_number }];
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
  const [rangeKey, setRangeKey] = useState("all");

  const rangeTabs = useMemo(() => buildRangeTabs(ctx), [ctx]);
  const activeRange = useMemo(
    () => rangeTabs.find((t) => t.key === rangeKey) || rangeTabs[0] || null,
    [rangeTabs, rangeKey],
  );

  const load = useCallback(async () => {
    if (!raffleId) return;
    setLoading(true);
    setError("");
    try {
      const data = await abApiJson<SwapContext>(`/api/raffles/${String(raffleId)}/ticket-swap`);
      setCtx(data);
      setRangeKey(buildRangeTabs(data)[0]?.key || "all");
      setActiveFrom(null);
      setNewNumber("");
      setLookupKind(null);
    } catch (e) {
      setCtx(null);
      setError(e instanceof AbApiError ? e.message : "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [raffleId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !activeFrom || !raffleId) return;
    const raw = String(newNumber || "").replace(/\D/g, "");
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n <= 0) {
      setLookupKind(null);
      return;
    }
    if (activeRange && (n < activeRange.from || n > activeRange.to)) {
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
  }, [open, activeFrom, newNumber, raffleId, activeRange]);

  const submitSwap = async () => {
    if (!ctx || activeFrom == null || submitBusy) return;
    const toN = Math.floor(Number(String(newNumber).replace(/\D/g, "")));
    if (!Number.isFinite(toN) || toN <= 0) {
      toast("Введите новый номерок", "warning");
      return;
    }
    if (activeRange && (toN < activeRange.from || toN > activeRange.to)) {
      toast(`Новый номерок должен быть в диапазоне ${activeRange.from}–${activeRange.to}`, "warning");
      return;
    }
    if (lookupKind !== "free") {
      toast("Выберите свободный номерок", "warning");
      return;
    }
    setSubmitBusy(true);
    try {
      await abApiJson<{ ok: boolean; from: number; to: number; swaps_remaining: number }>(
        `/api/raffles/${String(raffleId)}/ticket-swap`,
        {
          method: "POST",
          headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ from: activeFrom, to: toN }),
        },
      );
      toast(`Номерок ${activeFrom} заменён на ${toN}`, "success");
      onSwapped();
      await load();
    } catch (e) {
      toast(e instanceof AbApiError ? e.message : "Не удалось заменить номерок", "error");
    } finally {
      setSubmitBusy(false);
    }
  };

  if (!open) return null;

  const swapsLeft = ctx?.swaps_remaining ?? 0;
  const canSwap = swapsLeft > 0;

  return (
    <div className="ticket-swap-sheet" role="dialog" aria-modal="true" aria-labelledby="ticket-swap-title">
      <button type="button" className="ticket-swap-sheet__backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="ticket-swap-sheet__panel">
        <header className="ticket-swap-sheet__head">
          <div>
            <h2 id="ticket-swap-title" className="ticket-swap-sheet__title">
              Управление номерками
            </h2>
            <p className="ticket-swap-sheet__sub">{raffleTitle}</p>
          </div>
          <button type="button" className="ticket-swap-sheet__close" onClick={onClose} aria-label="Закрыть">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        {loading ? <p className="ticket-swap-sheet__muted">Загрузка…</p> : null}
        {!loading && error ? <p className="ticket-swap-sheet__err">{error}</p> : null}

        {!loading && ctx ? (
          <>
            <p className="ticket-swap-sheet__quota">
              Замен сегодня: <strong>{ctx.swaps_used_today}</strong> из{" "}
              <strong>{ctx.swaps_limit || USER_TICKET_SWAPS_PER_SITE_DAY}</strong>
              {swapsLeft > 0 ? (
                <>
                  {" "}
                  · осталось <strong>{swapsLeft}</strong>
                </>
              ) : (
                <span className="ticket-swap-sheet__quota-warn"> · лимит исчерпан до завтра</span>
              )}
            </p>

            {rangeTabs.length > 1 ? (
              <div className="ticket-swap-sheet__tabs" role="tablist" aria-label="Диапазоны номерков">
                {rangeTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={rangeKey === tab.key}
                    className={"ticket-swap-sheet__tab" + (rangeKey === tab.key ? " is-active" : "")}
                    onClick={() => {
                      setRangeKey(tab.key);
                      setNewNumber("");
                      setLookupKind(null);
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            ) : null}

            <p className="ticket-swap-sheet__hint">
              Выберите свой номерок и укажите свободный новый. Старый освободится автоматически.
            </p>

            <ul className="ticket-swap-sheet__list">
              {ctx.confirmed_tickets.map((n) => {
                const openRow = activeFrom === n;
                return (
                  <li key={String(n)} className={"ticket-swap-sheet__item" + (openRow ? " is-open" : "")}>
                    <div className="ticket-swap-sheet__item-row">
                      <span className="ticket-swap-sheet__num">№ {n}</span>
                      <button
                        type="button"
                        className="ticket-swap-sheet__pick"
                        disabled={!canSwap}
                        onClick={() => {
                          if (openRow) {
                            setActiveFrom(null);
                            setNewNumber("");
                            setLookupKind(null);
                          } else {
                            setActiveFrom(n);
                            setNewNumber("");
                            setLookupKind(null);
                          }
                        }}
                      >
                        {openRow ? "Отмена" : "Заменить"}
                      </button>
                    </div>
                    {openRow ? (
                      <div className="ticket-swap-sheet__form">
                        <label className="ticket-swap-sheet__label">
                          Новый номерок
                          {activeRange && rangeTabs.length > 1 ? (
                            <span className="ticket-swap-sheet__range-note">
                              {" "}
                              ({activeRange.from}–{activeRange.to})
                            </span>
                          ) : null}
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="ticket-swap-sheet__input"
                          value={newNumber}
                          placeholder="Введите номер"
                          onChange={(e) => setNewNumber(e.target.value.replace(/[^\d]/g, ""))}
                        />
                        {lookupBusy ? <p className="ticket-swap-sheet__lookup">Проверка…</p> : null}
                        {!lookupBusy && lookupKind === "free" ? (
                          <p className="ticket-swap-sheet__lookup ticket-swap-sheet__lookup--ok">Свободен</p>
                        ) : null}
                        {!lookupBusy && lookupKind && lookupKind !== "free" ? (
                          <p className="ticket-swap-sheet__lookup ticket-swap-sheet__lookup--bad">
                            {lookupKind === "out_of_range"
                              ? "Вне открытого блока"
                              : lookupKind === "taken"
                                ? "Занят"
                                : "Недоступен"}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          className="ticket-swap-sheet__submit"
                          disabled={submitBusy || lookupKind !== "free"}
                          onClick={() => void submitSwap()}
                        >
                          {submitBusy ? "Сохранение…" : `Заменить ${n} → новый`}
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
