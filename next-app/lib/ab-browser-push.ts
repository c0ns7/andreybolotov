const lastShownAt = new Map<string, number>();

function freeTicketsCountLabelRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${n} свободных номерков`;
  if (mod10 === 1) return `${n} свободный номерок`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} свободных номерка`;
  return `${n} свободных номерков`;
}

export function formatRaffleFreeTicketsReminderPush(freeCount: number, raffleTitle?: string): {
  title: string;
  body: string;
} {
  const n = Math.max(0, Math.floor(Number(freeCount)));
  const title = String(raffleTitle || "").trim();
  const countLabel = freeTicketsCountLabelRu(n);
  if (title) {
    return {
      title: "Остались свободные номерки",
      body: `В акции «${title}» ${countLabel}. Успейте участвовать!`,
    };
  }
  return {
    title: "Остались свободные номерки",
    body: `В текущей акции ${countLabel}. Успейте участвовать!`,
  };
}

export function showAbBrowserNotification(
  title: string,
  body: string,
  tag: string,
  ttlMs = 40_000,
): boolean {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;
  const key = String(tag || "default").trim() || "default";
  const now = Date.now();
  const prev = lastShownAt.get(key) ?? 0;
  if (now - prev < ttlMs) return false;
  lastShownAt.set(key, now);
  try {
    const n = new Notification(title, { body, tag: key });
    window.setTimeout(() => n.close(), 9_000);
    return true;
  } catch {
    return false;
  }
}
