import type { Metadata } from "next";
import BonusTableClient from "../../../../components/ab/BonusTableClient";

export const metadata: Metadata = {
  title: "Бонусная таблица",
  description: "Список участников бонусной таблицы акции.",
};

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function BonusTablePage({ params }: PageProps) {
  const { slug } = await params;
  return (
    <div className="app-shell app-shell--with-tabbar" id="app-shell">
      <BonusTableClient slug={slug} />
    </div>
  );
}
