import type { Metadata } from "next";
import Script from "next/script";
import AdminMarkup from "./AdminMarkup";
import "../../../src/styles/admin-raffles.css";
import "../../../src/styles/admin-prizes.css";
import "../../../src/styles/chat-action-cards.css";
import "./admin-shell.css";

export const metadata: Metadata = {
  title: "Админка — поддержка",
  description: "Панель администратора: обращения пользователей.",
};

export default function AdminPage() {
  return (
    <>
      <AdminMarkup />
      <Script src="/static-proxy/js/site-timezone.js?v=20260530" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin.js?v=20260526" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin-raffles.js?v=20260601" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin-payments.js?v=20260518" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin-prizes.js?v=20260529" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin-users.js?v=20260518" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin-settings.js?v=20260425" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin-music.js?v=20260531" strategy="afterInteractive" />
      <Script src="/static-proxy/js/admin-stats.js?v=20260505" strategy="afterInteractive" />
    </>
  );
}
