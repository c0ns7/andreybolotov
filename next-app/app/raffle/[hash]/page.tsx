import { Suspense } from "react";
import RafflePurchaseClient from "../../../components/ab/RafflePurchaseClient";
import RafflePurchaseLayoutMarkup from "../../home/raffle/RafflePurchaseLayoutMarkup";

type Props = {
  params: Promise<{ hash: string }>;
};

export default async function RaffleHashPage({ params }: Props) {
  const p = await params;
  const hash = String(p?.hash || "").trim();
  return (
    <>
      <RafflePurchaseLayoutMarkup />
      <Suspense fallback={null}>
        <RafflePurchaseClient raffleHash={hash} />
      </Suspense>
    </>
  );
}
