"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { abAuthHeaders } from "../../lib/ab-api";
import { loadAbSession } from "../../lib/ab-session";
import { useAbSession } from "./AbSessionContext";

const RESUME_PAYMENT_ORDER_KEY = "ab_resume_payment_order";

function isNetworkFetchError(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message || "").toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("networkerror");
}

async function postReceiptWithSingleRetry(oid: number, payload: Record<string, unknown>) {
  const submit = () =>
    fetch("/api/raffles/orders/" + String(oid) + "/receipt", {
      method: "POST",
      headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  try {
    return await submit();
  } catch (e) {
    if (!isNetworkFetchError(e)) throw e;
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    return await submit();
  }
}

function formatRub(n: number) {
  return String(Math.max(0, Math.round(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export default function RaffleConfirmClient() {
  const router = useRouter();
  const { toast } = useAbSession();
  const [lead, setLead] = useState("");
  const orderIdRef = useRef(0);

  const onBack = useCallback(() => {
    const oid = orderIdRef.current;
    if (Number.isFinite(oid) && oid > 0) {
      try {
        sessionStorage.setItem(RESUME_PAYMENT_ORDER_KEY, String(oid));
      } catch {
        /* ignore */
      }
    }
    router.push("/home");
  }, [router]);

  const onSend = useCallback(async () => {
    const input = document.getElementById("raffle-confirm-file") as HTMLInputElement | null;
    const file = input?.files?.[0];
    const oid = orderIdRef.current;
    if (!file) {
      toast("Выберите файл чека", "warning");
      return;
    }
    if (!oid) return;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/raffles/receipt-upload", { method: "POST", headers: abAuthHeaders(), body: fd });
      const uploadData = (await up.json().catch(() => ({}))) as Record<string, unknown>;
      if (!up.ok) throw new Error(String(uploadData.error || "Ошибка загрузки"));
      const res = await postReceiptWithSingleRetry(oid, {
        url: uploadData.url,
        name: uploadData.name,
        mime: uploadData.mime,
        sha256: uploadData.sha256,
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(data.error || "Ошибка"));
      const ord = data.order as { receipt_review_eta_hint?: string } | undefined;
      const etaC = ord?.receipt_review_eta_hint != null ? String(ord.receipt_review_eta_hint) : "";
      try {
        sessionStorage.setItem(
          "ab_pending_toast",
          JSON.stringify({
            message: etaC ? "Чек принят на проверку. " + etaC : "Ожидайте проверки от администратора",
            type: "neutral",
          }),
        );
      } catch {
        /* ignore */
      }
      router.push("/home");
    } catch (e) {
      if (isNetworkFetchError(e)) {
        toast("Сеть нестабильна. Чек не отправлен, попробуйте еще раз.", "warning");
        return;
      }
      toast(String((e as Error).message || "Ошибка"), "error");
    }
  }, [router, toast]);

  useEffect(() => {
    const s = loadAbSession();
    if (!s?.token) {
      router.replace("/home");
      return;
    }
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      params = new URLSearchParams();
    }
    const oid = Number(params.get("orderId"));
    if (!Number.isFinite(oid) || oid < 1) {
      router.replace("/home");
      return;
    }
    orderIdRef.current = oid;
    fetch("/api/raffles/orders/" + String(oid), { cache: "no-store", headers: abAuthHeaders() })
      .then((res) => res.json().then((d) => ({ ok: res.ok, d })))
      .then((x) => {
        if (!x.ok || !x.d?.order) throw new Error(x.d?.error || "Ошибка");
        const o = x.d.order as { status?: string; amount_rub?: number };
        if (String(o.status) !== "reserved") {
          router.replace("/home");
          return;
        }
        const nums = (x.d.numbers as number[]) || [];
        const r = x.d.raffle as { title?: string } | null;
        setLead(
          String(r?.title || "") +
            " · " +
            nums.map((n) => "№ " + String(n)).join(", ") +
            " · к оплате " +
            formatRub(Number(o.amount_rub ?? 0)) +
            " ₽",
        );
      })
      .catch(() => router.replace("/home"));
  }, [router]);

  useEffect(() => {
    const leadEl = document.getElementById("raffle-confirm-lead");
    if (leadEl) leadEl.textContent = lead;
  }, [lead]);

  useEffect(() => {
    const back = document.getElementById("raffle-confirm-back");
    const file = document.getElementById("raffle-confirm-file") as HTMLInputElement | null;
    const send = document.getElementById("raffle-confirm-send");
    const onFile = () => {
      const f = file?.files?.[0];
      const el = document.getElementById("raffle-confirm-file-name");
      if (el) el.textContent = f ? f.name : "";
    };
    back?.addEventListener("click", onBack);
    file?.addEventListener("change", onFile);
    send?.addEventListener("click", onSend);
    return () => {
      back?.removeEventListener("click", onBack);
      file?.removeEventListener("change", onFile);
      send?.removeEventListener("click", onSend);
    };
  }, [onBack, onSend]);

  return null;
}
