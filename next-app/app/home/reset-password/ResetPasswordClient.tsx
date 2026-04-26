"use client";

import { useEffect } from "react";

const BTN_DEFAULT =
  '<svg class="reset-pw-submit__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>Сохранить пароль';

export default function ResetPasswordClient() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const form = document.getElementById("form-reset-pw");
    const errBox = document.getElementById("reset-pw-error");
    const errText = document.getElementById("reset-pw-error-text");
    const doneEl = document.getElementById("reset-pw-done");
    const lead = document.getElementById("reset-pw-lead");
    const btn = document.getElementById("reset-pw-btn") as HTMLButtonElement | null;
    const stateForm = document.getElementById("reset-pw-state-form");
    const stateBad = document.getElementById("reset-pw-state-bad");

    function showErr(msg: string) {
      if (!errBox || !errText) return;
      errText.textContent = msg || "";
      errBox.hidden = !msg;
    }

    if (!token || token.length < 64) {
      if (stateForm) stateForm.hidden = true;
      if (stateBad) stateBad.hidden = false;
      return;
    }

    if (!form) return;

    const onSubmit = (e: Event) => {
      e.preventDefault();
      showErr("");
      const p1 = document.getElementById("reset-pw-pass") as HTMLInputElement | null;
      const p2 = document.getElementById("reset-pw-pass2") as HTMLInputElement | null;
      const a = p1 ? String(p1.value) : "";
      const b = p2 ? String(p2.value) : "";
      if (a.length < 6) {
        showErr("Пароль не короче 6 символов.");
        return;
      }
      if (a !== b) {
        showErr("Пароли не совпадают.");
        return;
      }
      if (btn) {
        btn.disabled = true;
        btn.innerHTML =
          '<span class="reset-pw-spinner" aria-hidden="true"></span><span>Сохранение…</span>';
      }
      fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: a }),
      })
        .then((res) =>
          res.json().then((d) => {
            return { ok: res.ok, d: d as { error?: string } };
          }),
        )
        .then((x) => {
          if (!x.ok) throw new Error(x.d && x.d.error ? String(x.d.error) : "Ошибка");
          if (stateForm) stateForm.hidden = true;
          if (lead) lead.hidden = true;
          if (doneEl) doneEl.hidden = false;
        })
        .catch((err: Error) => {
          showErr(err.message || "Ошибка");
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = BTN_DEFAULT;
          }
        });
    };

    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, []);

  return null;
}
