"use client";

import { useMemo } from "react";
import AppBottomNav from "./AppBottomNav";
import { useAbSession } from "./AbSessionContext";

export default function SettingsDockClient() {
  const { session, authVerified, toast } = useAbSession();
  const letter = useMemo(() => {
    const n = session?.name?.trim()?.[0] || session?.phone?.replace(/\D/g, "")?.slice(-1) || "К";
    return n.toUpperCase();
  }, [session]);
  const show = !!(session?.token && session?.phone);
  return (
    <AppBottomNav
      show={show}
      profileLetter={letter}
      authVerified={authVerified}
      onChat={() => toast("Откройте «Главная», чтобы написать в чат поддержки.", "info")}
      onChatBlocked={() => toast("Войдите, чтобы пользоваться чатом", "warning")}
    />
  );
}
