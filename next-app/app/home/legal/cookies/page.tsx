import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Политика использования файлов cookie",
  description: "Порядок использования файлов cookie и локальных технологий хранения данных.",
};

export default function CookiesPolicyPage() {
  return (
    <div className="app-shell" id="app-shell">
      <div className="home-inner legal-page">
        <header className="legal-page__head">
          <Link href="/home/settings" className="legal-page__back" aria-label="Назад в настройки">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <h1 className="legal-page__title">Политика использования файлов cookie</h1>
        </header>
        <article className="legal-page__card">
          <section className="legal-page__section">
            <h2>1. Общие положения</h2>
            <p>
              Настоящая политика определяет порядок использования файлов cookie и аналогичных технологий хранения данных на сайте andreybolotov.ru.
            </p>
            <p>
              Использование Сервиса означает согласие пользователя с настоящей политикой в части технически необходимых файлов cookie и локальных данных.
            </p>
          </section>

          <section className="legal-page__section">
            <h2>2. Какие технологии применяются</h2>
            <ul>
              <li>cookie для служебной парной метки сессии в legacy-части интерфейса;</li>
              <li>localStorage для хранения токена авторизации и пользовательских настроек;</li>
              <li>sessionStorage для временных флагов и восстановления пользовательских действий в рамках текущего сеанса.</li>
            </ul>
          </section>

          <section className="legal-page__section">
            <h2>3. Цели использования</h2>
            <ul>
              <li>обеспечение работы авторизации и личного кабинета;</li>
              <li>сохранение настроек оформления и доступности;</li>
              <li>поддержание корректной работы уведомлений и отдельных экранов сервиса;</li>
              <li>повышение стабильности и безопасности пользовательской сессии.</li>
            </ul>
          </section>

          <section className="legal-page__section">
            <h2>4. Управление cookie и локальными данными</h2>
            <p>
              Пользователь может ограничить или отключить cookie в настройках браузера, а также очистить localStorage/sessionStorage вручную. При этом часть
              функций личного кабинета может работать некорректно или быть недоступной до повторной авторизации.
            </p>
          </section>

          <section className="legal-page__section">
            <h2>5. Изменения политики</h2>
            <p>
              Оператор вправе обновлять настоящую политику. Актуальная редакция публикуется в Сервисе и действует с момента публикации.
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
