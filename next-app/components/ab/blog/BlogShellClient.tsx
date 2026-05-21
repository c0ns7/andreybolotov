"use client";

import { useMemo } from "react";
import AppBottomNav from "../AppBottomNav";
import { useSiteFlags } from "../../../lib/use-site-flags";
import { useAbSession } from "../AbSessionContext";
import BlogPageClient from "./BlogPageClient";

export default function BlogShellClient() {
  const { session, authVerified, toast } = useAbSession();
  const { blog_enabled: blogEnabled } = useSiteFlags();
  const letter = useMemo(() => {
    const n = session?.name?.trim()?.[0] || session?.phone?.replace(/\D/g, "")?.slice(-1) || "К";
    return n.toUpperCase();
  }, [session]);
  const show = !!(session?.token && session?.phone);
  return (
    <>
      <BlogPageClient />
      <AppBottomNav
        show={show}
        showBlog
        blogEnabled={blogEnabled}
        profileLetter={letter}
        authVerified={authVerified}
        onChat={() => toast("Откройте «Главная», чтобы написать в чат поддержки.", "info")}
        onChatBlocked={() => toast("Войдите, чтобы пользоваться чатом", "warning")}
      />
    </>
  );
}
