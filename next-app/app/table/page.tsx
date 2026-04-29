import type { Metadata } from "next";
import PublicTableClient from "../../components/ab/PublicTableClient";

export const metadata: Metadata = {
  title: "Публичная таблица номерков",
  description: "Открытая таблица номерков с поиском по телефону и диапазонам.",
};

export default function PublicTablePage() {
  return (
    <div className="app-shell app-shell--table-public" id="app-shell">
      <PublicTableClient />
    </div>
  );
}
