export type PromoPackKind = "3plus1" | "3plus2" | "5plus1" | "5plus2" | "10plus1" | "10plus2";

export type PromoPackLabel = "3+1" | "3+2" | "5+1" | "5+2" | "10+1" | "10+2";

export type RafflePromoFlags = {
  promo_3_plus_1_enabled?: number | boolean | null;
  promo_3_plus_2_enabled?: number | boolean | null;
  promo_5_plus_1_enabled?: number | boolean | null;
  promo_5_plus_2_enabled?: number | boolean | null;
  promo_10_plus_1_enabled?: number | boolean | null;
  promo_10_plus_2_enabled?: number | boolean | null;
};

export type PromoPackSpec = {
  kind: PromoPackKind;
  label: PromoPackLabel;
  baseCount: 3 | 5 | 10;
  bonusPerBase: 1 | 2;
};

const SPECS: Record<PromoPackKind, PromoPackSpec> = {
  "3plus1": { kind: "3plus1", label: "3+1", baseCount: 3, bonusPerBase: 1 },
  "3plus2": { kind: "3plus2", label: "3+2", baseCount: 3, bonusPerBase: 2 },
  "5plus1": { kind: "5plus1", label: "5+1", baseCount: 5, bonusPerBase: 1 },
  "5plus2": { kind: "5plus2", label: "5+2", baseCount: 5, bonusPerBase: 2 },
  "10plus1": { kind: "10plus1", label: "10+1", baseCount: 10, bonusPerBase: 1 },
  "10plus2": { kind: "10plus2", label: "10+2", baseCount: 10, bonusPerBase: 2 },
};

function flagOn(v: number | boolean | null | undefined): boolean {
  return Number(v) === 1 || v === true;
}

function isKnownPromoPackKind(v: string): v is PromoPackKind {
  return (
    v === "3plus1" ||
    v === "3plus2" ||
    v === "5plus1" ||
    v === "5plus2" ||
    v === "10plus1" ||
    v === "10plus2"
  );
}

export function detectPromoPackKind(
  raffle: (RafflePromoFlags & { promo_pack?: string | null; promo_pack_kind?: string | null }) | null | undefined,
): PromoPackKind | null {
  if (!raffle) return null;
  const kindField = String(raffle.promo_pack_kind ?? "")
    .trim()
    .toLowerCase();
  if (isKnownPromoPackKind(kindField)) return kindField;
  const pack = String(raffle.promo_pack ?? "")
    .trim()
    .toLowerCase();
  if (isKnownPromoPackKind(pack)) return pack;
  if (flagOn(raffle.promo_10_plus_1_enabled)) return "10plus1";
  if (flagOn(raffle.promo_10_plus_2_enabled)) return "10plus2";
  if (flagOn(raffle.promo_5_plus_1_enabled)) return "5plus1";
  if (flagOn(raffle.promo_5_plus_2_enabled)) return "5plus2";
  if (flagOn(raffle.promo_3_plus_1_enabled)) return "3plus1";
  if (flagOn(raffle.promo_3_plus_2_enabled)) return "3plus2";
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

export function isBonusPromoKind(kind: string): kind is PromoPackKind {
  return isKnownPromoPackKind(String(kind || "").trim().toLowerCase());
}

export const PROMO_PACK_KINDS: PromoPackKind[] = [
  "3plus1",
  "3plus2",
  "5plus1",
  "5plus2",
  "10plus1",
  "10plus2",
];
