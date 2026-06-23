"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { abAuthHeaders } from "../../lib/ab-api";
import { loadAbSession } from "../../lib/ab-session";
import {
  isNetworkFetchError,
  postReceiptWithRetries,
  RECEIPT_NETWORK_MODAL_TEXT,
  RECEIPT_NETWORK_MODAL_TITLE,
  receiptUploadProgressLabel,
  uploadReceiptFile,
} from "../../lib/receipt-client";
import { useAbSession } from "./AbSessionContext";

const RESUME_PAYMENT_ORDER_KEY = "ab_resume_payment_order";

function formatRub(n: number) {
  return String(Math.max(0, Math.round(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export default function RaffleConfirmClient() {
  const router = useRouter();
  const { toast } = useAbSession();
  const [lead, setLead] = useState("");
  const [networkRetryOpen, setNetworkRetryOpen] = useState(false);
  const orderIdRef = useRef(0);
  const uploadPayloadRef = useRef<Record<string, unknown> | null>(null);
  const uploadInFlightRef = useRef(false);
  const uploadSeqRef = useRef(0);

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
      toast("Нажмите «Прикрепить чек» и выберите фото или PDF", "warning");
      return;
    }
    if (uploadInFlightRef.current) {
      toast("Дождитесь завершения загрузки файла (100%)", "warning");
      return;
    }
    const uploadData = uploadPayloadRef.current;
    if (!uploadData) {
      toast("Файл ещё загружается или загрузка не завершена.", "warning");
      return;
    }
    if (!oid) return;
    setNetworkRetryOpen(false);
    try {
      const res = await postReceiptWithRetries(oid, {
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
        setNetworkRetryOpen(true);
        return;
      }
      toast(String((e as Error).message || "Не получилось отправить чек"), "error");
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
    const fileBtn = document.getElementById("raffle-confirm-file-btn");
    const send = document.getElementById("raffle-confirm-send") as HTMLButtonElement | null;
    const progressWrap = document.getElementById("raffle-confirm-upload-progress");
    const progressFill = document.getElementById("raffle-confirm-upload-progress-fill");
    const progressText = document.getElementById("raffle-confirm-upload-progress-text");
    const setSendReady = (ready: boolean) => {
      if (!send) return;
      send.disabled = !ready;
      send.classList.toggle("raffle-confirm-submit--disabled", !ready);
      send.classList.toggle("raffle-confirm-submit--ready", ready);
    };
    const setProgress = (percent: number, text: string, visible = true) => {
      if (progressWrap) progressWrap.hidden = !visible;
      if (progressFill) progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
      if (progressText) progressText.textContent = text;
    };
    const onFile = () => {
      const f = file?.files?.[0];
      const seq = ++uploadSeqRef.current;
      const el = document.getElementById("raffle-confirm-file-name");
      if (el) el.textContent = f ? f.name : "";
      uploadPayloadRef.current = null;
      uploadInFlightRef.current = false;
      setSendReady(false);
      if (!f) {
        setProgress(0, "Загрузка: 0%", false);
        return;
      }
      uploadInFlightRef.current = true;
      setProgress(0, "Загрузка: 0%");
      void uploadReceiptFile(f, (state) => {
        if (seq !== uploadSeqRef.current) return;
        setProgress(state.percent, receiptUploadProgressLabel(state));
      })
        .then((payload) => {
          if (seq !== uploadSeqRef.current) return;
          uploadInFlightRef.current = false;
          uploadPayloadRef.current = payload;
          setProgress(100, "Загрузка: 100%");
          setSendReady(true);
        })
        .catch((e) => {
          if (seq !== uploadSeqRef.current) return;
          uploadInFlightRef.current = false;
          uploadPayloadRef.current = null;
          setProgress(0, "Загрузка: 0%", false);
          toast(String((e as Error).message || "Не удалось загрузить файл"), "error");
        });
    };
    setSendReady(false);
    setProgress(0, "Загрузка: 0%", false);
    const onFileBtn = () => {
      if (!file || uploadInFlightRef.current) return;
      try {
        file.click();
      } catch {
        /* ignore */
      }
    };
    back?.addEventListener("click", onBack);
    fileBtn?.addEventListener("click", onFileBtn);
    file?.addEventListener("change", onFile);
    send?.addEventListener("click", onSend);
    return () => {
      uploadSeqRef.current += 1;
      back?.removeEventListener("click", onBack);
      fileBtn?.removeEventListener("click", onFileBtn);
      file?.removeEventListener("change", onFile);
      send?.removeEventListener("click", onSend);
    };
  }, [onBack, onSend]);

  if (!networkRetryOpen) return null;
  return (
    <div className="raffle-confirm-network-sheet" role="alertdialog" aria-modal="true" aria-labelledby="raffle-confirm-net-title">
      <h2 id="raffle-confirm-net-title" className="raffle-confirm-network-sheet__title">
        {RECEIPT_NETWORK_MODAL_TITLE}
      </h2>
      <p className="raffle-confirm-network-sheet__text">{RECEIPT_NETWORK_MODAL_TEXT}</p>
      <div className="raffle-confirm-network-sheet__actions">
        <button type="button" className="btn btn--primary raffle-confirm-network-sheet__retry" onClick={() => void onSend()}>
          Повторить
        </button>
        <button type="button" className="btn btn--secondary raffle-confirm-network-sheet__dismiss" onClick={() => setNetworkRetryOpen(false)}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
