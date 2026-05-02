"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { detachWebSocket } from "../../lib/ab-ws";
const BAND = 500;
const MAX_CHIPS_PER_BAND = 2000;

function esc(s: string) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function expandRanges(ranges: unknown): number[] {
  if (!Array.isArray(ranges)) return [];
  const out: number[] = [];
  for (const it of ranges) {
    if (!Array.isArray(it) || it.length < 2) continue;
    const a = Math.floor(Number(it[0]));
    const b = Math.floor(Number(it[1]));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < a) continue;
    for (let n = a; n <= b; n++) out.push(n);
  }
  return out;
}

export default function NumbersPageClient() {
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"" | "muted" | "ok" | "err">("");
  const [title, setTitle] = useState("Свободные номерки");
  const [meta, setMeta] = useState("Загрузка данных…");
  const [bandsHtml, setBandsHtml] = useState("");
  const currentRaffleId = useRef<number | null>(null);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnect = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStatusLine = useCallback((text: string, kind: typeof statusKind) => {
    setStatus(text);
    setStatusKind(kind || "");
  }, []);

  const renderBands = useCallback((ticketCount: number, freeList: number[]) => {
    if (!ticketCount || ticketCount < 1) {
      setBandsHtml("");
      return;
    }
    const freeSet = new Set(freeList);
    let html = "";
    for (let start = 1; start <= ticketCount; start += BAND) {
      const end = Math.min(start + BAND - 1, ticketCount);
      const nums: number[] = [];
      for (let n = start; n <= end; n++) {
        if (freeSet.has(n)) nums.push(n);
      }
      html +=
        '<section class="numbers-band" aria-labelledby="numbers-band-h-' +
        start +
        '">' +
        '<div class="numbers-band__head">' +
        '<h2 class="numbers-band__title" id="numbers-band-h-' +
        start +
        '">Номерки ' +
        start +
        "–" +
        end +
        "</h2>" +
        '<span class="numbers-band__stat">Свободно в диапазоне: <strong>' +
        nums.length +
        "</strong></span>" +
        "</div>";
      if (!nums.length) {
        html += '<p class="numbers-band__empty">В этом диапазоне нет свободных номерков.</p>';
      } else {
        let show = nums;
        let hidden = 0;
        if (nums.length > MAX_CHIPS_PER_BAND) {
          show = nums.slice(0, MAX_CHIPS_PER_BAND);
          hidden = nums.length - MAX_CHIPS_PER_BAND;
        }
        html += '<div class="numbers-chips" role="list">';
        for (let i = 0; i < show.length; i++) {
          html += '<span class="numbers-chip" role="listitem">№' + esc(String(show[i])) + "</span>";
        }
        html += "</div>";
        if (hidden > 0) {
          html +=
            '<p class="numbers-band__trunc">Показаны первые ' +
            MAX_CHIPS_PER_BAND +
            " из " +
            nums.length +
            " — остальные тоже свободны.</p>";
        }
      }
      html += "</section>";
    }
    setBandsHtml(html);
  }, []);

  const loadData = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    setStatusLine("Загрузка…", "muted");
    try {
      const res = await fetch("/api/public/latest-raffle/free-numbers?compact=1", { cache: "no-store" });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(data.error || data.message || "Ошибка " + res.status));
      const r = data.raffle as Record<string, unknown> | null | undefined;
      currentRaffleId.current = data.raffle_id != null ? Number(data.raffle_id) : null;
      const freeNumbersRaw = Array.isArray(data.free_numbers) ? (data.free_numbers as number[]) : [];
      const freeNumbers = freeNumbersRaw.length ? freeNumbersRaw : expandRanges(data.free_ranges);
      if (!r || !data.ticket_count) {
        setTitle("Свободные номерки");
        setMeta("Сейчас нет действующей открытой акции на сайте.");
        renderBands(0, []);
        setStatusLine("Обновлено: " + new Date().toLocaleString("ru-RU"), "ok");
        return;
      }
      setTitle("Свободные номерки — " + String(r.title || "акция"));
      setMeta(
        "Акция №" +
          String(data.raffle_id) +
          " · всего номерков: " +
          String(data.ticket_count) +
          " · свободно: " +
          String(data.free_count != null ? data.free_count : freeNumbers.length),
      );
      renderBands(Number(data.ticket_count) || 0, freeNumbers);
      setStatusLine("Обновлено: " + new Date().toLocaleString("ru-RU"), "ok");
    } catch (e) {
      setStatusLine(String((e as Error).message || e), "err");
    } finally {
      inFlight.current = false;
      if (queued.current) {
        queued.current = false;
        void loadData();
      }
    }
  }, [renderBands, setStatusLine]);

  const scheduleRefetch = useCallback(() => {
    if (refetchDebounce.current) clearTimeout(refetchDebounce.current);
    refetchDebounce.current = setTimeout(() => {
      refetchDebounce.current = null;
      void loadData();
    }, 280);
  }, [loadData]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const host = typeof window !== "undefined" && (window as unknown as { __AB_WS_ORIGIN__?: string }).__AB_WS_ORIGIN__;
    const origin = (host || location.origin.replace(/^http/, "ws")).replace(/\/$/, "");
    function buildWsUrl() {
      return origin + "/ws?scope=public_raffle_feed";
    }
    function connectWs() {
      if (wsReconnect.current) {
        clearTimeout(wsReconnect.current);
        wsReconnect.current = null;
      }
      let ws: WebSocket;
      try {
        ws = new WebSocket(buildWsUrl());
      } catch {
        wsReconnect.current = setTimeout(connectWs, 4000);
        return;
      }
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        let msg: { type?: string; raffle_id?: number };
        try {
          msg = JSON.parse(String(ev.data || "{}"));
        } catch {
          return;
        }
        if (msg.type === "raffles_feed_updated") {
          scheduleRefetch();
          return;
        }
        if (msg.type === "raffle_grid_updated") {
          const rid = Number(msg.raffle_id);
          if (currentRaffleId.current != null && Number.isFinite(rid) && rid === currentRaffleId.current) {
            scheduleRefetch();
          }
        }
      };
      ws.onclose = () => {
        wsReconnect.current = setTimeout(connectWs, 3500);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
    }
    connectWs();
    return () => {
      if (wsReconnect.current) clearTimeout(wsReconnect.current);
      wsReconnect.current = null;
      detachWebSocket(wsRef.current);
      wsRef.current = null;
    };
  }, [scheduleRefetch]);

  return (
    <>
      <header className="numbers-top">
        <h1 id="numbers-page-title">{title}</h1>
        <p id="numbers-page-meta" className="numbers-meta">
          {meta}
        </p>
        <div className="numbers-nav">
          <Link href="/">На главную</Link>
          <Link href="/home">Личный кабинет</Link>
          <span id="numbers-status" className={"numbers-status" + (statusKind ? " numbers-status--" + statusKind : "")} aria-live="polite">
            {status}
          </span>
        </div>
      </header>
      <div id="numbers-bands" dangerouslySetInnerHTML={{ __html: bandsHtml }} />
    </>
  );
}
