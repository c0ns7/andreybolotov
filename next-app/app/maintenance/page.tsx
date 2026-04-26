import type { Metadata } from "next";
import "./maintenance.css";
import MaintenanceStatusClient from "../../components/ab/MaintenanceStatusClient";

export const metadata: Metadata = {
  title: "Технические работы — Андрей Болотов",
};

export default function MaintenancePage() {
  return (
    <div className="maintenance-page">
      <main className="maintenance-main">
        <div className="maintenance-card">
          <div className="maintenance-card__icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
          <h1 className="maintenance-card__title">Технические работы</h1>
          <p className="maintenance-card__text">
            Сайт временно недоступен. Мы уже всё чиним — зайдите чуть позже.
          </p>
          <MaintenanceStatusClient />
        </div>
      </main>
    </div>
  );
}
