import Link from "next/link";

export default function NotFound() {
  return (
    <main className="nf-page">
      <section className="nf-card" aria-labelledby="nf-title">
        <div className="nf-badge" aria-hidden="true">
          404
        </div>
        <div className="nf-icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
        </div>
        <h1 id="nf-title" className="nf-title">
          Страница не найдена
        </h1>
        <p className="nf-sub">
          Возможно, ссылка устарела или страница была перемещена.
        </p>
        <div className="nf-actions">
          <Link href="/home" className="nf-btn nf-btn--primary">
            На главную
          </Link>
          <Link href="/" className="nf-btn nf-btn--ghost">
            На вход
          </Link>
        </div>
      </section>
    </main>
  );
}
