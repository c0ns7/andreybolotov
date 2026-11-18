import type { AbMyTicketsResponse } from "./ab-my-tickets-cache";
import type { AbParticipationHistoryPayload } from "./ab-participation-history-cache";

function countConfirmedInMyTickets(data: AbMyTicketsResponse | null | undefined): number {
  const groups = Array.isArray(data?.confirmed) ? data!.confirmed! : [];
  let n = 0;
  for (const g of groups) {
    n += Array.isArray(g?.numbers) ? g.numbers!.length : 0;
  }
  return n;
}

export function hasEverConfirmedTickets(
  tickets: AbMyTicketsResponse | null | undefined,
  history: AbParticipationHistoryPayload | null | undefined,
): boolean {
  if (countConfirmedInMyTickets(tickets) > 0) return true;
  const raffles = Array.isArray(history?.raffles) ? history!.raffles! : [];
  for (const row of raffles) {
    const nums = row?.numbers;
    if (nums) {
      const buckets = [
        nums.confirmed,
        nums.bonus_confirmed,
        nums.bonus_3plus1_confirmed,
        nums.bonus_3plus2_confirmed,
        nums.bonus_5plus1_confirmed,
        nums.bonus_5plus2_confirmed,
        nums.bonus_10plus1_confirmed,
        nums.bonus_10plus2_confirmed,
      ];
      for (const arr of buckets) {
        if (Array.isArray(arr) && arr.length > 0) return true;
      }
    }
    const timeline = Array.isArray(row?.timeline) ? row.timeline! : [];
    for (const ev of timeline) {
      if (String(ev?.status || "") === "confirmed" && Array.isArray(ev?.numbers) && ev.numbers!.length > 0) {
        return true;
      }
    }
  }
  return false;
}
