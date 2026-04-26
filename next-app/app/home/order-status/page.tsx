import type { Metadata } from "next";
import Link from "next/link";
import OrderStatusClient from "./OrderStatusClient";
import "./order-status.css";

export const metadata: Metadata = {
  title: "Статус заказа",
  description: "Проверка статуса заявки по ссылке из SMS или письма.",
};

export default function OrderStatusPage() {
  return (
    <div className="app-shell app-shell--simple" id="app-shell">
      <div className="order-status-page screen home-screen">
        <div className="order-status-page__inner home-inner">
          <header className="order-status-page__head">
            <Link href="/home" className="order-status-page__back" aria-label="На главную">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </Link>
            <h1 className="order-status-page__title">Статус заказа</h1>
          </header>
          <div id="order-status-root" className="order-status-root" role="status" aria-live="polite">
            <p className="order-status-loading">Загрузка…</p>
          </div>
        </div>
      </div>
      <OrderStatusClient />
    </div>
  );
}
