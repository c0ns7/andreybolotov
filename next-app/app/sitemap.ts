import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://andreybolotov.ru";
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/home`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/home/chat`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/home/settings`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${base}/home/legal/personal-data`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/home/legal/privacy`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/home/legal/cookies`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/home/legal/notifications`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/home/legal/offer`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/home/table`, lastModified: now, changeFrequency: "hourly", priority: 0.8 },
    { url: `${base}/home/raffle`, lastModified: now, changeFrequency: "hourly", priority: 0.8 },
  ];
}
