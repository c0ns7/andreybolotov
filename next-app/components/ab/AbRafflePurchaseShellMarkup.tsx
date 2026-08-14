/* Sliced from src/components/AppDockModals.astro — cart strip + raffle unavailable + cart + reserve flow */
"use client";
export default function AbRafflePurchaseShellMarkup() {
  return (
    <>
<div id="cart-action-strip" className="cart-action-strip" role="region" aria-label="Корзина и бронь" aria-hidden="true">
  <button type="button" id="cart-action-strip-btn" className="cart-action-strip__btn">
    <span className="cart-action-strip__text-col">
      <span id="cart-action-strip-title" className="cart-action-strip__title">Забронировать</span>
      <span id="cart-action-strip-sub" className="cart-action-strip__sub">Выбрано билетов: 0</span>
    </span>
    <span className="cart-action-strip__chevron" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18l6-6-6-6"></path>
      </svg>
    </span>
  </button>
</div>
<div
  id="modal-raffle-unavailable"
  className="modal-overlay modal-overlay--raffle-unavailable"
  aria-hidden="true"
  role="dialog"
  aria-labelledby="raffle-unavailable-heading"
>
  <div className="modal modal--raffle-unavailable" id="modal-raffle-unavailable-inner">
    <div className="modal__top raffle-unavailable__top">
      <span></span>
      <span className="modal__top-title">Акция</span>
      <button type="button" className="modal__close raffle-unavailable__close" id="modal-raffle-unavailable-close" aria-label="Закрыть">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12"></path>
        </svg>
      </button>
    </div>
    <div className="raffle-unavailable__hero" aria-hidden="true">
      <div className="raffle-unavailable__glow"></div>
      <div className="raffle-unavailable__icon raffle-unavailable__icon--paused">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M10 9v6M14 9v6"></path>
        </svg>
      </div>
      <div className="raffle-unavailable__icon raffle-unavailable__icon--closed" hidden>
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
      </div>
    </div>
    <div className="modal__body raffle-unavailable__body">
      <h3 id="raffle-unavailable-heading" className="raffle-unavailable__heading"></h3>
      <p id="raffle-unavailable-text" className="raffle-unavailable__text"></p>
    </div>
  </div>
</div>

<div
  id="modal-cart"
  className="modal-overlay modal-overlay--cart"
  aria-hidden="true"
  role="dialog"
  aria-modal="true"
  aria-labelledby="modal-cart-title"
>
  <div className="modal modal--cart cart-sheet" id="modal-cart-sheet">
    <div className="cart-sheet__grabber" aria-hidden="true"></div>
    <div className="cart-sheet__head">
      <div className="cart-sheet__head-text">
        <h2 id="modal-cart-title" className="cart-sheet__title">Ваши номерки</h2>
      </div>
      <button type="button" className="cart-sheet__close" id="modal-cart-close" aria-label="Закрыть шторку">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 6 6 18"></path>
          <path d="m6 6 12 12"></path>
        </svg>
      </button>
    </div>
    <div className="cart-sheet__body custom-scrollbar">
      <nav id="modal-cart-flow-steps" className="cart-flow-rail" aria-label="Этапы покупки" hidden>
        <div className="cart-flow-rail__row">
          <div className="cart-flow-rail__step" data-cart-flow-step="pick">
            <div className="cart-flow-rail__bubble" aria-hidden="true">
              ✓
            </div>
            <span className="cart-flow-rail__label">Номерок</span>
          </div>
          <div className="cart-flow-rail__connector" data-cart-connector="0" aria-hidden="true">
            <div className="cart-flow-rail__connector-track">
              <div className="cart-flow-rail__connector-fill"></div>
            </div>
          </div>
          <div className="cart-flow-rail__step" data-cart-flow-step="cart">
            <div className="cart-flow-rail__bubble" aria-hidden="true">
              🛒
            </div>
            <span className="cart-flow-rail__label">Корзина</span>
          </div>
          <div className="cart-flow-rail__connector" data-cart-connector="1" aria-hidden="true">
            <div className="cart-flow-rail__connector-track">
              <div className="cart-flow-rail__connector-fill"></div>
            </div>
          </div>
          <div className="cart-flow-rail__step" data-cart-flow-step="pay">
            <div className="cart-flow-rail__bubble" aria-hidden="true">
              💳
            </div>
            <span className="cart-flow-rail__label">Оплата</span>
          </div>
          <div className="cart-flow-rail__connector" data-cart-connector="2" aria-hidden="true">
            <div className="cart-flow-rail__connector-track">
              <div className="cart-flow-rail__connector-fill"></div>
            </div>
          </div>
          <div className="cart-flow-rail__step" data-cart-flow-step="receipt">
            <div className="cart-flow-rail__bubble" aria-hidden="true">
              ✅
            </div>
            <span className="cart-flow-rail__label">Чек</span>
          </div>
        </div>
      </nav>
      <p id="modal-cart-picked-label" className="cart-sheet__picked-label" hidden>
        ВЫБРАНО
      </p>
      <div className="cart-sheet__section">
        <div id="modal-cart-numbers-root"></div>
        <button type="button" className="cart-sheet__clear-all" id="modal-cart-clear-all" aria-label="Очистить все выбранные номерки" hidden>
          <span className="cart-sheet__clear-all-icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18"></path>
              <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path>
              <path d="m19 6-1 14a1 1 0 0 1-1 .93H7a1 1 0 0 1-1-.93L5 6"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
            </svg>
          </span>
          <span>ОЧИСТИТЬ ВСЕ</span>
        </button>
      </div>
    </div>
    <div className="cart-sheet__footer">
      <p id="modal-cart-summary" className="cart-sheet__summary" aria-live="polite" hidden></p>
      <p id="modal-cart-multi-hint" className="cart-sheet__hint" hidden></p>
      <p id="modal-cart-luck-tip" className="cart-sheet__footer-tip cart-sheet__footer-tip--luck">
        <span className="cart-sheet__footer-tip-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path>
            <path d="M5 3v4"></path>
            <path d="M19 17v4"></path>
            <path d="M3 5h4"></path>
            <path d="M17 19h4"></path>
          </svg>
        </span>
        <span>Удачи с выбором номерка</span>
      </p>
      <button type="button" className="cart-sheet__cta" id="modal-cart-checkout" disabled>
        <span className="cart-sheet__cta-inner">
          <span className="cart-sheet__cta-spinner" id="modal-cart-checkout-spinner" aria-hidden="true" hidden>
            <svg className="cart-sheet__cta-spinner-svg" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="32" strokeDashoffset="12" opacity="0.35"></circle>
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"></path>
            </svg>
          </span>
          <span id="modal-cart-checkout-label">Корзина пуста</span>
        </span>
      </button>
    </div>
  </div>
</div>

<div
  id="modal-reserve-success"
  className="modal-overlay modal-overlay--reserve-flow"
  aria-hidden="true"
  role="dialog"
  aria-modal="true"
  aria-labelledby="reserve-success-title"
>
  <div className="modal reserve-flow-modal reserve-success-modal">
    <div className="reserve-success-modal__hero" aria-hidden="true">
      <div className="reserve-success-modal__pulse"></div>
      <div className="reserve-success-modal__icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5"></path>
        </svg>
      </div>
    </div>
    <h3 id="reserve-success-title" className="reserve-success-modal__title">Забронировано</h3>
    <p className="reserve-success-modal__sub">
      Номерки закреплены за вами. Дальше: оплата и один файл чека. Нажмите кнопку ниже — откроются реквизиты и таймер брони.
    </p>
    <p id="reserve-success-deadline" className="reserve-flow-modal__deadline" role="status" aria-live="polite"></p>
    <nav id="reserve-success-steps" className="payment-flow-steps" aria-label="Этапы оплаты">
      <ol className="payment-flow-steps__list">
        <li className="payment-flow-steps__step">
          <span className="payment-flow-steps__num" aria-hidden="true">1</span>
          <span className="payment-flow-steps__label">Бронь</span>
        </li>
        <li className="payment-flow-steps__step">
          <span className="payment-flow-steps__num" aria-hidden="true">2</span>
          <span className="payment-flow-steps__label">Перевод</span>
        </li>
        <li className="payment-flow-steps__step">
          <span className="payment-flow-steps__num" aria-hidden="true">3</span>
          <span className="payment-flow-steps__label">Чек</span>
        </li>
      </ol>
    </nav>
    <section className="reserve-success-modal__card">
      <div className="reserve-success-modal__row reserve-success-modal__row--head">
        <span className="reserve-success-modal__label">Заказ</span>
        <span id="reserve-success-order-id" className="reserve-success-modal__order-id">—</span>
      </div>
      <div className="reserve-success-modal__row">
        <span id="reserve-success-picked-label" className="reserve-success-modal__label">Выбрано (0)</span>
      </div>
      <div id="reserve-success-numbers" className="reserve-success-modal__numbers"></div>
      <div className="reserve-success-modal__row reserve-success-modal__row--total">
        <span className="reserve-success-modal__label">К оплате</span>
        <span id="reserve-success-amount" className="reserve-success-modal__amount" aria-live="polite">0 ₽</span>
      </div>
    </section>
    <button type="button" className="reserve-flow-btn reserve-flow-btn--dark" id="reserve-success-go-pay">Шаг 2: реквизиты и оплата</button>
  </div>
</div>

<div
  id="modal-reserve-payment"
  className="modal-overlay modal-overlay--reserve-flow pay-sheet-overlay"
  aria-hidden="true"
  role="dialog"
  aria-modal="true"
  aria-labelledby="reserve-payment-title"
>
  <div className="modal reserve-flow-modal reserve-payment-modal pay-sheet-dialog">
    <nav id="reserve-payment-steps" className="payment-flow-steps payment-flow-steps--compact pay-sheet-steps-legacy" aria-label="Этапы оплаты (служебно)" hidden>
      <ol className="payment-flow-steps__list">
        <li className="payment-flow-steps__step">
          <span className="payment-flow-steps__num" aria-hidden="true">1</span>
          <span className="payment-flow-steps__label">Бронь</span>
        </li>
        <li className="payment-flow-steps__step">
          <span className="payment-flow-steps__num" aria-hidden="true">2</span>
          <span className="payment-flow-steps__label">Перевод</span>
        </li>
        <li className="payment-flow-steps__step">
          <span className="payment-flow-steps__num" aria-hidden="true">3</span>
          <span className="payment-flow-steps__label">Чек</span>
        </li>
      </ol>
    </nav>

    <div className="pay-sheet-card">
      <div className="pay-sheet-card__header">
        <div className="pay-sheet-card__header-main">
          <button type="button" className="pay-sheet-header-back" id="reserve-payment-back" aria-label="Назад к реквизитам" hidden>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m12 19-7-7 7-7"></path>
              <path d="M19 12H5"></path>
            </svg>
          </button>
          <div className="pay-sheet-card__titles">
            <h2 id="reserve-payment-title" className="pay-sheet-card__title">
              Реквизиты для перевода
            </h2>
            <p id="reserve-payment-order-stamp" className="pay-sheet-card__stamp" aria-hidden="true">
              —
            </p>
            <span id="reserve-payment-order-id" className="pay-sheet-sr-only">
              —
            </span>
          </div>
        </div>
        <button type="button" className="pay-sheet-close" id="reserve-payment-close" aria-label="Закрыть">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18"></path>
            <path d="m6 6 12 12"></path>
          </svg>
        </button>
      </div>

      <div className="pay-sheet-card__body custom-scrollbar">
        <p id="reserve-payment-phase-hint" className="pay-sheet-phase-hint" role="status" hidden></p>

        <div id="reserve-payment-repeat-wrap" className="reserve-pay-repeat" hidden>
          <p id="reserve-payment-repeat-text" className="reserve-pay-repeat__text"></p>
          <button type="button" id="reserve-payment-repeat-toggle" className="reserve-pay-repeat__toggle" hidden>
            Показать ранее отправленные чеки
          </button>
          <ul id="reserve-payment-repeat-list" className="reserve-pay-repeat__list" hidden></ul>
        </div>

        <div className="pay-sheet-progress-wrap">
          <div className="pay-sheet-progress-track">
            <div id="reserve-payment-progress" className="pay-sheet-progress-fill"></div>
          </div>
        </div>

        <nav id="pay-sheet-flow-rail" className="pay-sheet-flow-rail pay-sheet-flow-rail--payment" aria-label="Этапы оплаты">
          <div className="pay-sheet-flow-rail__row">
            <div className="pay-sheet-flow-rail__step is-done" data-pay-flow-step="pick">
              <div className="pay-sheet-flow-rail__bubble" aria-hidden="true">
                ✓
              </div>
              <span className="pay-sheet-flow-rail__label">Номерок</span>
            </div>
            <div className="pay-sheet-flow-rail__connector is-filled" data-pay-flow-connector="0" aria-hidden="true">
              <div className="pay-sheet-flow-rail__connector-track">
                <div className="pay-sheet-flow-rail__connector-fill"></div>
              </div>
            </div>
            <div className="pay-sheet-flow-rail__step is-done" data-pay-flow-step="cart">
              <div className="pay-sheet-flow-rail__bubble" aria-hidden="true">
                ✓
              </div>
              <span className="pay-sheet-flow-rail__label">Корзина</span>
            </div>
            <div className="pay-sheet-flow-rail__connector is-filled" data-pay-flow-connector="1" aria-hidden="true">
              <div className="pay-sheet-flow-rail__connector-track">
                <div className="pay-sheet-flow-rail__connector-fill"></div>
              </div>
            </div>
            <div className="pay-sheet-flow-rail__step is-current" data-pay-flow-step="pay">
              <div className="pay-sheet-flow-rail__bubble" aria-hidden="true">
                💳
              </div>
              <span className="pay-sheet-flow-rail__label">Оплата</span>
            </div>
            <div className="pay-sheet-flow-rail__connector" data-pay-flow-connector="2" aria-hidden="true">
              <div className="pay-sheet-flow-rail__connector-track">
                <div className="pay-sheet-flow-rail__connector-fill"></div>
              </div>
            </div>
            <div className="pay-sheet-flow-rail__step is-upcoming" data-pay-flow-step="receipt">
              <div className="pay-sheet-flow-rail__bubble" aria-hidden="true">
                ✅
              </div>
              <span className="pay-sheet-flow-rail__label">Чек</span>
            </div>
          </div>
        </nav>

        <div className="pay-sheet-timer-amount">
          <div className="pay-sheet-timer-badge">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pay-sheet-timer-icon" aria-hidden="true">
              <path d="M12 6v6l4 2"></path>
              <circle cx="12" cy="12" r="10"></circle>
            </svg>
            <span className="pay-sheet-timer-value" id="reserve-payment-timer">
              15:00
            </span>
          </div>
          <div className="pay-sheet-amount-block">
            <p className="pay-sheet-amount-label">К переводу</p>
            <p className="pay-sheet-amount-main">
              <span id="reserve-payment-amount">0</span>
              <span className="pay-sheet-amount-curr"> ₽</span>
            </p>
          </div>
        </div>

        <p id="reserve-payment-rules-wrap" className="pay-sheet-rules" hidden>
          <a id="reserve-payment-rules-link" className="reserve-payment-modal__rules-link" href="#" target="_blank" rel="noopener noreferrer">
            Краткие правила акции
          </a>
        </p>

        <div id="reserve-payment-step-requisites">
          <aside className="pay-sheet-yandex-notice" aria-label="Рекомендация РКН по оплате">
            <p className="pay-sheet-yandex-notice__title">Оплата через Яндекс Браузер</p>
            <p className="pay-sheet-yandex-notice__text">
              Банковские сайты могут не открываться в Safari, Chrome и других зарубежных браузерах. Для корректной оплаты
              используйте <strong>Яндекс Браузер</strong> — кнопка ниже откроет страницу банка именно там (рекомендация РКН).
            </p>
            <a
              className="pay-sheet-yandex-notice__link"
              href="https://browser.yandex.ru/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Нет Яндекс Браузера? Скачать
            </a>
          </aside>

          <div className="pay-sheet-instr">
            <p className="pay-sheet-instr__title">📋 Инструкция:</p>
            <ol className="pay-sheet-instr__list">
              <li>
                Нажмите «<b>Открыть оплату в Яндекс Браузере</b>» ниже — откроется страница банка в рекомендованном браузере
              </li>
              <li id="reserve-pay-instr-step2-collection" hidden>
                Переведите <b className="pay-sheet-instr-amt">0 ₽</b> через сбор Сбербанка. Назначение платежа указывать не нужно — просто переведите сумму.
              </li>
              <li id="reserve-pay-instr-step2-other">
                Оплатите: <b className="pay-sheet-instr-amt">0 ₽</b>
                <br />
                <span className="pay-sheet-instr__warn">
                  ⚠ Укажите сообщение «<b id="reserve-pay-instr-purpose">—</b>»
                </span>
              </li>
              <li>
                Сделайте <b>скриншот</b> перевода
              </li>
              <li>
                Вернитесь на сайт и нажмите «Я перевёл» в самом низу
              </li>
            </ol>
          </div>

          <section id="reserve-payment-collect" className="pay-sheet-dark-card">
            <div className="pay-sheet-dark-card__head">
              <span className="pay-sheet-dark-card__tag">Сбор средств</span>
              <span id="reserve-payment-collect-bank" className="pay-sheet-dark-card__bank">
                Сбербанк
              </span>
            </div>
            <div className="pay-sheet-dark-card__divider"></div>
            <div className="pay-sheet-copy-block">
              <div className="pay-sheet-copy-block__main">
                <p className="pay-sheet-k">Получатель</p>
                <p id="reserve-payment-recipient" className="pay-sheet-v">—</p>
              </div>
              <button type="button" className="pay-sheet-copy-btn" data-copy-target="reserve-payment-recipient" aria-label="Копировать получателя">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
                </svg>
              </button>
            </div>
            <div className="pay-sheet-copy-block">
              <div className="pay-sheet-copy-block__main">
                <p className="pay-sheet-k">Назначение</p>
                <p id="reserve-payment-purpose-sber" className="pay-sheet-v pay-sheet-v--purpose">
                  —
                </p>
              </div>
              <button type="button" className="pay-sheet-copy-btn" data-copy-target="reserve-payment-purpose-sber" aria-label="Копировать назначение">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
                </svg>
              </button>
            </div>
            <a id="reserve-payment-link" className="pay-sheet-pay-link pay-sheet-pay-link--yandex" href="#" target="_blank" rel="noopener">
              Открыть оплату в Яндекс Браузере
            </a>
          </section>

          <section id="reserve-payment-collect-tbank" className="pay-sheet-dark-card" hidden>
            <div className="pay-sheet-dark-card__head">
              <span className="pay-sheet-dark-card__tag">Сбор средств</span>
              <span className="pay-sheet-dark-card__bank">Тинькофф</span>
            </div>
            <div className="pay-sheet-dark-card__divider"></div>
            <div className="pay-sheet-copy-block">
              <div className="pay-sheet-copy-block__main">
                <p className="pay-sheet-k">Получатель</p>
                <p id="reserve-payment-recipient-tbank" className="pay-sheet-v">
                  —
                </p>
              </div>
              <button type="button" className="pay-sheet-copy-btn" data-copy-target="reserve-payment-recipient-tbank" aria-label="Копировать получателя">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
                </svg>
              </button>
            </div>
            <div className="pay-sheet-copy-block">
              <div className="pay-sheet-copy-block__main">
                <p className="pay-sheet-k">Назначение</p>
                <p id="reserve-payment-purpose-tbank" className="pay-sheet-v pay-sheet-v--purpose">
                  Оплата услуг
                </p>
              </div>
              <button type="button" className="pay-sheet-copy-btn" data-copy-target="reserve-payment-purpose-tbank" aria-label="Копировать назначение">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
                </svg>
              </button>
            </div>
            <a id="reserve-payment-link-tbank" className="pay-sheet-pay-link pay-sheet-pay-link--yandex" href="#" target="_blank" rel="noopener">
              Открыть оплату в Яндекс Браузере
            </a>
          </section>

          <section id="reserve-payment-qr" className="pay-sheet-qr-card" hidden>
            <div className="pay-sheet-dark-card__head">
              <span className="pay-sheet-dark-card__tag">Оплата по QR</span>
              <span className="pay-sheet-dark-card__bank">Любой банк</span>
            </div>
            <div className="pay-sheet-copy-block">
              <div className="pay-sheet-copy-block__main">
                <p className="pay-sheet-k">Получатель</p>
                <p id="reserve-payment-qr-recipient" className="pay-sheet-v">
                  —
                </p>
              </div>
              <button type="button" className="pay-sheet-copy-btn" data-copy-target="reserve-payment-qr-recipient" aria-label="Копировать получателя">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
                </svg>
              </button>
            </div>
            <div className="pay-sheet-copy-block">
              <div className="pay-sheet-copy-block__main">
                <p className="pay-sheet-k">Назначение</p>
                <p id="reserve-payment-qr-purpose" className="pay-sheet-v pay-sheet-v--purpose">
                  Оплата услуг
                </p>
              </div>
              <button type="button" className="pay-sheet-copy-btn" data-copy-target="reserve-payment-qr-purpose" aria-label="Копировать назначение">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
                </svg>
              </button>
            </div>
            <div className="reserve-payment-modal__qr-wrap pay-sheet-qr-img">
              <img id="reserve-payment-qr-image" alt="QR-код для оплаты" loading="lazy" decoding="async" />
            </div>
            <p className="reserve-payment-modal__qr-hint pay-sheet-qr-hint">
              Откройте приложение банка, выберите оплату по QR и укажите назначение <strong id="reserve-payment-qr-purpose-hint">«Оплата услуг»</strong>.
            </p>
          </section>

          <section id="reserve-payment-bank-card" className="pay-sheet-dark-card" hidden>
            <div className="pay-sheet-dark-card__head">
              <span className="pay-sheet-dark-card__tag">Перевод на карту</span>
              <span className="pay-sheet-dark-card__bank">Карта</span>
            </div>
            <div className="pay-sheet-dark-card__divider"></div>
            <div className="pay-sheet-copy-block">
              <div className="pay-sheet-copy-block__main">
                <p className="pay-sheet-k">Номер карты</p>
                <p id="reserve-payment-bank-card-number" className="pay-sheet-v">
                  —
                </p>
              </div>
              <button
                type="button"
                className="pay-sheet-copy-btn"
                data-copy-target="reserve-payment-bank-card-number"
                aria-label="Копировать номер карты"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
                </svg>
              </button>
            </div>
            <div className="pay-sheet-copy-block">
              <div className="pay-sheet-copy-block__main">
                <p className="pay-sheet-k">Получатель</p>
                <p id="reserve-payment-bank-card-recipient" className="pay-sheet-v">
                  —
                </p>
              </div>
              <button
                type="button"
                className="pay-sheet-copy-btn"
                data-copy-target="reserve-payment-bank-card-recipient"
                aria-label="Копировать получателя"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
                </svg>
              </button>
            </div>
            <p id="reserve-payment-bank-card-unavailable" className="pay-sheet-warn-foot" hidden>
              Сейчас нет свободной карты для этой суммы — переключите способ или попробуйте позже.
            </p>
          </section>

          <p id="reserve-payment-amount-inline" className="pay-sheet-sr-only" aria-hidden="true">
            0 ₽
          </p>

          <div className="pay-sheet-transferred-wrap" id="reserve-payment-transferred-wrap">
            <div
              className="pay-sheet-transferred-hint"
              id="reserve-payment-transferred-hint"
              role="note"
              aria-live="polite"
            >
              <span className="pay-sheet-transferred-hint__icon" aria-hidden="true">
                👇
              </span>
              <span className="pay-sheet-transferred-hint__text">Перевели? Нажмите кнопку ниже</span>
            </div>
            <button type="button" className="pay-sheet-btn-transferred" id="reserve-payment-done">
              Я перевёл
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6"></path>
              </svg>
            </button>
          </div>
          <p className="pay-sheet-warn-foot">
            ⚠️ Нажмите эту кнопку ПОСЛЕ перевода, иначе бронь сгорит
          </p>
          <button type="button" className="pay-sheet-alt-req" id="reserve-payment-alt-requisites">
            🔄 Дайте другие реквизиты
          </button>
        </div>

        <div id="reserve-payment-step-confirm" className="pay-sheet-confirm-step" hidden>
          <div className="pay-sheet-receipt-checklist">
            <p className="pay-sheet-receipt-checklist__title">✅ Что должно быть на чеке:</p>
            <ul className="pay-sheet-receipt-checklist__list">
              <li>Дата перевода</li>
              <li>
                Сумма: <b id="reserve-payment-amount-check">0 ₽</b>
              </li>
              <li>Последние 4 цифры карты получателя</li>
            </ul>
          </div>
          <div className="pay-sheet-receipt-upload-wrap">
            <input
              id="reserve-payment-file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf"
              className="pay-sheet-receipt-input"
              tabIndex={-1}
            />
            <button type="button" id="reserve-payment-file-drop" className="pay-sheet-receipt-drop">
              <div className="pay-sheet-receipt-drop__icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12"></path>
                  <path d="m17 8-5-5-5 5"></path>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                </svg>
              </div>
              <div className="pay-sheet-receipt-drop__text">
                <p className="pay-sheet-receipt-drop__title">Загрузить чек</p>
                <p className="pay-sheet-receipt-drop__sub">Фото или PDF перевода</p>
              </div>
            </button>
            <div id="reserve-payment-file-preview" className="pay-sheet-receipt-preview" hidden>
              <div className="pay-sheet-receipt-preview__frame">
                <img id="reserve-payment-file-preview-img" className="pay-sheet-receipt-preview__img" alt="Превью чека" hidden />
                <div id="reserve-payment-file-preview-pdf" className="pay-sheet-receipt-preview__pdf" hidden>
                  <span className="pay-sheet-receipt-preview__pdf-badge">PDF</span>
                  <span id="reserve-payment-file-preview-pdf-name" className="pay-sheet-receipt-preview__pdf-name" />
                </div>
                <button
                  type="button"
                  id="reserve-payment-file-remove"
                  className="pay-sheet-receipt-preview__remove"
                  aria-label="Удалить файл и выбрать другой"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18"></path>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </button>
              </div>
              <p id="reserve-payment-file-name" className="pay-sheet-receipt-preview__caption" />
            </div>
          </div>
          <button type="button" className="pay-sheet-receipt-send pay-sheet-receipt-send--disabled" id="reserve-payment-send" disabled>
            Отправить чек
          </button>
          <button type="button" className="pay-sheet-receipt-back-link" id="reserve-payment-back-link">
            Ой, я ещё не оплатил (вернуться к реквизитам)
          </button>
        </div>
      </div>
    </div>

    <div
      id="reserve-payment-purpose-notice"
      className="pay-sheet-purpose-notice"
      hidden
      aria-hidden="true"
      role="presentation"
    >
      <div className="pay-sheet-purpose-notice__panel" role="alertdialog" aria-modal="true" aria-labelledby="reserve-payment-purpose-notice-title">
        <div className="pay-sheet-purpose-notice__icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </div>
        <p className="pay-sheet-purpose-notice__eyebrow">Важно перед оплатой</p>
        <h3 id="reserve-payment-purpose-notice-title" className="pay-sheet-purpose-notice__title">
          Укажите назначение платежа
        </h3>
        <p className="pay-sheet-purpose-notice__text">
          При оплате по QR-коду в приложении банка в поле <strong>«Назначение»</strong> или <strong>«Сообщение получателю»</strong> обязательно напишите:
        </p>
        <p id="reserve-payment-purpose-notice-value" className="pay-sheet-purpose-notice__value">
          ОПЛАТА УСЛУГ
        </p>
        <p className="pay-sheet-purpose-notice__foot">
          Без правильного назначения перевод может не засчитаться при проверке чека.
        </p>
        <button type="button" className="pay-sheet-purpose-notice__btn" id="reserve-payment-purpose-notice-ok">
          ПОНЯТНО
        </button>
      </div>
    </div>
  </div>
</div>

<div
  id="modal-reserve-payment-cancel-confirm"
  className="modal-overlay pay-cancel-sheet-overlay"
  aria-hidden="true"
  role="dialog"
  aria-modal="true"
  aria-labelledby="reserve-payment-cancel-title"
>
  <div className="pay-cancel-sheet-panel">
    <div className="pay-cancel-sheet-icon" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6 6 18"></path>
        <path d="m6 6 12 12"></path>
      </svg>
    </div>
    <h3 id="reserve-payment-cancel-title" className="pay-cancel-sheet-title">
      Отменить бронирование?
    </h3>
    <p className="pay-cancel-sheet-text">
      Это действие сбросит вашу бронь и вы потеряете выбранные номерки.
    </p>
    <div className="pay-cancel-sheet-actions">
      <button type="button" className="pay-cancel-sheet-btn pay-cancel-sheet-btn--primary" id="reserve-payment-cancel-dismiss">
        Нет, продолжить оплату
      </button>
      <button type="button" className="pay-cancel-sheet-btn pay-cancel-sheet-btn--secondary" id="reserve-payment-cancel-confirm">
        Да, отменить
      </button>
    </div>
  </div>
</div>

<div
  id="modal-receipt-sent-success"
  className="modal-overlay modal-overlay--receipt-sent"
  aria-hidden="true"
  role="dialog"
  aria-modal="true"
  aria-labelledby="receipt-sent-title"
>
  <div id="receipt-sent-confetti" className="receipt-sent-confetti" aria-hidden="true" />
  <div className="modal receipt-sent-modal">
    <div className="receipt-sent-modal__glow" aria-hidden="true" />
    <div className="receipt-sent-modal__card">
      <span className="receipt-sent-modal__badge">Чек принят</span>
      <div className="receipt-sent-modal__hero" aria-hidden="true">
        <div className="receipt-sent-modal__ring receipt-sent-modal__ring--outer" />
        <div className="receipt-sent-modal__ring receipt-sent-modal__ring--inner" />
        <div className="receipt-sent-modal__check">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
      </div>
      <h3 id="receipt-sent-title" className="receipt-sent-modal__title">
        <span className="receipt-sent-modal__title-emoji" aria-hidden="true">
          🎉
        </span>
        Чек успешно отправлен!
      </h3>
      <p className="receipt-sent-modal__text">
        Администратор проверит его в течение <strong>нескольких минут</strong>.
      </p>
      <p className="receipt-sent-modal__hint">
        Можете закрыть это окно — статус билетов обновится автоматически
      </p>
      <div className="receipt-sent-modal__actions">
        <button type="button" className="receipt-sent-modal__btn receipt-sent-modal__btn--share" id="receipt-sent-share">
          <span className="receipt-sent-modal__btn-emoji" aria-hidden="true">
            📣
          </span>
          <span className="receipt-sent-modal__btn-text">Поделиться с другом</span>
        </button>
        <button type="button" className="receipt-sent-modal__btn receipt-sent-modal__btn--ok" id="receipt-sent-ok">
          Понятно, спасибо
        </button>
      </div>
    </div>
  </div>
</div>

<div
  id="modal-action-error"
  className="modal-overlay modal-overlay--reserve-flow"
  aria-hidden="true"
  role="dialog"
  aria-modal="true"
  aria-labelledby="action-error-title"
>
  <div className="modal reserve-flow-modal reserve-expired-modal">
    <div className="reserve-expired-modal__hero" aria-hidden="true">
      <div className="reserve-expired-modal__icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18"></path>
          <path d="m6 6 12 12"></path>
        </svg>
      </div>
    </div>
    <h3 id="action-error-title" className="reserve-expired-modal__title">Нет связи с сервером</h3>
    <p id="action-error-text" className="reserve-expired-modal__sub">
      Проверьте интернет или отключите VPN. Это не ошибка банка — запрос не дошёл до сайта. Нажмите «Повторить».
    </p>
    <button type="button" className="reserve-flow-btn reserve-flow-btn--black" id="action-error-retry">Повторить</button>
  </div>
</div>

<div
  id="modal-wait-receipt"
  className="modal-overlay modal-overlay--reserve-flow"
  aria-hidden="true"
  role="dialog"
  aria-modal="true"
  aria-labelledby="wait-receipt-title"
>
  <div className="modal reserve-flow-modal wait-receipt-modal">
    <div className="wait-receipt-modal__hero" aria-hidden="true">
      <div className="wait-receipt-modal__icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 6v6l4 2"></path>
        </svg>
      </div>
    </div>
    <h3 id="wait-receipt-title" className="wait-receipt-modal__title">Нужен чек</h3>
    <nav id="wait-receipt-steps" className="payment-flow-steps payment-flow-steps--compact" aria-label="Этапы оплаты">
      <ol className="payment-flow-steps__list">
        <li className="payment-flow-steps__step">
          <span className="payment-flow-steps__num" aria-hidden="true">1</span>
          <span className="payment-flow-steps__label">Бронь</span>
        </li>
        <li className="payment-flow-steps__step">
          <span className="payment-flow-steps__num" aria-hidden="true">2</span>
          <span className="payment-flow-steps__label">Перевод</span>
        </li>
        <li className="payment-flow-steps__step">
          <span className="payment-flow-steps__num" aria-hidden="true">3</span>
          <span className="payment-flow-steps__label">Чек</span>
        </li>
      </ol>
    </nav>
    <p className="wait-receipt-modal__sub">
      Остался шаг с чеком: без файла мы не подтвердим оплату, а бронь ограничена по времени. Нажмите кнопку ниже и приложите скрин или PDF.
    </p>
    <div id="wait-receipt-repeat-wrap" className="reserve-pay-repeat reserve-pay-repeat--wait" hidden>
      <p id="wait-receipt-repeat-text" className="reserve-pay-repeat__text"></p>
      <button type="button" id="wait-receipt-repeat-toggle" className="reserve-pay-repeat__toggle" hidden>
        Показать ранее отправленные чеки
      </button>
      <ul id="wait-receipt-repeat-list" className="reserve-pay-repeat__list" hidden></ul>
    </div>
    <p id="wait-receipt-amount" className="wait-receipt-modal__amount">0 ₽</p>
    <button type="button" className="reserve-flow-btn reserve-flow-btn--black" id="wait-receipt-upload">Прикрепить чек</button>
    <p id="wait-receipt-left" className="wait-receipt-modal__left">Бронь держится 00:00</p>
    <p id="wait-receipt-deadline" className="reserve-flow-modal__deadline" role="status" aria-live="polite"></p>
    <p id="wait-receipt-rules-wrap" className="wait-receipt-modal__rules" hidden>
      <a id="wait-receipt-rules-link" className="reserve-payment-modal__rules-link" href="#" target="_blank" rel="noopener noreferrer">Краткие правила акции</a>
    </p>
  </div>
</div>

<div
  id="modal-reserve-expired"
  className="modal-overlay modal-overlay--reserve-flow"
  aria-hidden="true"
  role="dialog"
  aria-modal="true"
  aria-labelledby="reserve-expired-title"
>
  <div className="modal reserve-flow-modal reserve-expired-modal">
    <div className="reserve-expired-modal__hero" aria-hidden="true">
      <div className="reserve-expired-modal__icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18"></path>
          <path d="m6 6 12 12"></path>
        </svg>
      </div>
    </div>
    <h3 id="reserve-expired-title" className="reserve-expired-modal__title">Время вышло</h3>
    <p className="reserve-expired-modal__sub">Бронь не была оплачена. Номерки вернулись в продажу.</p>
    <button type="button" className="reserve-flow-btn reserve-flow-btn--black" id="reserve-expired-close">Закрыть</button>
  </div>
</div>

<div
  id="modal-ticket-search"
  className="modal-overlay modal-overlay--ticket-search"
  aria-hidden="true"
  role="dialog"
  aria-modal="true"
  aria-labelledby="modal-ticket-search-title"
>
  <div className="modal ticket-search-sheet">
    <div className="ticket-search-sheet__grabber" aria-hidden="true"></div>
    <div className="ticket-search-sheet__head">
      <div className="ticket-search-sheet__head-spacer" aria-hidden="true"></div>
      <h2 id="modal-ticket-search-title" className="ticket-search-sheet__title">Поиск номера</h2>
      <button type="button" className="ticket-search-sheet__close" id="modal-ticket-search-close" aria-label="Закрыть">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 6 6 18"></path>
          <path d="m6 6 12 12"></path>
        </svg>
      </button>
    </div>
    <div className="ticket-search-sheet__body custom-scrollbar">
      <div className="ticket-search-sheet__segment" role="tablist" aria-label="Режим поиска">
        <button type="button" className="ticket-search-sheet__seg ticket-search-sheet__seg--active" id="ticket-search-mode-enter" data-mode="enter" role="tab" aria-selected="true">Ввести номер</button>
        <button type="button" className="ticket-search-sheet__seg" id="ticket-search-mode-random" data-mode="random" role="tab" aria-selected="false">Случайный выбор</button>
      </div>
      <div id="ticket-search-panel-enter">
        <h3 className="ticket-search-sheet__label">Номер билета</h3>
        <div id="ticket-search-field" className="ticket-search-sheet__field">
          <input id="ticket-search-input" className="ticket-search-sheet__input" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" />
          <span id="ticket-search-status-badge" className="ticket-search-status-badge ticket-search-status-badge--empty" aria-live="polite"></span>
        </div>
        <button type="button" className="btn btn--primary ticket-search-sheet__cta" id="ticket-search-apply" disabled>Укажите свободный номер</button>
      </div>
      <div id="ticket-search-panel-random" hidden>
        <h3 className="ticket-search-sheet__label">Количество случайных билетов</h3>
        <div className="ticket-search-random__qty" aria-label="Количество">
          <button type="button" className="ticket-search-random__step" id="ticket-search-random-minus" aria-label="Меньше">−</button>
          <span id="ticket-search-random-qty-display" className="ticket-search-random__value">5</span>
          <button type="button" className="ticket-search-random__step" id="ticket-search-random-plus" aria-label="Больше">+</button>
        </div>
        <div className="ticket-search-random__presets" role="group" aria-label="Быстрый выбор">
          <button type="button" className="ticket-search-random__preset" data-random-preset="1">1</button>
          <button type="button" className="ticket-search-random__preset" data-random-preset="3">3</button>
          <button type="button" className="ticket-search-random__preset ticket-search-random__preset--active" data-random-preset="5">5</button>
          <button type="button" className="ticket-search-random__preset" data-random-preset="10">10</button>
          <button type="button" className="ticket-search-random__preset" data-random-preset="20">20</button>
        </div>
        <button type="button" className="btn btn--primary ticket-search-sheet__cta ticket-search-sheet__cta--blue" id="ticket-search-random-apply">
          Добавить 5 случайных билетов
        </button>
      </div>
      <div id="ticket-search-picked" className="ticket-search-picked" hidden>
        <p className="ticket-search-picked__title">ВЫБРАНО:</p>
        <div id="ticket-search-picked-chips" className="ticket-search-picked__chips"></div>
        <button type="button" className="ticket-search-picked__go-cart" id="ticket-search-go-cart">Перейти в корзину</button>
      </div>
    </div>
  </div>
</div>
    </>
  );
}
