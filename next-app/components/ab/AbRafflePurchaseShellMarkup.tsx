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
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
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
    <nav
      id="modal-cart-flow-steps"
      className="cart-sheet__flow payment-flow-steps payment-flow-steps--compact"
      aria-label="Этапы покупки"
      hidden
    >
      <ol className="payment-flow-steps__list">
        <li className="payment-flow-steps__step" data-cart-flow-step="pick">
          <span className="payment-flow-steps__num" aria-hidden="true">1</span>
          <span className="payment-flow-steps__label">Номерки</span>
        </li>
        <li className="payment-flow-steps__step" data-cart-flow-step="cart">
          <span className="payment-flow-steps__num" aria-hidden="true">2</span>
          <span className="payment-flow-steps__label">Корзина</span>
        </li>
        <li className="payment-flow-steps__step" data-cart-flow-step="pay">
          <span className="payment-flow-steps__num" aria-hidden="true">3</span>
          <span className="payment-flow-steps__label">Оплата</span>
        </li>
        <li className="payment-flow-steps__step" data-cart-flow-step="receipt">
          <span className="payment-flow-steps__num" aria-hidden="true">4</span>
          <span className="payment-flow-steps__label">Чек</span>
        </li>
      </ol>
    </nav>
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
  className="modal-overlay modal-overlay--reserve-flow"
  aria-hidden="true"
  role="dialog"
  aria-modal="true"
  aria-labelledby="reserve-payment-title"
>
  <div className="modal reserve-flow-modal reserve-payment-modal">
    <header className="reserve-payment-modal__head">
      <button type="button" className="reserve-payment-modal__back" id="reserve-payment-back" aria-label="Назад" hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6"></path>
        </svg>
      </button>
      <div className="reserve-payment-modal__title-wrap">
        <h3 id="reserve-payment-title" className="reserve-payment-modal__title">Реквизиты для перевода</h3>
        <p id="reserve-payment-order-id" className="reserve-payment-modal__order-id">—</p>
      </div>
      <button type="button" className="reserve-payment-modal__close" id="reserve-payment-close" aria-label="Закрыть">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18"></path>
          <path d="m6 6 12 12"></path>
        </svg>
      </button>
    </header>

    <nav id="reserve-payment-steps" className="payment-flow-steps payment-flow-steps--compact" aria-label="Этапы оплаты">
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
    <p id="reserve-payment-phase-hint" className="reserve-payment-modal__phase-hint" role="status"></p>

    <div id="reserve-payment-repeat-wrap" className="reserve-pay-repeat" hidden>
      <p id="reserve-payment-repeat-text" className="reserve-pay-repeat__text"></p>
      <button type="button" id="reserve-payment-repeat-toggle" className="reserve-pay-repeat__toggle" hidden>
        Показать ранее отправленные чеки
      </button>
      <ul id="reserve-payment-repeat-list" className="reserve-pay-repeat__list" hidden></ul>
    </div>

    <div className="reserve-payment-modal__progress-track">
      <div id="reserve-payment-progress" className="reserve-payment-modal__progress-fill"></div>
    </div>

    <div className="reserve-payment-modal__timer-row">
      <div className="reserve-payment-modal__timer" id="reserve-payment-timer">15:00</div>
      <div className="reserve-payment-modal__amount-wrap">
        <span className="reserve-payment-modal__amount-label">К ПЕРЕВОДУ</span>
        <strong id="reserve-payment-amount" className="reserve-payment-modal__amount" aria-live="polite">0 ₽</strong>
      </div>
    </div>
    <p id="reserve-payment-deadline" className="reserve-flow-modal__deadline" role="status" aria-live="polite"></p>
    <p id="reserve-payment-rules-wrap" className="reserve-payment-modal__rules" hidden>
      <a id="reserve-payment-rules-link" className="reserve-payment-modal__rules-link" href="#" target="_blank" rel="noopener noreferrer">Краткие правила акции</a>
    </p>

    <div id="reserve-payment-step-requisites">
      <section className="reserve-payment-modal__info">
        <h4>Три шага</h4>
        <ol>
          <li>
            Нажмите зелёную кнопку <strong>«Перейти к оплате»</strong> (или оплатите по QR). Если банк просит комментарий —{" "}
            <strong>«Оплата услуг»</strong>.
          </li>
          <li>
            Переведите ровно <strong id="reserve-payment-amount-inline">0 ₽</strong> — как в блоке «К переводу» выше.
          </li>
          <li>
            Вернитесь сюда → <strong>«Я перевёл — загрузить чек»</strong> → прикрепите <strong>фото или PDF</strong> из банка.
          </li>
        </ol>
      </section>
      <div id="reserve-payment-methods" className="reserve-payment-modal__methods" role="tablist" aria-label="Способ оплаты">
        <button
          type="button"
          id="reserve-payment-method-collection"
          className="reserve-payment-modal__method-btn is-active"
          role="tab"
          aria-selected="true"
        >
          <span className="reserve-payment-modal__method-title">Сбер</span>
          <span className="reserve-payment-modal__method-sub">Быстрый сбор</span>
        </button>
        <button
          type="button"
          id="reserve-payment-method-tbank"
          className="reserve-payment-modal__method-btn"
          role="tab"
          aria-selected="false"
        >
          <span className="reserve-payment-modal__method-title">Тинькофф</span>
          <span className="reserve-payment-modal__method-sub">Сбор по ссылке</span>
        </button>
        <button
          type="button"
          id="reserve-payment-method-qr"
          className="reserve-payment-modal__method-btn"
          role="tab"
          aria-selected="false"
        >
          <span className="reserve-payment-modal__method-title">QR-код</span>
          <span className="reserve-payment-modal__method-sub">Любой банк</span>
        </button>
      </div>
      <p className="reserve-payment-modal__methods-tip">Способ можно сменить вкладками. После оплаты не закрывайте это окно — сразу приложите чек.</p>

      <section id="reserve-payment-collect" className="reserve-payment-modal__collect">
        <div className="reserve-payment-modal__collect-head">
          <span>СБОР СРЕДСТВ</span>
          <span id="reserve-payment-collect-bank">СБЕР</span>
        </div>
        <div className="reserve-payment-modal__collect-item">
          <span>ПОЛУЧАТЕЛЬ</span>
          <strong id="reserve-payment-recipient">—</strong>
        </div>
        <a id="reserve-payment-link" className="reserve-flow-btn reserve-flow-btn--green" href="#" target="_blank" rel="noopener">ПЕРЕЙТИ К ОПЛАТЕ</a>
      </section>
      <section id="reserve-payment-collect-tbank" className="reserve-payment-modal__collect" hidden>
        <div className="reserve-payment-modal__collect-head">
          <span>СБОР СРЕДСТВ</span>
          <span>ТИНЬКОФФ</span>
        </div>
        <div className="reserve-payment-modal__collect-item">
          <span>ПОЛУЧАТЕЛЬ</span>
          <strong id="reserve-payment-recipient-tbank">—</strong>
        </div>
        <div className="reserve-payment-modal__collect-item">
          <span>НАЗНАЧЕНИЕ</span>
          <strong id="reserve-payment-purpose-tbank">Оплата услуг</strong>
        </div>
        <a id="reserve-payment-link-tbank" className="reserve-flow-btn reserve-flow-btn--green" href="#" target="_blank" rel="noopener">ПЕРЕЙТИ К ОПЛАТЕ</a>
      </section>
      <section id="reserve-payment-qr" className="reserve-payment-modal__collect reserve-payment-modal__collect--qr" hidden>
        <div className="reserve-payment-modal__collect-head">
          <span>ОПЛАТА ПО QR</span>
          <span>ЛЮБОЙ БАНК</span>
        </div>
        <div className="reserve-payment-modal__collect-item">
          <span>ПОЛУЧАТЕЛЬ</span>
          <strong id="reserve-payment-qr-recipient">—</strong>
        </div>
        <div className="reserve-payment-modal__collect-item">
          <span>НАЗНАЧЕНИЕ</span>
          <strong id="reserve-payment-qr-purpose">Оплата услуг</strong>
        </div>
        <div className="reserve-payment-modal__qr-wrap">
          <img id="reserve-payment-qr-image" alt="QR-код для оплаты" loading="lazy" decoding="async" />
        </div>
        <p className="reserve-payment-modal__qr-hint">
          Откройте приложение банка, выберите оплату по QR и укажите назначение <strong id="reserve-payment-qr-purpose-hint">«Оплата услуг»</strong>.
        </p>
      </section>
      <button type="button" className="reserve-flow-btn reserve-flow-btn--black" id="reserve-payment-done">Я перевёл — загрузить чек</button>
      <button type="button" className="raffle-pay-support" id="reserve-payment-support">Проблема с оплатой</button>
    </div>

    <div id="reserve-payment-step-confirm" hidden>
      <section className="reserve-payment-modal__info reserve-payment-modal__info--confirm">
        <h4>Быстрая проверка</h4>
        <ul>
          <li>
            Видны <strong>дата</strong> и <strong>сумма</strong> — как в заказе: <strong id="reserve-payment-amount-check">0 ₽</strong>
          </li>
          <li>
            Понятно, <strong>кому</strong> ушёл перевод (или QR-оплата видна на скрине)
          </li>
        </ul>
        <p className="reserve-payment-modal__info-note">Отправили — заявка уйдёт на проверку. При сбое связи нажмите отправку ещё раз.</p>
      </section>
      <p className="reserve-payment-modal__upload-hint">Скрин из банка или PDF, до 10 МБ. Крупные фото страница попробует сжать перед отправкой.</p>
      <label className="reserve-payment-modal__upload" htmlFor="reserve-payment-file">
        <input id="reserve-payment-file" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" hidden />
        <span className="reserve-payment-modal__upload-title">Выбрать файл чека</span>
        <span id="reserve-payment-file-name" className="reserve-payment-modal__upload-sub">Фото или PDF (до 10 МБ)</span>
      </label>
      <button type="button" className="reserve-flow-btn reserve-flow-btn--black" id="reserve-payment-send">Отправить чек</button>
      <button type="button" className="reserve-payment-modal__back-link" id="reserve-payment-back-link">Ой, я ещё не оплатил (вернуться к реквизитам)</button>
    </div>
  </div>
</div>

<div
  id="modal-reserve-payment-cancel-confirm"
  className="modal-overlay modal-overlay--reserve-flow modal-overlay--reserve-above-payment"
  aria-hidden="true"
  role="dialog"
  aria-modal="true"
  aria-labelledby="reserve-payment-cancel-title"
>
  <div className="modal reserve-flow-modal reserve-expired-modal">
    <h3 id="reserve-payment-cancel-title" className="reserve-expired-modal__title">Отменить бронирование?</h3>
    <p className="reserve-expired-modal__sub">
      Это действие сбросит вашу бронь и вы потеряете выбранные номерки.
    </p>
    <div className="reserve-payment-abandon__actions">
      <button type="button" className="reserve-flow-btn reserve-flow-btn--black" id="reserve-payment-cancel-dismiss">
        Нет, продолжить оплату
      </button>
      <button type="button" className="reserve-flow-btn reserve-flow-btn--muted" id="reserve-payment-cancel-confirm">
        Да, отменить
      </button>
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
