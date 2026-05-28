import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Политика уведомлений",
  description: "Порядок отправки push, email и внутренних уведомлений пользователям.",
};

export default function NotificationsPolicyPage() {
  return (
    <div className="app-shell" id="app-shell">
      <div className="home-inner legal-page">
        <header className="legal-page__head">
          <Link href="/home/settings" className="legal-page__back" aria-label="Назад в настройки">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <h1 className="legal-page__title">Политика уведомлений</h1>
        </header>
        <article className="legal-page__card">
          <section className="legal-page__section">
            <h2>1. Виды уведомлений</h2>
            <p>В Сервисе используются следующие каналы уведомлений:</p>
            <ul>
              <li>внутренние уведомления в интерфейсе личного кабинета;</li>
              <li>browser push-уведомления (при разрешении пользователя в браузере);</li>
              <li>email-уведомления (если пользователь указал адрес электронной почты).</li>
            </ul>
          </section>

          <section className="legal-page__section">
            <h2>2. Основания и цели уведомлений</h2>
            <ul>
              <li>информирование о важных изменениях в состоянии заявок и номерков;</li>
              <li>сообщения поддержки и сервисные статусы;</li>
              <li>технические уведомления, необходимые для безопасной и корректной работы аккаунта.</li>
            </ul>
          </section>

          <section className="legal-page__section">
            <h2>3. Push-уведомления</h2>
            <p>
              Push-уведомления отправляются только после разрешения, предоставленного пользователем в браузере. Пользователь может в любой момент отключить
              такие уведомления в настройках браузера.
            </p>
          </section>

          <section className="legal-page__section">
            <h2>4. Email-уведомления</h2>
            <p>
              Email-уведомления включают сервисные письма, связанные с работой личного кабинета и взаимодействием с поддержкой. В доступных случаях
              пользователь может управлять соответствующими настройками в разделе «Настройки».
            </p>
          </section>

          <section className="legal-page__section">
            <h2>5. Ограничения и ответственность</h2>
            <p>
              Доставка уведомлений зависит от работы внешних систем (браузер, почтовый провайдер, сеть связи) и не всегда может быть гарантирована оператором
              в конкретный момент времени.
            </p>
          </section>

          <section className="legal-page__section">
            <h2>6. Обновление политики</h2>
            <p>
              Оператор вправе изменять настоящую политику. Новая редакция размещается в Сервисе и применяется с момента публикации.
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
