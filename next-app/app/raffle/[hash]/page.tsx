import { Suspense } from "react";
import RafflePurchaseClient from "../../../components/ab/RafflePurchaseClient";
import { raffleHashFromCdnSafe } from "../../../lib/ab-cdn-safe-token";
import RafflePurchaseLayoutMarkup from "../../home/raffle/RafflePurchaseLayoutMarkup";

type Props = {
  params: Promise<{ hash: string }>;
};

export default async function RaffleHashPage({ params }: Props) {
  const p = await params;
  let raw = String(p?.hash || "").trim();
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* keep */
  }
  const hash = raffleHashFromCdnSafe(raw);
  return (
    <>
      <RafflePurchaseLayoutMarkup />
      <Suspense fallback={null}>
        <RafflePurchaseClient raffleHash={hash} />
      </Suspense>
    </>
  );
}
