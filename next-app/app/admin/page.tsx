import type { Metadata } from "next";
import Script from "next/script";
import AdminMarkup from "./AdminMarkup";
import "../../../src/styles/admin-raffles.css";
import "../../../src/styles/admin-bonus-tables.css";
import "../../../src/styles/admin-prizes.css";
import "../../../src/styles/chat-action-cards.css";
import "./admin-shell.css";

export const metadata: Metadata = {
  title: "Админ-панель",
  description: "Панель администратора сайта.",
};

export default function AdminPage() {
  return (
    <>
      <AdminMarkup />
      <Script src="/static-proxy/js/site-timezone.js?v=20260603" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin.js?v=20260603" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin-dashboard.js?v=20260602" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin-users.js?v=20260529" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin-raffles.js?v=20260602" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin-bonus-tables.js?v=20260711b" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin-payments.js?v=20260518" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin-prizes.js?v=20260529" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin-settings.js?v=20260425" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin-music.js?v=20260531" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin-stats.js?v=20260505" strategy="afterInteractive" />
    </>
  );
}
