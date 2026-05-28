export default function AuthModalsLegacy() {
  return (
    <>
      <div id="modal-register" className="modal-overlay" aria-hidden="true" role="dialog" aria-labelledby="reg-heading">
        <div className="modal">
          <div className="modal__top">
            <button type="button" className="modal__back" id="modal-reg-back" aria-label="Назад">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6"></path>
              </svg>
            </button>
            <h2 id="reg-heading" className="modal__top-title">Регистрация</h2>
            <button type="button" className="modal__close" id="modal-reg-close" aria-label="Закрыть">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          <div className="modal__body">
            <form id="form-register" noValidate>
              <p className="reg-steps-indicator" id="reg-steps-indicator">Шаг 1 из 3</p>

              <div className="reg-step is-active" data-reg-step="1">
                <div className="form-group">
                  <label htmlFor="phone-reg">Номер телефона</label>
                  <input className="input input--phone" type="tel" id="phone-reg" name="phone" inputMode="numeric" autoComplete="tel" placeholder="+7 (___) ___-__-__" />
                </div>
                <div className="form-group">
                  <label htmlFor="fio-reg">ФИО</label>
                  <input className="input" type="text" id="fio-reg" name="fio" autoComplete="name" placeholder="Иванов Иван Иванович" />
                </div>
                <div className="form-actions form-actions--split">
                  <button type="button" className="btn btn--primary" id="reg-step-next-1">Далее</button>
                </div>
              </div>

              <div className="reg-step" data-reg-step="2">
                <div className="form-group">
                  <label htmlFor="locality-reg">Населенный пункт</label>
                  <input className="input" type="text" id="locality-reg" name="locality" autoComplete="address-level2" placeholder="Город или посёлок" />
                </div>
                <div className="form-actions form-actions--split">
                  <button type="button" className="btn btn--ghost" id="reg-step-back-2">Назад</button>
                  <button type="button" className="btn btn--primary" id="reg-step-next-2">Далее</button>
                </div>
              </div>

              <div className="reg-step" data-reg-step="3">
                <div className="form-group">
                  <label htmlFor="pass-reg">Придумайте пароль</label>
                  <div className="input-wrap input-wrap--with-toggle">
                    <input className="input" type="password" id="pass-reg" name="password" autoComplete="new-password" />
                    <button type="button" className="toggle-pass" id="toggle-pass-reg" aria-label="Показать пароль" aria-pressed="false">
                      <span className="eye-open" aria-hidden="true">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"></path>
                          <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                      </span>
                      <span className="eye-closed" style={{ display: "none" }} aria-hidden="true">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"></path>
                          <path d="M1 1l22 22"></path>
                        </svg>
                      </span>
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="pass-reg2">Повторите пароль</label>
                  <div className="input-wrap input-wrap--with-toggle">
                    <input className="input" type="password" id="pass-reg2" name="password2" autoComplete="new-password" />
                    <button type="button" className="toggle-pass" id="toggle-pass-reg2" aria-label="Показать пароль" aria-pressed="false">
                      <span className="eye-open" aria-hidden="true">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"></path>
                          <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                      </span>
                      <span className="eye-closed" style={{ display: "none" }} aria-hidden="true">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"></path>
                          <path d="M1 1l22 22"></path>
                        </svg>
                      </span>
                    </button>
                  </div>
                </div>
                <div className="form-actions form-actions--split">
                  <button type="button" className="btn btn--ghost" id="reg-step-back-3">Назад</button>
                  <button type="submit" className="btn btn--primary">Зарегистрироваться</button>
                </div>
              </div>
              <p className="form-links">
                Уже есть аккаунт? <button type="button" id="link-login-from-reg">Войти</button>
              </p>
            </form>
          </div>
        </div>
      </div>

      <div id="modal-login" className="modal-overlay" aria-hidden="true" role="dialog" aria-labelledby="login-heading">
        <div className="modal">
          <div className="modal__top">
            <button type="button" className="modal__back" id="modal-login-back" aria-label="Назад">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6"></path>
              </svg>
            </button>
            <span></span>
            <button type="button" className="modal__close" id="modal-login-close" aria-label="Закрыть">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          <div className="modal__body">
            <h2 id="login-heading" className="modal__heading">Авторизация</h2>
            <form id="form-login" noValidate>
              <div className="form-group">
                <label htmlFor="phone-login">Номер телефона</label>
                <input className="input input--phone" type="tel" id="phone-login" name="phone" inputMode="numeric" autoComplete="tel" placeholder="+7 (___) ___-__-__" />
              </div>
              <div className="form-group">
                <label htmlFor="pass-login">Пароль</label>
                <div className="input-wrap input-wrap--with-toggle">
                  <input className="input" type="password" id="pass-login" name="password" autoComplete="current-password" />
                  <button type="button" className="toggle-pass" id="toggle-pass-login" aria-label="Показать пароль" aria-pressed="false">
                    <span className="eye-open" aria-hidden="true">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                    </span>
                    <span className="eye-closed" style={{ display: "none" }} aria-hidden="true">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"></path>
                        <path d="M1 1l22 22"></path>
                      </svg>
                    </span>
                  </button>
                </div>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn--primary">Войти</button>
              </div>
              <p className="form-links">
                <button type="button" id="link-forgot">Забыли пароль?</button>
                <span className="block">Нет аккаунта? <button type="button" id="link-to-register">Зарегистрируйтесь</button></span>
              </p>
            </form>
          </div>
        </div>
      </div>

      <div id="modal-forgot" className="modal-overlay" aria-hidden="true" role="dialog" aria-labelledby="forgot-heading">
        <div className="modal">
          <div className="modal__top">
            <button type="button" className="modal__back" id="modal-forgot-back" aria-label="Назад">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6"></path>
              </svg>
            </button>
            <h2 id="forgot-heading" className="modal__top-title">Сброс пароля</h2>
            <button type="button" className="modal__close" id="modal-forgot-close" aria-label="Закрыть">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          <div className="modal__body">
            <p className="modal__lead">Для сброса пароля обратитесь к администратору в личные сообщения в MAX.</p>
            <p className="modal__lead modal__lead--muted">Я пользуюсь мессенджером MAX. Присоединяйся!</p>
            <div className="form-actions">
              <a className="btn btn--primary" href="https://max.ru/u/f9LHodD0cOKSJihr4puAfiyfPGQJWImlRAdNuRhpYwI7qse5YaB625-1d3w" target="_blank" rel="noopener noreferrer">Написать в MAX</a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
