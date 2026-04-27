import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "andreybolotov.ru",
    short_name: "andreybolotov",
    description: "Платформа акций: номерки, участие, история и личный кабинет.",
    start_url: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#2563eb",
    lang: "ru",
    icons: [
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/logo-ab.svg",
        sizes: "160x160",
        type: "image/svg+xml",
      },
    ],
  };
}
