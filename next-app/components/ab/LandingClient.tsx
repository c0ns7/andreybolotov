"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { abApiJson, AbApiError } from "../../lib/ab-api";
import { formatRuPhoneInput, isValidRuMobilePhone, phoneToNormalized } from "../../lib/ab-phone";
import {
  AB_ADMIN_MAX_LINK_LABEL,
  AB_ADMIN_MAX_URL,
  AB_PASSWORD_RESET_ADMIN_TEXT,
} from "../../lib/ab-support-links";
import { useAbSession } from "./AbSessionContext";
import { normalizePersonName, validatePersonName } from "../../lib/person-name";

type AuthResp = {
  token: string;
  user: {
    id?: number;
    phone: string;
    name: string;
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
  const [regLocality, setRegLocality] = useState("");
  const [regPass, setRegPass] = useState("");
  const [regPass2, setRegPass2] = useState("");
  const [showRegPass, setShowRegPass] = useState(false);
  const [showRegPass2, setShowRegPass2] = useState(false);
  const [regLegalAccepted, setRegLegalAccepted] = useState(true);
  const [legalModal, setLegalModal] = useState<"none" | "pd" | "privacy">("none");

  const [loginPhone, setLoginPhone] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [showLoginPass, setShowLoginPass] = useState(false);

  // Не скрываем заставку, пока сессия не подтверждена — иначе кнопка «Войти» пропадает при проверке токена.
  const showAuthedUi = !!(session?.token && session?.phone && authVerified);

  const beginAuthFlow = useCallback(() => {
    setModal("auth");
    setAuthStep("phone");
    setAuthCheckingPhone(false);
    setCheckedPhone("");
    setLoginPhone("");
    setLoginPass("");
    setRegPhone("");
    setRegName("");
    setRegLocality("");
    setRegPass("");
    setRegPass2("");
    setRegLegalAccepted(true);
    setLegalModal("none");
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
    const nameCheck = validatePersonName(regName);
    if (nameCheck.ok === false) {
      toast(nameCheck.error, "warning");
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
    if (!regLegalAccepted) {
      toast("Подтвердите согласие с документами", "warning");
      return;
    }
    try {
      const data = await abApiJson<AuthResp>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          phone,
          name: nameCheck.name,
          locality: regLocality.trim(),
          password: regPass,
          consent_personal_data: true,
          consent_privacy_policy: true,
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

  return (
    <>
      <div id="screen-welcome" className="screen home-screen">
        <div id="welcome-splash" className="welcome-splash" role="dialog" aria-modal="true" aria-labelledby="welcome-splash-title">
          <div className="welcome-splash__inner">
            <div className="welcome-splash__mascot-wrap">
              <img
                className="welcome-splash__mascot"
                src="/logoandreybolotov.png"
                alt="Логотип andreybolotov.ru"
                width={176}
                height={176}
              />
            </div>
            <div className="welcome-splash__text">
              <h1 id="welcome-splash-title" className="welcome-splash__title">
                Привет! Рады вам! 🐾
              </h1>
              <p className="welcome-splash__lead">
                Добро пожаловать к <strong>Андрею Болотову</strong>
              </p>
              <p className="welcome-splash__sub">Участвуйте, выигрывайте и помогайте!</p>
            </div>
            <div className="welcome-splash__actions">
              <button
                type="button"
                id="btn-splash-login"
                className="welcome-splash__btn welcome-splash__btn--primary"
                onClick={beginAuthFlow}
              >
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
                {authCheckingPhone ? (
                  <p className="form-links">Проверяем номер...</p>
                ) : null}
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
                    <input
                      className="input"
                      id="fio-reg-native"
                      type="text"
                      autoComplete="name"
                      placeholder="Иванов Иван Иванович"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      onBlur={() => {
                        const n = normalizePersonName(regName);
                        if (n) setRegName(n);
                      }}
                    />
                  </div>
                  <p className="form-hint">Полностью на русском: фамилия и имя обязательны, без инициалов (не «И. И.»)</p>
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
                <label className="consent-check consent-switch">
                  <input type="checkbox" checked={regLegalAccepted} onChange={(e) => setRegLegalAccepted(e.target.checked)} />
                  <span className="consent-switch__slider" aria-hidden="true" />
                  <span>
                    Я принимаю{" "}
                    <button type="button" className="consent-check__link" onClick={() => setLegalModal("pd")}>
                      согласие на обработку персональных данных
                    </button>{" "}
                    и{" "}
                    <button type="button" className="consent-check__link" onClick={() => setLegalModal("privacy")}>
                      политику конфиденциальности
                    </button>
                    .
                  </span>
                </label>
                <div className="form-actions">
                  <button type="submit" className="btn btn--primary" disabled={!regLegalAccepted}>
                    Зарегистрироваться
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      <div
        className={"modal-overlay legal-modal-overlay" + (legalModal !== "none" ? " is-open" : "")}
        aria-hidden={legalModal === "none"}
        role="dialog"
        aria-modal="true"
        onClick={(e) => {
          if (e.target === e.currentTarget) setLegalModal("none");
        }}
      >
        <div className="modal legal-modal">
          <div className="legal-modal__head">
            <h3 className="legal-modal__title">
              {legalModal === "pd" ? "Согласие на обработку персональных данных" : "Политика конфиденциальности"}
            </h3>
            <button type="button" className="legal-modal__close" aria-label="Закрыть" onClick={() => setLegalModal("none")}>
              ✕
            </button>
          </div>
          <div className="legal-modal__body custom-scrollbar">
            {legalModal === "pd" ? (
              <>
                <section className="legal-modal__section">
                  <h4>1. Предмет согласия</h4>
                  <p>Я, субъект персональных данных, даю оператору сайта andreybolotov.ru согласие на обработку персональных данных в целях использования личного кабинета.</p>
                </section>
                <section className="legal-modal__section">
                  <h4>2. Какие данные обрабатываются</h4>
                  <ul>
                    <li>номер телефона;</li>
                    <li>фамилия, имя, отчество (при наличии);</li>
                    <li>населённый пункт;</li>
                    <li>электронная почта (если указана);</li>
                    <li>технические данные сессии и использования сервиса.</li>
                  </ul>
                </section>
                <section className="legal-modal__section">
                  <h4>3. Цели и действия с данными</h4>
                  <p>Цели обработки: регистрация, авторизация, поддержка пользователя, обеспечение безопасности сервиса, исполнение требований законодательства РФ.</p>
                  <p>Оператор вправе осуществлять: сбор, запись, систематизацию, хранение, уточнение, использование, передачу уполномоченным обработчикам, блокирование, удаление и уничтожение данных.</p>
                </section>
                <section className="legal-modal__section">
                  <h4>4. Срок и отзыв согласия</h4>
                  <p>Согласие действует до отзыва. Отзыв может быть направлен через поддержку. После отзыва обработка прекращается в срок и порядке, установленных законодательством РФ.</p>
                </section>
              </>
            ) : (
              <>
                <section className="legal-modal__section">
                  <h4>1. Общие положения</h4>
                  <p>Оператор обрабатывает персональные данные в соответствии с Федеральным законом РФ № 152-ФЗ «О персональных данных» и иными применимыми нормами права РФ (редакция, действующая в 2026 году).</p>
                </section>
                <section className="legal-modal__section">
                  <h4>2. Принципы обработки</h4>
                  <ul>
                    <li>обрабатываются только необходимые данные;</li>
                    <li>обработка ведётся для законных и определённых целей;</li>
                    <li>обеспечивается актуальность и безопасность данных.</li>
                  </ul>
                </section>
                <section className="legal-modal__section">
                  <h4>3. Защита и передача</h4>
                  <p>Доступ к данным предоставляется только уполномоченным лицам и техническим обработчикам в объёме, необходимом для работы сервиса.</p>
                  <p>Оператор применяет правовые, организационные и технические меры защиты от неправомерного доступа, изменения, распространения и утраты данных.</p>
                </section>
                <section className="legal-modal__section">
                  <h4>4. Права пользователя</h4>
                  <p>Пользователь вправе запросить сведения об обработке данных, их уточнение, ограничение обработки или удаление в случаях, предусмотренных законодательством РФ.</p>
                </section>
              </>
            )}
          </div>
          <div className="legal-modal__actions">
            <button type="button" className="btn btn--primary" onClick={() => setLegalModal("none")}>
              Понятно
            </button>
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
            <h2 className="modal__top-title">Сброс пароля</h2>
            <button type="button" className="modal__close" aria-label="Закрыть" onClick={() => setModal("none")}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="modal__body">
            <p className="modal__lead">{AB_PASSWORD_RESET_ADMIN_TEXT}</p>
            <p className="modal__lead modal__lead--muted">
              Я пользуюсь мессенджером MAX. Присоединяйся!
            </p>
            <div className="form-actions">
              <a
                className="btn btn--primary"
                href={AB_ADMIN_MAX_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {AB_ADMIN_MAX_LINK_LABEL}
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
