import { getLatestVisibleActiveRaffle } from "./db.js";
import { getRaffleFreeTicketsCount } from "./raffle-orders.js";
import { broadcastRaffleFreeTicketsReminder } from "./ws-chat.js";

/** Ниже этого порога push-напоминания об остатке номерков не отправляются. */
export const RAFFLE_FREE_TICKETS_PUSH_MIN_COUNT = 25;

/** Интервал рассылки напоминаний (30 минут). */
export const RAFFLE_FREE_TICKETS_PUSH_INTERVAL_MS = 30 * 60 * 1000;

let trackedRaffleId = 0;
let pushStoppedForCurrentRaffle = false;

export async function tickRaffleFreeTicketsPushReminders(): Promise<{
  sent: boolean;
  raffle_id: number | null;
  free_count: number | null;
  stopped: boolean;
}> {
  const raffle = await getLatestVisibleActiveRaffle();
  if (!raffle) {
    trackedRaffleId = 0;
    pushStoppedForCurrentRaffle = false;
    return { sent: false, raffle_id: null, free_count: null, stopped: false };
  }

  const rid = Math.floor(Number(raffle.id));
  if (!Number.isFinite(rid) || rid < 1) {
    return { sent: false, raffle_id: null, free_count: null, stopped: false };
  }

  if (rid !== trackedRaffleId) {
    trackedRaffleId = rid;
    pushStoppedForCurrentRaffle = false;
  }

  if (pushStoppedForCurrentRaffle) {
    return { sent: false, raffle_id: rid, free_count: null, stopped: true };
  }

  const freeCount = await getRaffleFreeTicketsCount(rid);
  if (freeCount < RAFFLE_FREE_TICKETS_PUSH_MIN_COUNT) {
    pushStoppedForCurrentRaffle = true;
    return { sent: false, raffle_id: rid, free_count: freeCount, stopped: true };
  }

  broadcastRaffleFreeTicketsReminder(rid, freeCount, String(raffle.title || "").trim());
  return { sent: true, raffle_id: rid, free_count: freeCount, stopped: false };
}

export function startRaffleFreeTicketsPushInterval(): void {
  void tickRaffleFreeTicketsPushReminders();
  setInterval(() => void tickRaffleFreeTicketsPushReminders(), RAFFLE_FREE_TICKETS_PUSH_INTERVAL_MS);
}
