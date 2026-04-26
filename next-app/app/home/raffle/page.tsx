import { Suspense } from "react";
import RafflePurchaseClient from "../../../components/ab/RafflePurchaseClient";
import RafflePurchaseLayoutMarkup from "./RafflePurchaseLayoutMarkup";

export default function HomeRafflePage() {
  return (
    <>
      <RafflePurchaseLayoutMarkup />
      <Suspense fallback={null}>
        <RafflePurchaseClient />
      </Suspense>
    </>
  );
}
