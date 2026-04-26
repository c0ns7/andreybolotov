"use client";

export default function GlobalError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ru">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 480 }}>
        <h1 style={{ fontSize: "1.25rem", marginBottom: 8 }}>Что-то пошло не так</h1>
        <p style={{ color: "#64748b", marginBottom: 16 }}>
          Попробуйте нажать кнопку ниже или обновите страницу.
        </p>
        <button type="button" onClick={() => reset()}>
          Попробовать снова
        </button>
      </body>
    </html>
  );
}
