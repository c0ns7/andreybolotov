import type { Metadata } from "next";
import NumbersPageClient from "../../components/ab/NumbersPageClient";
import "./numbers.css";

export const metadata: Metadata = {
  title: "Свободные номерки — andreybolotov.ru",
  description: "Свободные номерки по текущей акции: обновление в реальном времени.",
};

export default function NumbersPage() {
  return (
    <div className="numbers-body">
      <div id="numbers-page" className="numbers-page">
        <NumbersPageClient />
      </div>
    </div>
  );
}
