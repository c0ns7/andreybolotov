type MigrationNoticeProps = {
  title: string;
  text: string;
};

export default function MigrationNotice({ title, text }: MigrationNoticeProps) {
  return (
    <main style={{ padding: "24px", maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 10 }}>{title}</h1>
      <p style={{ marginBottom: 12 }}>{text}</p>
      <p style={{ opacity: 0.8 }}>
        Эта страница уже находится в Next.js роутинге. Дальше в нее поэтапно переносится UI/логика из legacy Astro.
      </p>
    </main>
  );
}
