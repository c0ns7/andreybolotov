import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
    ],
    sitemap: "https://andreybolotov.ru/sitemap.xml",
    host: "https://andreybolotov.ru",
  };
}
