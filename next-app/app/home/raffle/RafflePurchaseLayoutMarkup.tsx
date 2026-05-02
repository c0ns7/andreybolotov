function DiceIcon() {
  return <img src="/dice.png" alt="" width="30" height="30" loading="lazy" aria-hidden="true" className="raffle-fast-input__dice" />;
}

export default function RafflePurchaseLayoutMarkup() {
  return (
    <div className="app-shell app-shell--with-tabbar" id="app-shell">
      <div className="raffle-purchase-layout" id="raffle-purchase-layout">
        <header className="raffle-purchase-hero raffle-purchase-hero--sticky raffle-purchase-hero--no-cover" id="raffle-page-hero">
          <div className="raffle-purchase-hero__hairline" aria-hidden="true"></div>
          <div className="raffle-purchase-hero__layers" aria-hidden="true">
            <div className="raffle-purchase-hero__layer raffle-purchase-hero__layer--solid"></div>
            <img
              id="raffle-page-cover-img"
              className="raffle-purchase-hero__cover-img"
              alt=""
              width={1200}
              height={600}
              decoding="async"
              hidden
            />
            <div className="raffle-purchase-hero__layer raffle-purchase-hero__veil"></div>
          </div>

          <div className="raffle-purchase-hero__shell">
            <div className="raffle-purchase-hero__bar">
              <button type="button" className="raffle-purchase-back raffle-purchase-back--hero" id="raffle-page-back" aria-label="Назад на главную">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 18l-6-6 6-6"></path>
                </svg>
              </button>
              <div className="raffle-purchase-hero__mid">
                <div id="raffle-page-heading-block" className="raffle-purchase-hero-head">
                  <h1 id="raffle-page-heading" className="raffle-purchase-title raffle-purchase-title--hero">
                    Акция
                  </h1>
                  <p id="raffle-page-price-badge" className="raffle-price-badge raffle-price-badge--hero" hidden></p>
                </div>
                <div id="raffle-page-checkout-head" className="raffle-purchase-hero-checkout-head" hidden>
                  <p id="raffle-page-checkout-title" className="raffle-purchase-title raffle-purchase-title--hero">
                    Акция
                  </p>
                </div>
                <div id="raffle-page-checkout-bar" className="raffle-checkout-bar raffle-checkout-bar--hero" hidden>
                  <div id="raffle-page-checkout-numbers" className="raffle-checkout-bar__nums"></div>
                  <div id="raffle-page-checkout-timer" className="raffle-checkout-bar__timer-wrap" role="status" aria-live="polite">
                    <span className="raffle-checkout-bar__timer-icon" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M12 6v6l4 2"></path>
                      </svg>
                    </span>
                    <span id="raffle-page-checkout-timer-text" className="raffle-checkout-bar__timer-text"></span>
                  </div>
                  <button type="button" className="raffle-checkout-bar__extend btn btn--secondary btn--sm" id="raffle-page-extend" hidden>
                    Продлить на 10 мин
                  </button>
                </div>
              </div>
            </div>

            <div className="raffle-purchase-hero__controls">
              <div id="fast-input-container" className="raffle-fast-input-wrap">
                <div id="raffle-fast-input" className="raffle-fast-input" aria-label="Быстрый набор номерка">
                  <button type="button" className="raffle-fast-input__random" id="raffle-fast-random" title="Случайный свободный билет" aria-label="Случайный свободный билет">
                    <DiceIcon />
                  </button>
                  <div className="raffle-fast-input__divider" aria-hidden="true"></div>
                  <input id="raffle-fast-number" className="raffle-fast-input__field" type="number" inputMode="decimal" placeholder="Быстрый набор номерка" min="1" />
                  <div className="raffle-fast-input__state" id="raffle-fast-state"></div>
                </div>
              </div>
              <div className="raffle-range-toolbar-scroll no-scrollbar">
                <div className="raffle-range-toolbar raffle-range-toolbar--strip">
                  <button
                    type="button"
                    className="raffle-range-eye"
                    id="raffle-page-only-free"
                    aria-pressed="false"
                    title="Скрыть занятые билеты"
                    aria-label="Скрыть занятые билеты"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  </button>
                  <div className="raffle-range-toolbar__divider" aria-hidden="true"></div>
                  <div id="raffle-page-tabs" className="raffle-range-tabs" role="tablist" aria-label="Диапазон номерков"></div>
                </div>
              </div>
              <div className="raffle-legend-island-wrap raffle-legend-island-wrap--in-hero">
                <div id="raffle-page-legend" className="raffle-legend raffle-legend--island" aria-label="Обозначения на сетке">
                  <span className="raffle-legend__item">
                    <span className="raffle-legend__swatch raffle-legend__swatch--free"></span>
                    Свободно
                  </span>
                  <span className="raffle-legend__item">
                    <span className="raffle-legend__swatch raffle-legend__swatch--sel"></span>
                    Ваш выбор
                  </span>
                  <span className="raffle-legend__item">
                    <span className="raffle-legend__swatch raffle-legend__swatch--taken"></span>
                    Забронировано
                  </span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="raffle-purchase-main">
          <p id="raffle-page-timer" className="raffle-detail__timer raffle-purchase-timer" hidden></p>
          <div id="raffle-page-root" className="raffle-purchase-root raffle-purchase-panel" data-raffle-ui="raffle-page">
            <div id="raffle-page-flow">
              <div id="raffle-page-step-grid">
                <div id="raffle-range-hint-top" className="raffle-range-swipe-hint raffle-range-swipe-hint--top" aria-hidden="true">
                  <div className="raffle-range-swipe-hint__pull-row" aria-hidden="true">
                    <div className="raffle-range-swipe-hint__pull-track">
                      <div id="raffle-range-pull-fill-top" className="raffle-range-swipe-hint__pull-fill"></div>
                    </div>
                  </div>
                  <span id="raffle-range-hint-top-text" className="raffle-range-swipe-hint__pill">
                    👆 Потяните вниз (свайп), чтобы открыть другой диапазон
                  </span>
                </div>
                <div id="raffle-page-grid" className="raffle-ticket-grid"></div>
                <div id="raffle-range-hint-bottom" className="raffle-range-swipe-hint raffle-range-swipe-hint--bottom" aria-hidden="true">
                  <span id="raffle-range-hint-bottom-text" className="raffle-range-swipe-hint__pill raffle-range-swipe-hint__pill--elevated">
                    Потяните вверх (свайп), чтобы открыть другой диапазон 👇
                  </span>
                  <div className="raffle-range-swipe-hint__pull-row raffle-range-swipe-hint__pull-row--bottom" aria-hidden="true">
                    <div className="raffle-range-swipe-hint__pull-track">
                      <div id="raffle-range-pull-fill-bottom" className="raffle-range-swipe-hint__pull-fill raffle-range-swipe-hint__pull-fill--from-right"></div>
                    </div>
                  </div>
                </div>
              </div>
              <div id="raffle-page-step-wait" className="raffle-detail__step raffle-detail__wait" hidden>
                <div className="raffle-wait-card" role="status" aria-live="polite">
                  <div className="raffle-wait-card__icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"></circle>
                      <path d="M12 6v6l4 2"></path>
                    </svg>
                  </div>
                  <div className="raffle-wait-card__body">
                    <p className="raffle-wait-card__badge">Статус: на проверке</p>
                    <h3 className="raffle-wait-card__title">Чек отправлен, всё в порядке</h3>
                    <p className="raffle-wait-card__text">Номерки остаются за вами до решения администратора.</p>
                    <p className="raffle-wait-card__sub">После закрепления оплаты билеты останутся за вами окончательно.</p>
                    <a className="raffle-wait-card__link" href="/home">
                      На главную
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
