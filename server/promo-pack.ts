export type PromoPackKind = "5plus1" | "5plus2" | "10plus1" | "10plus2";

export type PromoPackLabel = "5+1" | "5+2" | "10+1" | "10+2";

export type RafflePromoFlags = {
  promo_5_plus_1_enabled?: number | boolean | null;
  promo_5_plus_2_enabled?: number | boolean | null;
  promo_10_plus_1_enabled?: number | boolean | null;
  promo_10_plus_2_enabled?: number | boolean | null;
};

export type PromoPackSpec = {
  kind: PromoPackKind;
  label: PromoPackLabel;
  baseCount: 5 | 10;
  bonusPerBase: 1 | 2;
};

const SPECS: Record<PromoPackKind, PromoPackSpec> = {
  "5plus1": { kind: "5plus1", label: "5+1", baseCount: 5, bonusPerBase: 1 },
  "5plus2": { kind: "5plus2", label: "5+2", baseCount: 5, bonusPerBase: 2 },
  "10plus1": { kind: "10plus1", label: "10+1", baseCount: 10, bonusPerBase: 1 },
  "10plus2": { kind: "10plus2", label: "10+2", baseCount: 10, bonusPerBase: 2 },
};

function flagOn(v: number | boolean | null | undefined): boolean {
  return Number(v) === 1 || v === true;
}

export function resolvePromoPackFromRaffle(raffle: RafflePromoFlags | null | undefined): PromoPackSpec | null {
  if (!raffle) return null;
  if (flagOn(raffle.promo_10_plus_2_enabled)) return SPECS["10plus2"];
  if (flagOn(raffle.promo_10_plus_1_enabled)) return SPECS["10plus1"];
  if (flagOn(raffle.promo_5_plus_2_enabled)) return SPECS["5plus2"];
  if (flagOn(raffle.promo_5_plus_1_enabled)) return SPECS["5plus1"];
  return null;
}

export function calcPromoGiftCount(paidCount: number, spec: PromoPackSpec): number {
  const paid = Math.max(0, Math.floor(Number(paidCount) || 0));
  if (paid < spec.baseCount) return 0;
  return Math.floor(paid / spec.baseCount) * spec.bonusPerBase;
}

export function isBonusPromoKind(kind: string): kind is PromoPackKind {
  return kind === "5plus1" || kind === "5plus2" || kind === "10plus1" || kind === "10plus2";
}

export const PROMO_PACK_KINDS: PromoPackKind[] = ["5plus1", "5plus2", "10plus1", "10plus2"];
