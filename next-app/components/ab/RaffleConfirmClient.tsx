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
  uploadReceiptFile,
  validateReceiptFileForUpload,
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
  const uploadInFlightRef = useRef(false);
  const previewObjectUrlRef = useRef<string | null>(null);

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
    const send = document.getElementById("raffle-confirm-send") as HTMLButtonElement | null;
    if (!file) {
      toast("Нажмите «Прикрепить чек» и выберите фото или PDF", "warning");
      return;
    }
    if (uploadInFlightRef.current) return;
    const bad = validateReceiptFileForUpload(file);
    if (bad) {
      toast(bad, "error");
      return;
    }
    if (!oid) return;
    setNetworkRetryOpen(false);
    uploadInFlightRef.current = true;
    if (send) {
      send.disabled = true;
      send.textContent = "Отправка…";
    }
    try {
      const uploadData = await uploadReceiptFile(file);
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
    } finally {
      uploadInFlightRef.current = false;
      if (send) {
        send.disabled = !file;
        send.textContent = "Отправить чек";
        send.classList.toggle("raffle-confirm-submit--disabled", !file);
        send.classList.toggle("raffle-confirm-submit--ready", !!file);
      }
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
        if (!x.ok || !x.d?.order) throw new Error(String(x.d?.error || "Ошибка"));
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
    const preview = document.getElementById("raffle-confirm-file-preview");
    const img = document.getElementById("raffle-confirm-file-preview-img") as HTMLImageElement | null;
    const pdf = document.getElementById("raffle-confirm-file-preview-pdf");
    const pdfName = document.getElementById("raffle-confirm-file-preview-pdf-name");
    const caption = document.getElementById("raffle-confirm-file-name");
    const removeBtn = document.getElementById("raffle-confirm-file-remove");

    const revokePreviewUrl = () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
    };

    const setSendReady = (ready: boolean) => {
      if (!send || uploadInFlightRef.current) return;
      send.disabled = !ready;
      send.classList.toggle("raffle-confirm-submit--disabled", !ready);
      send.classList.toggle("raffle-confirm-submit--ready", ready);
    };

    const setPreviewUi = (f: File | null) => {
      revokePreviewUrl();
      if (!f) {
        if (fileBtn) fileBtn.hidden = false;
        if (preview) preview.hidden = true;
        if (img) {
          img.hidden = true;
          img.removeAttribute("src");
        }
        if (pdf) pdf.hidden = true;
        if (caption) caption.textContent = "";
        return;
      }
      if (fileBtn) fileBtn.hidden = true;
      if (preview) preview.hidden = false;
      if (caption) caption.textContent = f.name;
      const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      if (isPdf) {
        if (img) {
          img.hidden = true;
          img.removeAttribute("src");
        }
        if (pdf) pdf.hidden = false;
        if (pdfName) pdfName.textContent = f.name;
      } else {
        if (pdf) pdf.hidden = true;
        if (img) {
          previewObjectUrlRef.current = URL.createObjectURL(f);
          img.src = previewObjectUrlRef.current;
          img.hidden = false;
        }
      }
    };

    const clearFile = () => {
      if (file) file.value = "";
      setPreviewUi(null);
      setSendReady(false);
    };

    const onFile = () => {
      const f = file?.files?.[0];
      if (!f) {
        clearFile();
        return;
      }
      const bad = validateReceiptFileForUpload(f);
      if (bad) {
        toast(bad, "error");
        clearFile();
        return;
      }
      setPreviewUi(f);
      setSendReady(true);
    };

    setSendReady(false);
    const onFileBtn = () => {
      if (!file || uploadInFlightRef.current) return;
      try {
        file.click();
      } catch {
        /* ignore */
      }
    };
    const onRemove = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      clearFile();
    };

    back?.addEventListener("click", onBack);
    fileBtn?.addEventListener("click", onFileBtn);
    file?.addEventListener("change", onFile);
    removeBtn?.addEventListener("click", onRemove);
    send?.addEventListener("click", onSend);
    return () => {
      back?.removeEventListener("click", onBack);
      fileBtn?.removeEventListener("click", onFileBtn);
      file?.removeEventListener("change", onFile);
      removeBtn?.removeEventListener("click", onRemove);
      send?.removeEventListener("click", onSend);
      revokePreviewUrl();
    };
  }, [onBack, onSend, toast]);

  if (!networkRetryOpen) return null;
  return (
    <div className="raffle-confirm-network-sheet" role="alertdialog" aria-modal="true" aria-labelledby="raffle-confirm-net-title">
      <div className="raffle-confirm-network-sheet__panel">
        <h2 id="raffle-confirm-net-title">{RECEIPT_NETWORK_MODAL_TITLE}</h2>
        <p>{RECEIPT_NETWORK_MODAL_TEXT}</p>
        <button type="button" className="btn btn--primary" onClick={() => void onSend()}>
          Повторить
        </button>
      </div>
    </div>
  );
}
