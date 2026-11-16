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
                <div className="form-group">
                  <label htmlFor="captcha-reg">Код с картинки</label>
                  <div className="reg-captcha">
                    <div className="reg-captcha__image-wrap">
                      <img className="reg-captcha__image" id="captcha-reg-image" alt="Капча" width={180} height={56} />
                    </div>
                    <button type="button" className="btn btn--ghost reg-captcha__refresh" id="captcha-reg-refresh" aria-label="Обновить капчу">
                      Обновить
                    </button>
                  </div>
                  <input
                    className="input"
                    type="text"
                    id="captcha-reg"
                    name="captcha"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="Введите символы с картинки"
                  />
                  <input type="hidden" id="captcha-reg-token" value="" />
                  <p className="form-hint">Защита от автоматической регистрации</p>
                </div>
                <label className="consent-check consent-check--legacy consent-switch">
                  <input type="checkbox" id="reg-legal-accept" defaultChecked />
                  <span className="consent-switch__slider" aria-hidden="true" />
                  <span>
                    Я принимаю{" "}
                    <button type="button" className="consent-check__link" id="reg-open-pd-consent">
                      согласие на обработку персональных данных
                    </button>{" "}
                    и{" "}
                    <button type="button" className="consent-check__link" id="reg-open-privacy-policy">
                      политику конфиденциальности
                    </button>
                    .
                  </span>
                </label>
                <label className="consent-check consent-check--legacy consent-switch">
                  <input type="checkbox" id="reg-legal-docs-accept" defaultChecked />
                  <span className="consent-switch__slider" aria-hidden="true" />
                  <span>
                    Я ознакомлен(а) с{" "}
                    <a className="consent-check__link" href="/home/legal/cookies" target="_blank" rel="noopener noreferrer">
                      политикой cookie
                    </a>
                    ,{" "}
                    <a className="consent-check__link" href="/home/legal/notifications" target="_blank" rel="noopener noreferrer">
                      политикой уведомлений
                    </a>{" "}
                    и{" "}
                    <a className="consent-check__link" href="/home/legal/offer" target="_blank" rel="noopener noreferrer">
                      публичной офертой проекта
                    </a>
                    .
                  </span>
                </label>
                <div className="form-actions form-actions--split">
                  <button type="button" className="btn btn--ghost" id="reg-step-back-3">Назад</button>
                  <button type="submit" className="btn btn--primary" id="reg-submit-btn">Зарегистрироваться</button>
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
        <div className="modal forgot-password-modal">
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
          <div className="modal__body forgot-password-modal__body">
            <div className="forgot-password-modal__icon" aria-hidden="true">
              <img src="https://maxicons.ru/icons/MAX.svg" alt="" width={40} height={40} />
            </div>
            <p className="forgot-password-modal__lead">
              Сброс пароля через сайт недоступен. Напишите администратору в MAX — поможем восстановить доступ.
            </p>
            <div className="forgot-password-modal__hint">
              <p className="forgot-password-modal__hint-title">В сообщении укажите:</p>
              <ul className="forgot-password-modal__list">
                <li>номер телефона</li>
                <li>ФИО</li>
                <li>населённый пункт</li>
              </ul>
            </div>
            <a
              id="forgot-password-max-link"
              className="btn btn--primary forgot-password-modal__cta"
              href="https://max.ru/u/f9LHodD0cOKSJihr4puAfiyfPGQJWImlRAdNuRhpYwI7qse5YaB625-1d3w"
              target="_blank"
              rel="noopener noreferrer"
            >
              Написать в MAX
            </a>
          </div>
        </div>
      </div>

      <div id="modal-legal-pd" className="modal-overlay legal-modal-overlay" aria-hidden="true" role="dialog" aria-labelledby="legal-pd-title">
        <div className="modal legal-modal">
          <div className="legal-modal__head">
            <h3 id="legal-pd-title" className="legal-modal__title">Согласие на обработку персональных данных</h3>
            <button type="button" className="legal-modal__close" id="modal-legal-pd-close" aria-label="Закрыть">
              ✕
            </button>
          </div>
          <div className="legal-modal__body custom-scrollbar">
            <section className="legal-modal__section">
              <h4>1. Предмет согласия</h4>
              <p>Я даю согласие оператору сайта andreybolotov.ru на обработку персональных данных для использования личного кабинета.</p>
            </section>
            <section className="legal-modal__section">
              <h4>2. Какие данные обрабатываются</h4>
              <ul>
                <li>номер телефона;</li>
                <li>фамилия, имя, отчество (при наличии);</li>
                <li>населённый пункт;</li>
                <li>электронная почта (если указана);</li>
                <li>технические данные сессии.</li>
              </ul>
            </section>
            <section className="legal-modal__section">
              <h4>3. Цели обработки</h4>
              <p>Регистрация, авторизация, поддержка пользователя, обеспечение безопасности сервиса и соблюдение требований законодательства РФ.</p>
            </section>
            <section className="legal-modal__section">
              <h4>4. Срок и отзыв согласия</h4>
              <p>Согласие действует до отзыва. Отзыв возможен через поддержку. После отзыва обработка прекращается в установленном законом порядке.</p>
            </section>
          </div>
        </div>
      </div>

      <div id="modal-legal-privacy" className="modal-overlay legal-modal-overlay" aria-hidden="true" role="dialog" aria-labelledby="legal-privacy-title">
        <div className="modal legal-modal">
          <div className="legal-modal__head">
            <h3 id="legal-privacy-title" className="legal-modal__title">Политика конфиденциальности</h3>
            <button type="button" className="legal-modal__close" id="modal-legal-privacy-close" aria-label="Закрыть">
              ✕
            </button>
          </div>
          <div className="legal-modal__body custom-scrollbar">
            <section className="legal-modal__section">
              <h4>1. Общие положения</h4>
              <p>Оператор обрабатывает персональные данные в соответствии с ФЗ-152 «О персональных данных» и действующим законодательством Российской Федерации.</p>
            </section>
            <section className="legal-modal__section">
              <h4>2. Принципы обработки</h4>
              <ul>
                <li>обрабатываются только необходимые данные;</li>
                <li>обработка ведётся для законных и определённых целей;</li>
                <li>обеспечивается защита и актуальность данных.</li>
              </ul>
            </section>
            <section className="legal-modal__section">
              <h4>3. Меры защиты</h4>
              <p>Оператор применяет организационные и технические меры для защиты данных от неправомерного доступа, изменения, распространения и утраты.</p>
            </section>
            <section className="legal-modal__section">
              <h4>4. Права пользователя</h4>
              <p>Пользователь вправе запросить сведения об обработке, уточнение, ограничение обработки или удаление данных в случаях, предусмотренных законом.</p>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
