export default function AppDockModalsLegacy() {
  return (
    <>
      <div
        id="cart-action-strip"
        className="cart-action-strip"
        role="region"
        aria-label="Корзина и бронь"
        aria-hidden="true"
      >
        <button type="button" id="cart-action-strip-btn" className="cart-action-strip__btn">
          <span className="cart-action-strip__text-col">
            <span id="cart-action-strip-title" className="cart-action-strip__title">
              Забронировать
            </span>
            <span id="cart-action-strip-sub" className="cart-action-strip__sub">
              Выбрано билетов: 0
            </span>
          </span>
          <span className="cart-action-strip__chevron" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </span>
        </button>
      </div>

      <div
        id="modal-profile"
        className="modal-overlay modal-overlay--profile"
        aria-hidden="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-heading"
      >
        <div className="profile-modal">
          <div className="profile-modal__sheet-handle" aria-hidden="true">
            <div className="cart-sheet__grabber" />
          </div>
          <button type="button" className="profile-modal__close" id="profile-modal-close" aria-label="Закрыть">
            ✕
          </button>
          <div className="profile-modal__body">
            <div className="profile-modal__hero">
              <div className="profile-modal__avatar" aria-hidden="true">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <h3 id="profile-modal-heading" className="profile-modal__title">
                Профиль
              </h3>
              <p id="profile-modal-phone-hero" className="profile-modal__phone-sub" />
            </div>

            <div className="profile-modal__card profile-modal__kv-list">
              <div className="profile-modal__kv-row">
                <div className="profile-modal__kv-left">
                  <span className="profile-modal__kv-icon profile-modal__kv-icon--id" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="4" y1="9" x2="20" y2="9" />
                      <line x1="4" y1="15" x2="20" y2="15" />
                      <line x1="10" y1="3" x2="8" y2="21" />
                      <line x1="16" y1="3" x2="14" y2="21" />
                    </svg>
                  </span>
                  <span className="profile-modal__kv-label">Идентификатор</span>
                </div>
                <div id="profile-field-user-id" className="profile-modal__kv-value profile-modal__value--mono" />
              </div>
              <div className="profile-modal__kv-row">
                <div className="profile-modal__kv-left">
                  <span className="profile-modal__kv-icon profile-modal__kv-icon--email" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="20" height="16" x="2" y="4" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                  </span>
                  <span className="profile-modal__kv-label">EMAIL</span>
                </div>
                <div id="profile-field-email" className="profile-modal__kv-value" />
              </div>
              <div className="profile-modal__kv-row">
                <div className="profile-modal__kv-left">
                  <span className="profile-modal__kv-icon profile-modal__kv-icon--locality" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </span>
                  <span className="profile-modal__kv-label">Населенный пункт</span>
                </div>
                <div id="profile-field-locality" className="profile-modal__kv-value" />
              </div>
            </div>

            <div className="profile-modal__tickets-card">
              <div className="profile-modal__tickets-card-head">
                <div className="profile-modal__tickets-card-head-left">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="profile-modal__tickets-card-head-icon"
                    aria-hidden="true"
                  >
                    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
                    <path d="M13 5v2" />
                    <path d="M13 17v2" />
                    <path d="M13 11v2" />
                  </svg>
                  <span className="profile-modal__tickets-card-label">Мои билеты</span>
                </div>
                <button type="button" className="profile-modal__tickets-history-btn" id="profile-open-history">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M3 3v5h5"></path>
                    <path d="M3.05 13a9 9 0 1 0 .5-4.5L8 13"></path>
                    <path d="M12 7v5l3 2"></path>
                  </svg>
                  <span>История</span>
                </button>
              </div>
              <div
                id="profile-tickets-body"
                className="profile-modal__tickets-body custom-scrollbar"
                data-profile-tickets="1"
              />
            </div>

            <div className="profile-modal__hint">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
              <p>Для изменения данных обращайтесь в службу поддержки.</p>
            </div>

            <p id="profile-admin-wrap" className="profile-modal__admin" hidden>
              <a href="/admin" className="btn-admin-link" id="link-admin">
                Панель администратора
              </a>
            </p>

            <div className="profile-modal__actions-row">
              <a
                href="/home/settings"
                className="profile-modal__icon-settings"
                id="link-profile-settings"
                aria-label="Настройки"
                title="Настройки"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </a>
              <button type="button" className="profile-modal__btn-back profile-modal__btn-back--row" id="profile-modal-dismiss">
                Вернуться
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        id="modal-participation-history"
        className="modal-overlay modal-overlay--tickets"
        aria-hidden="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-participation-history-title"
      >
        <div className="modal modal--tickets-sheet">
          <div className="cart-sheet__grabber" aria-hidden="true" />
          <div className="tickets-sheet__header">
            <div className="tickets-sheet__header-text">
              <h2 id="modal-participation-history-title" className="tickets-sheet__title">
                История участий
              </h2>
              <p className="tickets-sheet__subtitle">Все акции и ваши номерки по ним</p>
            </div>
            <button
              type="button"
              className="tickets-sheet__close"
              id="modal-participation-history-close"
              aria-label="Закрыть"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="tickets-sheet__body custom-scrollbar" id="modal-participation-history-body" />
        </div>
      </div>

      <div
        id="modal-promo-5-plus-1"
        className="modal-overlay modal-overlay--tickets"
        aria-hidden="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-promo-5-plus-1-title"
      >
        <div className="modal modal--tickets-sheet promo-5-plus-1-sheet">
          <div className="cart-sheet__grabber" aria-hidden="true" />
          <div className="tickets-sheet__header">
            <div className="tickets-sheet__header-text">
              <h2 id="modal-promo-5-plus-1-title" className="tickets-sheet__title">
                Что за акция 5+1?
              </h2>
              <p className="tickets-sheet__subtitle">Простыми словами и с быстрым расчетом</p>
            </div>
            <button type="button" className="tickets-sheet__close" id="modal-promo-5-plus-1-close" aria-label="Закрыть">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="tickets-sheet__body custom-scrollbar promo-5-plus-1-sheet__body">
            <div className="promo-5-plus-1-sheet__hero">
              <span className="promo-5-plus-1-sheet__hero-badge">АКЦИЯ 5+1</span>
              <p className="promo-5-plus-1-sheet__hero-text">
                Если вы приобретаете <strong>5 номерков</strong>, после проверки оплаты вам добавляется{" "}
                <strong>1 случайный номерок в подарок</strong>. Если покупаете <strong>10</strong>, получите{" "}
                <strong>+2</strong>, и так далее.
              </p>
            </div>
            <div className="promo-5-plus-1-sheet__steps">
              <p className="promo-5-plus-1-sheet__step">
                <strong>1.</strong> Выбираете и оплачиваете номерки.
              </p>
              <p className="promo-5-plus-1-sheet__step">
                <strong>2.</strong> Администратор подтверждает чек.
              </p>
              <p className="promo-5-plus-1-sheet__step">
                <strong>3.</strong> Бонусные номерки закрепляются автоматически и случайно.
              </p>
            </div>
            <section className="promo-5-plus-1-sheet__calc" aria-labelledby="promo-5-plus-1-calc-title">
              <h3 id="promo-5-plus-1-calc-title" className="promo-5-plus-1-sheet__calc-title">
                Калькулятор бонуса
              </h3>
              <label className="promo-5-plus-1-sheet__label" htmlFor="promo-5-plus-1-input">
                Сколько номерков хотите купить
              </label>
              <input
                id="promo-5-plus-1-input"
                className="promo-5-plus-1-sheet__input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                placeholder="Например: 7 или 15"
              />
              <p id="promo-5-plus-1-result" className="promo-5-plus-1-sheet__result" aria-live="polite">
                В подарок: 0 номерков
              </p>
            </section>
            <button type="button" className="promo-5-plus-1-sheet__ok" id="modal-promo-5-plus-1-ok">
              Понятно
            </button>
          </div>
        </div>
      </div>

      <div id="modal-cart" className="modal-overlay modal-overlay--cart" aria-hidden="true">
        <div id="modal-cart-sheet" className="modal modal--cart cart-sheet">
          <h2 id="modal-cart-title">Ваши номерки</h2>
          <button type="button" id="modal-cart-clear-all" />
          <div id="modal-cart-numbers-root"></div>
          <p id="modal-cart-summary" hidden></p>
          <p id="modal-cart-multi-hint" hidden></p>
          <button type="button" id="modal-cart-checkout">
            <span id="modal-cart-checkout-spinner" hidden></span>
            <span id="modal-cart-checkout-label">Корзина пуста</span>
          </button>
        </div>
      </div>

      <div id="modal-tickets" className="modal-overlay modal-overlay--tickets" aria-hidden="true">
        <div className="modal modal--tickets-sheet">
          <button type="button" id="modal-tickets-close" />
          <p id="modal-tickets-subtitle" hidden></p>
          <p id="modal-tickets-guide"></p>
          <button type="button" id="modal-tickets-guide-dismiss">Понятно</button>
          <div id="modal-tickets-body"></div>
        </div>
      </div>

      <div id="modal-ticket-search" className="modal-overlay modal-overlay--ticket-search" aria-hidden="true">
        <div className="modal ticket-search-sheet">
          <button type="button" id="modal-ticket-search-close" />
          <button type="button" id="ticket-search-mode-enter" data-mode="enter" />
          <button type="button" id="ticket-search-mode-random" data-mode="random" />
          <div id="ticket-search-panel-enter"></div>
          <div id="ticket-search-panel-random" hidden></div>
          <div id="ticket-search-field"></div>
          <input id="ticket-search-input" />
          <span id="ticket-search-status-badge"></span>
          <button type="button" id="ticket-search-apply" />
          <button type="button" id="ticket-search-random-minus" />
          <button type="button" id="ticket-search-random-plus" />
          <span id="ticket-search-random-qty-display">5</span>
          <button type="button" id="ticket-search-random-apply" />
          <div id="ticket-search-picked" hidden>
            <div id="ticket-search-picked-chips"></div>
            <button type="button" id="ticket-search-go-cart" />
          </div>
        </div>
      </div>

      <div id="modal-raffle-unavailable" className="modal-overlay modal-overlay--raffle-unavailable" aria-hidden="true">
        <div id="modal-raffle-unavailable-inner" className="modal modal--raffle-unavailable">
          <button type="button" id="modal-raffle-unavailable-close" className="raffle-unavailable__close" aria-label="Закрыть">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18"></path>
              <path d="m6 6 12 12"></path>
            </svg>
          </button>
          <div className="raffle-unavailable__cover">
            <img id="raffle-unavailable-cover" className="raffle-unavailable__cover-img" src="" alt="" />
            <div className="raffle-unavailable__cover-fade"></div>
            <div className="raffle-unavailable__hero-icon" aria-hidden="true">
              <svg className="raffle-unavailable__hero-icon-svg raffle-unavailable__hero-icon-svg--closed" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z"></path>
                <circle cx="12" cy="12" r="10"></circle>
              </svg>
              <svg className="raffle-unavailable__hero-icon-svg raffle-unavailable__hero-icon-svg--paused" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "none" }}>
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 8v4M12 16h.01"></path>
              </svg>
            </div>
          </div>
          <div className="raffle-unavailable__body">
            <h2 id="raffle-unavailable-heading" className="raffle-unavailable__heading"></h2>
            <p id="raffle-unavailable-text" className="raffle-unavailable__text"></p>
            <div className="raffle-unavailable__info-card">
              <div className="raffle-unavailable__info-item">
                <div className="raffle-unavailable__info-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 2v4"></path>
                    <path d="M16 2v4"></path>
                    <rect width="18" height="18" x="3" y="4" rx="2"></rect>
                    <path d="M3 10h18"></path>
                  </svg>
                </div>
                <div className="raffle-unavailable__info-text">
                  <p className="raffle-unavailable__info-label">Время эфира</p>
                  <p id="raffle-unavailable-live-time" className="raffle-unavailable__info-value">
                    Эфир закончился, смотрите запись эфира по ссылке.
                  </p>
                </div>
              </div>
            </div>
            <a
              id="raffle-unavailable-cta"
              href="https://vk.com/rinchin_03"
              target="_blank"
              rel="noopener noreferrer"
              className="raffle-unavailable__cta"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z"></path>
                <circle cx="12" cy="12" r="10"></circle>
              </svg>
              <span id="raffle-unavailable-cta-label">Смотреть эфир в VK</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 3h6v6"></path>
                <path d="M10 14 21 3"></path>
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              </svg>
            </a>
          </div>
        </div>
      </div>

      <div id="modal-reserve-success" className="modal-overlay modal-overlay--reserve-flow" aria-hidden="true">
        <div className="modal reserve-flow-modal">
          <p id="reserve-success-deadline"></p>
          <span id="reserve-success-order-id"></span>
          <span id="reserve-success-picked-label"></span>
          <div id="reserve-success-numbers"></div>
          <span id="reserve-success-amount"></span>
          <button type="button" id="reserve-success-go-pay" />
        </div>
      </div>

      <div id="modal-reserve-payment" className="modal-overlay modal-overlay--reserve-flow" aria-hidden="true">
        <div className="modal reserve-flow-modal">
          <button type="button" id="reserve-payment-close" />
          <button type="button" id="reserve-payment-back" />
          <h3 id="reserve-payment-title"></h3>
          <p id="reserve-payment-order-id"></p>
          <p id="reserve-payment-phase-hint"></p>
          <div id="reserve-payment-step-requisites"></div>
          <div id="reserve-payment-step-confirm" hidden></div>
          <div id="reserve-payment-progress"></div>
          <div id="reserve-payment-timer"></div>
          <span id="reserve-payment-amount"></span>
          <span id="reserve-payment-amount-inline"></span>
          <span id="reserve-payment-amount-check"></span>
          <span id="reserve-payment-recipient"></span>
          <span id="reserve-payment-recipient-tbank"></span>
          <span id="reserve-payment-qr-recipient"></span>
          <a id="reserve-payment-link" href="#">pay</a>
          <a id="reserve-payment-link-tbank" href="#">pay</a>
          <img id="reserve-payment-qr-image" alt="" />
          <span id="reserve-payment-purpose"></span>
          <span id="reserve-payment-purpose-tbank"></span>
          <span id="reserve-payment-qr-purpose"></span>
          <span id="reserve-payment-qr-purpose-hint"></span>
          <div id="reserve-payment-methods"></div>
          <button type="button" id="reserve-payment-method-collection" />
          <button type="button" id="reserve-payment-method-tbank" />
          <button type="button" id="reserve-payment-method-qr" />
          <div id="reserve-payment-collect"></div>
          <div id="reserve-payment-collect-tbank" hidden></div>
          <div id="reserve-payment-qr" hidden></div>
          <button type="button" id="reserve-payment-done" />
          <button type="button" id="reserve-payment-support" />
          <input id="reserve-payment-file" type="file" />
          <span id="reserve-payment-file-name"></span>
          <button type="button" id="reserve-payment-send" />
          <button type="button" id="reserve-payment-back-link" />
          <button type="button" id="reserve-payment-cancel-dismiss" />
          <button type="button" id="reserve-payment-cancel-confirm" />
          <p id="reserve-payment-deadline"></p>
        </div>
      </div>

      <div id="modal-reserve-payment-cancel-confirm" className="modal-overlay modal-overlay--reserve-flow" aria-hidden="true"></div>
      <div id="modal-wait-receipt" className="modal-overlay modal-overlay--reserve-flow" aria-hidden="true">
        <p id="wait-receipt-amount"></p>
        <p id="wait-receipt-left"></p>
        <p id="wait-receipt-deadline"></p>
        <button type="button" id="wait-receipt-upload" />
      </div>
      <div id="modal-reserve-expired" className="modal-overlay modal-overlay--reserve-flow" aria-hidden="true">
        <button type="button" id="reserve-expired-close" />
      </div>
      <div id="modal-action-error" className="modal-overlay modal-overlay--reserve-flow" aria-hidden="true">
        <h3 id="action-error-title"></h3>
        <p id="action-error-text"></p>
        <button type="button" id="action-error-retry" />
      </div>
    </>
  );
}
