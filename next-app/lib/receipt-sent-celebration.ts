const MODAL_ID = "modal-receipt-sent-success";
const CONFETTI_ID = "receipt-sent-confetti";
export const RECEIPT_SENT_SHARE_TEXT = "Я участвую в акциях у Андрея Болотова";

let confettiTimer: ReturnType<typeof setInterval> | null = null;
let onDismissCb: (() => void) | null = null;
let onShareCopiedCb: (() => void) | null = null;
let wired = false;

function openOverlay(el: HTMLElement) {
  el.classList.add("is-open");
  el.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeOverlay(el: HTMLElement) {
  el.classList.remove("is-open");
  el.setAttribute("aria-hidden", "true");
  if (!document.querySelector(".modal-overlay.is-open")) document.body.style.overflow = "";
}

function stopConfetti() {
  if (confettiTimer) {
    clearInterval(confettiTimer);
    confettiTimer = null;
  }
  const root = document.getElementById(CONFETTI_ID);
  if (root) root.replaceChildren();
}

function spawnConfettiPiece(root: HTMLElement) {
  const colors = ["#f43f5e", "#fbbf24", "#34d399", "#60a5fa", "#a78bfa", "#f472b6"];
  const el = document.createElement("span");
  el.className = "receipt-sent-confetti__piece";
  el.style.left = `${Math.random() * 100}%`;
  el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
  el.style.animationDuration = `${2.4 + Math.random() * 2.2}s`;
  el.style.animationDelay = `${Math.random() * 0.35}s`;
  const w = 5 + Math.floor(Math.random() * 6);
  const h = 8 + Math.floor(Math.random() * 8);
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.borderRadius = Math.random() > 0.5 ? "999px" : "2px";
  root.appendChild(el);
  window.setTimeout(() => el.remove(), 5200);
}

function startConfetti() {
  const root = document.getElementById(CONFETTI_ID);
  if (!root) return;
  stopConfetti();
  for (let i = 0; i < 36; i++) spawnConfettiPiece(root);
  confettiTimer = setInterval(() => {
    for (let i = 0; i < 4; i++) spawnConfettiPiece(root);
  }, 420);
}

function wireReceiptSentModalOnce() {
  if (wired) return;
  wired = true;
  const modal = document.getElementById(MODAL_ID);
  const shareBtn = document.getElementById("receipt-sent-share");
  const okBtn = document.getElementById("receipt-sent-ok");

  const dismiss = () => {
    stopConfetti();
    if (modal) closeOverlay(modal);
    const cb = onDismissCb;
    onDismissCb = null;
    cb?.();
  };

  okBtn?.addEventListener("click", dismiss);
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) dismiss();
  });
  shareBtn?.addEventListener("click", () => {
    void shareReceiptSentInvite().then((r) => {
      if (r === "copied") onShareCopiedCb?.();
    });
  });
}

export async function shareReceiptSentInvite(): Promise<"shared" | "copied" | "cancelled"> {
  const url = typeof window !== "undefined" ? window.location.origin : "";
  const payload = url ? `${RECEIPT_SENT_SHARE_TEXT}\n${url}` : RECEIPT_SENT_SHARE_TEXT;
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: "Акции Андрея Болотова",
        text: RECEIPT_SENT_SHARE_TEXT,
        url: url || undefined,
      });
      return "shared";
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return "cancelled";
    }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(payload);
    return "copied";
  }
  return "cancelled";
}

export function openReceiptSentSuccessModal(opts?: { onDismiss?: () => void; onShareCopied?: () => void }) {
  wireReceiptSentModalOnce();
  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;
  onDismissCb = opts?.onDismiss ?? null;
  onShareCopiedCb = opts?.onShareCopied ?? null;
  startConfetti();
  openOverlay(modal);
}

export function closeReceiptSentSuccessModal() {
  stopConfetti();
  const modal = document.getElementById(MODAL_ID);
  if (modal) closeOverlay(modal);
  onDismissCb = null;
}
