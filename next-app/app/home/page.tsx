import type { Metadata } from "next";
import HomeAppClient from "../../components/ab/HomeAppClient";

export const metadata: Metadata = {
  title: "Главная",
  description: "Лента акций и участие в акциях.",
};

export default function HomePage() {
  return (
    <div className="app-shell app-shell--with-tabbar" id="app-shell">
      <HomeAppClient />
    </div>
  );
}
