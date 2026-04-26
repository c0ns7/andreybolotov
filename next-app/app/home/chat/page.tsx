import type { Metadata } from "next";
import ChatPageClient from "../../../components/ab/ChatPageClient";

export const metadata: Metadata = {
  title: "Чат поддержки",
  description: "Общение с поддержкой",
};

export default function HomeChatPage() {
  return (
    <div className="app-shell" id="app-shell">
      <ChatPageClient />
    </div>
  );
}
