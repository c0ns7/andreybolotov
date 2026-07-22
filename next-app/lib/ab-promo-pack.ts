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

export function detectPromoPackKind(
  raffle: (RafflePromoFlags & { promo_pack?: string | null; promo_pack_kind?: string | null }) | null | undefined,
): PromoPackKind | null {
  if (!raffle) return null;
  const kindField = String(raffle.promo_pack_kind ?? "")
    .trim()
    .toLowerCase();
  if (kindField === "10plus1" || kindField === "10plus2" || kindField === "5plus1" || kindField === "5plus2") {
    return kindField;
  }
  const pack = String(raffle.promo_pack ?? "")
    .trim()
    .toLowerCase();
  if (pack === "10plus1" || pack === "10plus2" || pack === "5plus1" || pack === "5plus2") {
    return pack;
  }
  if (flagOn(raffle.promo_10_plus_1_enabled)) return "10plus1";
  if (flagOn(raffle.promo_10_plus_2_enabled)) return "10plus2";
  if (flagOn(raffle.promo_5_plus_1_enabled)) return "5plus1";
  if (flagOn(raffle.promo_5_plus_2_enabled)) return "5plus2";
  return null;
}

export function resolvePromoPackFromRaffle(raffle: RafflePromoFlags | null | undefined): PromoPackSpec | null {
  const kind = detectPromoPackKind(raffle);
  return kind ? SPECS[kind] : null;
}

export function calcPromoGiftCount(paidCount: number, spec: PromoPackSpec): number {
  const paid = Math.max(0, Math.floor(Number(paidCount) || 0));
  if (paid < spec.baseCount) return 0;
  return Math.floor(paid / spec.baseCount) * spec.bonusPerBase;
}
