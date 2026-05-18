import type { Metadata } from "next";
import BlogShellClient from "../../../components/ab/blog/BlogShellClient";

export const metadata: Metadata = {
  title: "Блог",
  description: "Новости, победители акций и благотворительность",
};

export default function HomeBlogPage() {
  return (
    <div className="app-shell app-shell--with-tabbar" id="app-shell">
      <main className="blog-shell">
        <BlogShellClient />
      </main>
    </div>
  );
}
