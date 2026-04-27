import type { Metadata } from "next";
import HomeTableClient from "../../../components/ab/HomeTableClient";

export const metadata: Metadata = {
  title: "Таблица номерков",
  description: "Таблица ваших номерков с поиском по номеру и телефону.",
};

export default function HomeTablePage() {
  return (
    <div className="app-shell app-shell--with-tabbar" id="app-shell">
      <HomeTableClient />
    </div>
  );
}
