"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { abApiJson, AbApiError } from "../../lib/ab-api";
import { formatRuPhoneInput, isValidRuMobilePhone, phoneToNormalized } from "../../lib/ab-phone";
import { useAbSession } from "./AbSessionContext";

type AuthResp = {
  token: string;
  user: {
    id?: number;
    phone: string;
    name: string;
    email?: string;
    locality?: string;
    role?: string;
    blocked?: boolean;
  };
};

function sessionFromAuth(data: AuthResp) {
  const uid = Number(data.user.id);
  return {
    token: data.token,
    id: Number.isFinite(uid) && uid > 0 ? Math.floor(uid) : undefined,
    phone: data.user.phone,
    name: data.user.name,
    email: data.user.email || "",
    locality: data.user.locality || "",
    role: data.user.role || "user",
    blocked: !!data.user.blocked,
  };
}

export default function LandingClient() {
  const router = useRouter();
  const { setSessionFromLogin, toast, session, authVerified, authCheckInFlight } = useAbSession();
  const [modal, setModal] = useState<"none" | "auth" | "forgot">("none");
  const [authStep, setAuthStep] = useState<"phone" | "login" | "register">("phone");
  const [authCheckingPhone, setAuthCheckingPhone] = useState(false);
  const [checkedPhone, setCheckedPhone] = useState("");

  const [regPhone, setRegPhone] = useState("");
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regLocality, setRegLocality] = useState("");
  const [regPass, setRegPass] = useState("");
  const [regPass2, setRegPass2] = useState("");
  const [showRegPass, setShowRegPass] = useState(false);
  const [showRegPass2, setShowRegPass2] = useState(false);

  const [loginPhone, setLoginPhone] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [showLoginPass, setShowLoginPass] = useState(false);

  const [forgotEmail, setForgotEmail] = useState("");

  const showAuthedUi = !!(session?.token && session?.phone && (authVerified || authCheckInFlight));

  const beginAuthFlow = useCallback(() => {
    setModal("auth");
    setAuthStep("phone");
    setAuthCheckingPhone(false);
    setCheckedPhone("");
    setLoginPhone("");
    setLoginPass("");
    setRegPhone("");
    setRegName("");
    setRegEmail("");
    setRegLocality("");
    setRegPass("");
    setRegPass2("");
  }, []);

  useEffect(() => {
    const welcome = document.getElementById("welcome-splash");
    if (!welcome) return;
    welcome.classList.toggle("welcome-splash--dismissed", showAuthedUi);
    welcome.setAttribute("aria-hidden", showAuthedUi ? "true" : "false");
    const feed = document.getElementById("welcome-feed");
    if (feed) feed.setAttribute("aria-hidden", showAuthedUi ? "false" : "true");
  }, [showAuthedUi]);

  useEffect(() => {
    if (authVerified && session?.token && session?.phone) {
      try {
        sessionStorage.setItem("ab_home_reload_once_v1", "1");
      } catch {
        /* ignore */
      }
      router.replace("/home");
    }
  }, [authVerified, session, router]);

  useEffect(() => {
    if (modal !== "auth" || authStep !== "phone") return;
    const phone = phoneToNormalized(loginPhone);
    if (phone.length !== 11 || !isValidRuMobilePhone(phone)) return;
    if (authCheckingPhone || checkedPhone === phone) return;
    setAuthCheckingPhone(true);
    setCheckedPhone(phone);
    void abApiJson<{ exists: boolean; blocked?: boolean; name?: string }>("/api/auth/check-phone", {
      method: "POST",
      body: JSON.stringify({ phone }),
    })
      .then((resp) => {
        if (resp.blocked) {
          toast("Аккаунт заблокирован. Обратитесь в поддержку.", "error");
          return;
        }
        if (resp.exists) {
          setAuthStep("login");
          return;
        }
        setRegPhone(formatRuPhoneInput(loginPhone));
        setAuthStep("register");
      })
      .catch((err) => {
        const msg = err instanceof AbApiError ? err.message : "Ошибка проверки номера";
        toast(msg, "error");
      })
      .finally(() => setAuthCheckingPhone(false));
  }, [modal, authStep, loginPhone, authCheckingPhone, checkedPhone, toast]);

  const onRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const phone = phoneToNormalized(regPhone || loginPhone);
    if (phone.length !== 11 || !isValidRuMobilePhone(phone)) {
      toast("Нужен мобильный номер России (+7 9XX …)", "warning");
      return;
    }
    if (!regName.trim()) {
      toast("Укажите ФИО", "warning");
      return;
    }
    if (regEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail.trim())) {
      toast("Укажите корректный email или очистите поле", "warning");
      return;
    }
    if (!regLocality.trim()) {
      toast("Укажите населенный пункт", "warning");
      return;
    }
    if (regPass.length < 6) {
      toast("Пароль не короче 6 символов", "warning");
      return;
    }
    if (regPass !== regPass2) {
      toast("Пароли не совпадают", "warning");
      return;
    }
    try {
      const data = await abApiJson<AuthResp>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          phone,
          name: regName.trim(),
          email: regEmail.trim() || "",
          locality: regLocality.trim(),
          password: regPass,
        }),
      });
      setSessionFromLogin(sessionFromAuth(data));
      toast("Добро пожаловать, " + String(data.user.name).split(" ")[0] + "!", "success");
      setModal("none");
    } catch (err) {
      const msg = err instanceof AbApiError ? err.message : "Ошибка регистрации";
      toast(msg, "error");
    }
  };

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const phone = phoneToNormalized(loginPhone);
    if (phone.length !== 11 || !isValidRuMobilePhone(phone)) {
      toast("Нужен мобильный номер России (+7 9XX …)", "warning");
      return;
    }
    if (!loginPass) {
      toast("Введите пароль", "warning");
      return;
    }
    try {
      const data = await abApiJson<AuthResp>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ phone, password: loginPass }),
      });
      setSessionFromLogin(sessionFromAuth(data));
      toast("С возвращением!", "success");
      setModal("none");
    } catch (err) {
      const msg = err instanceof AbApiError ? err.message : "Ошибка входа";
      toast(msg, "error");
    }
  };

  const onForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = forgotEmail.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast("Введите email", "warning");
      return;
    }
    try {
      await abApiJson("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) });
      toast("Если email найден, мы отправим ссылку", "info");
      setAuthStep("login");
      setModal("auth");
    } catch (err) {
      const msg = err instanceof AbApiError ? err.message : "Ошибка";
      toast(msg, "error");
    }
  };

  return (
    <>
      <div id="screen-welcome" className="screen home-screen">
        <div id="welcome-splash" className="welcome-splash" role="dialog" aria-modal="true" aria-labelledby="welcome-splash-title">
          <div className="welcome-splash__inner">
            <div className="welcome-splash__mascot-wrap">
              <img className="welcome-splash__mascot" src="/mascot/mascot_wave.svg" alt="Степь" width={176} height={176} />
            </div>
            <div className="welcome-splash__text">
              <h1 id="welcome-splash-title" className="welcome-splash__title">
                Привет! Я Степь! 🐾
              </h1>
              <p className="welcome-splash__lead">
                Добро пожаловать к <strong>Андрею Болотову</strong>
              </p>
              <p className="welcome-splash__sub">Участвуйте, выигрывайте и помогайте!</p>
            </div>
            <div className="welcome-splash__actions">
              <button type="button" className="welcome-splash__btn welcome-splash__btn--primary" onClick={beginAuthFlow}>
                Войти
              </button>
            </div>
          </div>
        </div>
        <div className="home-inner welcome-feed welcome-feed--guest-only" id="welcome-feed" aria-hidden="true" />
      </div>

      <div
        id="modal-auth"
        className={"modal-overlay" + (modal === "auth" ? " is-open" : "")}
        aria-hidden={modal !== "auth"}
        role="dialog"
        onClick={(e) => e.target === e.currentTarget && setModal("none")}
      >
        <div className="modal">
          <div className="modal__top">
            <button
              type="button"
              className="modal__back"
              aria-label="Назад"
              onClick={() => {
                if (authStep === "phone") {
                  setModal("none");
                  return;
                }
                setAuthStep("phone");
                // Не триггерим мгновенную повторную проверку того же номера после "назад".
                setCheckedPhone(phoneToNormalized(loginPhone));
                setAuthCheckingPhone(false);
                setLoginPass("");
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <h2 className="modal__top-title">{authStep === "phone" ? "Вход" : authStep === "login" ? "Введите пароль" : "Регистрация"}</h2>
            <button type="button" className="modal__close" aria-label="Закрыть" onClick={() => setModal("none")}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="modal__body">
            {authStep === "phone" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                }}
                noValidate
              >
                <div className="form-group">
                  <label htmlFor="phone-auth-flow">Номер телефона</label>
                  <div className="input-wrap input-wrap--with-icon">
                    <span className="auth-input-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.63 2.62a2 2 0 0 1-.45 2.11L8 9.89a16 16 0 0 0 6.11 6.11l1.44-1.29a2 2 0 0 1 2.11-.45c.84.3 1.72.51 2.62.63A2 2 0 0 1 22 16.92z" />
                      </svg>
                    </span>
                    <input
                      className="input input--phone"
                      id="phone-auth-flow"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="+7 (___) ___-__-__"
                      value={loginPhone}
                      onChange={(e) => {
                        setCheckedPhone("");
                        setLoginPhone(formatRuPhoneInput(e.target.value));
                      }}
                    />
                  </div>
                </div>
                <p className="form-links">{authCheckingPhone ? "Проверяем номер..." : "После ввода последней цифры продолжим автоматически"}</p>
              </form>
            ) : authStep === "login" ? (
              <form onSubmit={onLogin} noValidate>
                <div className="form-group">
                  <label htmlFor="phone-login-native">Номер телефона</label>
                  <input className="input input--readonly" id="phone-login-native" type="text" value={formatRuPhoneInput(loginPhone)} readOnly />
                </div>
                <div className="form-group">
                  <label htmlFor="pass-login-native">Пароль</label>
                  <div className="input-wrap input-wrap--with-icon input-wrap--with-toggle">
                    <span className="auth-input-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>
                    <input className="input" id="pass-login-native" type={showLoginPass ? "text" : "password"} autoComplete="current-password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} />
                    <button type="button" className="toggle-pass" aria-label={showLoginPass ? "Скрыть пароль" : "Показать пароль"} onClick={() => setShowLoginPass((v) => !v)}>
                      {showLoginPass ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="m3 3 18 18" />
                          <path d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58" />
                          <path d="M9.88 5.09A10.94 10.94 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-2.16 3.19" />
                          <path d="M6.61 6.61C4.62 7.88 3.29 9.91 2 12c0 0 3 7 10 7a9.76 9.76 0 0 0 5.39-1.61" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <div className="form-actions">
                  <button type="submit" className="btn btn--primary">
                    Войти
                  </button>
                </div>
                <p className="form-links">
                  <button type="button" onClick={() => setModal("forgot")}>
                    Забыли пароль?
                  </button>
                </p>
              </form>
            ) : (
              <form onSubmit={onRegister} noValidate>
                <div className="form-group">
                  <label htmlFor="phone-reg-native">Номер телефона</label>
                  <input className="input input--readonly" id="phone-reg-native" type="text" value={formatRuPhoneInput(regPhone || loginPhone)} readOnly />
                </div>
                <div className="form-group">
                  <label htmlFor="fio-reg-native">ФИО</label>
                  <div className="input-wrap input-wrap--with-icon">
                    <span className="auth-input-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21a8 8 0 0 0-16 0" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    </span>
                    <input className="input" id="fio-reg-native" type="text" autoComplete="name" value={regName} onChange={(e) => setRegName(e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="email-reg-native">Email (необязательно)</label>
                  <div className="input-wrap input-wrap--with-icon">
                    <span className="auth-input-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <path d="m3 7 9 6 9-6" />
                      </svg>
                    </span>
                    <input className="input" id="email-reg-native" type="email" autoComplete="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="locality-reg-native">Населенный пункт</label>
                  <div className="input-wrap input-wrap--with-icon">
                    <span className="auth-input-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 10.5 12 3l9 7.5" />
                        <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
                        <path d="M9 20v-6h6v6" />
                      </svg>
                    </span>
                    <input className="input" id="locality-reg-native" type="text" autoComplete="address-level2" value={regLocality} onChange={(e) => setRegLocality(e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="pass-reg-native">Пароль</label>
                  <div className="input-wrap input-wrap--with-icon input-wrap--with-toggle">
                    <span className="auth-input-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>
                    <input className="input" id="pass-reg-native" type={showRegPass ? "text" : "password"} autoComplete="new-password" value={regPass} onChange={(e) => setRegPass(e.target.value)} />
                    <button type="button" className="toggle-pass" aria-label={showRegPass ? "Скрыть пароль" : "Показать пароль"} onClick={() => setShowRegPass((v) => !v)}>
                      {showRegPass ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="m3 3 18 18" />
                          <path d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58" />
                          <path d="M9.88 5.09A10.94 10.94 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-2.16 3.19" />
                          <path d="M6.61 6.61C4.62 7.88 3.29 9.91 2 12c0 0 3 7 10 7a9.76 9.76 0 0 0 5.39-1.61" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="pass-reg2-native">Повторите пароль</label>
                  <div className="input-wrap input-wrap--with-icon input-wrap--with-toggle">
                    <span className="auth-input-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>
                    <input className="input" id="pass-reg2-native" type={showRegPass2 ? "text" : "password"} autoComplete="new-password" value={regPass2} onChange={(e) => setRegPass2(e.target.value)} />
                    <button type="button" className="toggle-pass" aria-label={showRegPass2 ? "Скрыть пароль" : "Показать пароль"} onClick={() => setShowRegPass2((v) => !v)}>
                      {showRegPass2 ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="m3 3 18 18" />
                          <path d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58" />
                          <path d="M9.88 5.09A10.94 10.94 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-2.16 3.19" />
                          <path d="M6.61 6.61C4.62 7.88 3.29 9.91 2 12c0 0 3 7 10 7a9.76 9.76 0 0 0 5.39-1.61" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <div className="form-actions">
                  <button type="submit" className="btn btn--primary">
                    Зарегистрироваться
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      <div
        id="modal-forgot"
        className={"modal-overlay" + (modal === "forgot" ? " is-open" : "")}
        aria-hidden={modal !== "forgot"}
        role="dialog"
        onClick={(e) => e.target === e.currentTarget && setModal("none")}
      >
        <div className="modal">
          <div className="modal__top">
            <button
              type="button"
              className="modal__back"
              aria-label="Назад"
              onClick={() => {
                setAuthStep("login");
                setModal("auth");
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <h2 className="modal__top-title">Восстановление</h2>
            <button type="button" className="modal__close" aria-label="Закрыть" onClick={() => setModal("none")}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="modal__body">
            <form onSubmit={onForgot} noValidate>
              <div className="form-group">
                <label htmlFor="email-forgot-native">Email</label>
                <div className="input-wrap input-wrap--with-icon">
                  <span className="auth-input-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="m3 7 9 6 9-6" />
                    </svg>
                  </span>
                  <input className="input" id="email-forgot-native" type="email" autoComplete="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} />
                </div>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn--primary">
                  Отправить ссылку
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
