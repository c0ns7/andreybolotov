import type { Metadata } from "next";
import { Suspense } from "react";
import BlogShellClient from "../../../components/ab/blog/BlogShellClient";

export const metadata: Metadata = {
  title: "Блог",
  description: "Новости, победители акций и благотворительность",
};

export default function HomeBlogPage() {
  return (
    <div className="app-shell app-shell--with-tabbar" id="app-shell">
      <div className="blog-page screen home-screen">
        <div className="blog-page__inner home-inner">
          <Suspense fallback={<p className="blog-loading">Загрузка…</p>}>
            <BlogShellClient />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
