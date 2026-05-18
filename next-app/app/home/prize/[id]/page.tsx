import type { Metadata } from "next";
import PrizeClaimClient from "../../../../components/ab/prize/PrizeClaimClient";

export const metadata: Metadata = {
  title: "Получить приз",
  description: "Оформление получения приза",
};

export default function PrizeClaimPage() {
  return (
    <div className="app-shell app-shell--with-tabbar" id="app-shell">
      <main className="prize-claim-shell">
        <PrizeClaimClient />
      </main>
    </div>
  );
}

