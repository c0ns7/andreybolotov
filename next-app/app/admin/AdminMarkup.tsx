import Link from "next/link";

export default function AdminMarkup() {
  return (
    <div className="app-shell app-shell--with-tabbar app-shell--admin">
    <div className="admin-shell">
    <div className="admin-page">
      <div id="admin-loading" className="admin-loading" aria-busy="true" aria-live="polite">
        <div className="admin-loading__spinner" aria-hidden="true"></div>
        <p className="admin-loading__text">Проверка доступа…</p>
      </div>

      <div id="admin-gate" className="admin-gate" hidden>
        <div className="admin-gate__card">
          <div className="admin-gate__icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <h2 className="admin-gate__title">Нет доступа</h2>
          <p className="admin-gate__text">Войдите под учётной записью администратора, чтобы открыть панель.</p>
          <a href="/" className="admin-gate__btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
            На главную
          </a>
        </div>
      </div>

      <div id="admin-root" hidden>
      <header className="admin-head">
        <div className="admin-head__bar">
          <div className="admin-head__bar-top">
            <div className="admin-brand">
              <span className="admin-brand__badge" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="9" rx="1"></rect>
                  <rect x="14" y="3" width="7" height="5" rx="1"></rect>
                  <rect x="14" y="12" width="7" height="9" rx="1"></rect>
                  <rect x="3" y="16" width="7" height="5" rx="1"></rect>
                </svg>
              </span>
              <div className="admin-brand__text">
                <span className="admin-brand__label">Админ-панель</span>
                <span className="admin-brand__hint">andreybolotov.ru</span>
              </div>
            </div>
            <Link href="/home" className="admin-exit">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              <span>На сайт</span>
            </Link>
          </div>

          <nav className="admin-nav" aria-label="Разделы">
            <a href="/admin" className="admin-nav__link" id="nav-link-support">
              <span className="admin-nav__icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              </span>
              <span className="admin-nav__text">Поддержка</span>
            </a>
            <a href="/admin?tab=users" className="admin-nav__link" id="nav-link-users">
              <span className="admin-nav__icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
              </span>
              <span className="admin-nav__text">Пользователи</span>
            </a>
            <a href="/admin?tab=raffles" className="admin-nav__link" id="nav-link-raffles">
              <span className="admin-nav__icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
              </span>
              <span className="admin-nav__text">Акции</span>
            </a>
            <a href="/admin?tab=payments" className="admin-nav__link" id="nav-link-payments">
              <span className="admin-nav__icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                  <line x1="1" y1="10" x2="23" y2="10"></line>
                </svg>
              </span>
              <span className="admin-nav__text">Оплаты</span>
            </a>
            <a href="/admin?tab=settings" className="admin-nav__link" id="nav-link-settings">
              <span className="admin-nav__icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
                </svg>
              </span>
              <span className="admin-nav__text">Настройки</span>
            </a>
            <a href="/admin?tab=stats" className="admin-nav__link" id="nav-link-stats">
              <span className="admin-nav__icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="20" x2="12" y2="10"></line>
                  <line x1="18" y1="20" x2="18" y2="4"></line>
                  <line x1="6" y1="20" x2="6" y2="16"></line>
                </svg>
              </span>
              <span className="admin-nav__text">Статистика</span>
            </a>
          </nav>
        </div>

        <div className="admin-head__hero">
          <h1 id="admin-page-heading" className="admin-title">Поддержка</h1>
          <p id="admin-page-sub" className="admin-sub">Пользователи и переписка</p>
        </div>
      </header>

      <div id="admin-app" className="admin-app" hidden>
        <div className="admin-layout">
          <aside className="admin-sidebar">
            <h2 className="admin-sidebar__title">
              <span className="admin-sidebar__title-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
              </span>
              Диалоги
            </h2>
            <div className="admin-sidebar-search">
              <label className="visually-hidden" htmlFor="admin-support-thread-search">Поиск по телефону или тексту сообщения</label>
              <input
                id="admin-support-thread-search"
                className="input admin-sidebar-search__input"
                type="search"
                placeholder="Телефон или фраза из чата…"
                autoComplete="off"
                enterKeyHint="search"
              />
              <p className="admin-sidebar-search__hint">Сначала совпадение по номеру, иначе по тексту в сообщениях.</p>
            </div>
            <div className="admin-tabs" role="tablist" aria-label="Фильтр диалогов">
              <button type="button" className="admin-tab admin-tab--active" data-tab="all" role="tab" aria-selected="true">
                <span className="admin-tab__icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                </span>
                Все
              </button>
              <button
                type="button"
                className="admin-tab"
                data-tab="new"
                role="tab"
                aria-selected="false"
                title="Непрочитанные"
              >
                <span className="admin-tab__icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                </span>
                Новые
              </button>
              <button type="button" className="admin-tab" data-tab="unanswered" role="tab" aria-selected="false">
                <span className="admin-tab__icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><path d="M13 8H7"></path><path d="M17 12H7"></path></svg>
                </span>
                Без ответа
              </button>
            </div>
            <div id="admin-user-list" className="admin-user-list custom-scrollbar"></div>
          </aside>
          <main className="admin-main">
            <div id="admin-empty" className="admin-empty">
              <div className="admin-empty__illu" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  <path d="M13 8H7"></path>
                  <path d="M17 12H7"></path>
                </svg>
              </div>
              <p>Выберите пользователя слева, чтобы открыть переписку</p>
            </div>
            <div id="admin-thread" className="admin-thread" hidden>
              <div className="admin-thread__head">
                <button
                  type="button"
                  className="admin-thread__back"
                  id="btn-admin-thread-back"
                  aria-label="Назад к списку чатов"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 18l-6-6 6-6"></path>
                  </svg>
                </button>
                <div className="admin-thread__head-text">
                  <h2 id="admin-thread-name" className="admin-thread__name"></h2>
                  <p id="admin-thread-meta" className="admin-thread__meta"></p>
                </div>
                <div className="admin-thread__actions">
                  <button
                    type="button"
                    className="admin-thread__icon-btn"
                    id="btn-admin-edit-user"
                    title="Редактировать данные"
                    aria-label="Редактировать данные пользователя"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 20h9"></path>
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="admin-thread__tickets-btn"
                    id="btn-admin-user-tickets"
                    title="Билеты на текущую акцию"
                    aria-label="Билеты пользователя на текущую акцию"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"></path>
                      <path d="M13 5v2"></path>
                      <path d="M13 17v2"></path>
                      <path d="M13 11v2"></path>
                    </svg>
                  </button>
                </div>
              </div>
              <div id="admin-chat-dropzone" className="admin-thread__body">
              <div id="admin-messages" className="admin-messages custom-scrollbar"></div>
              <form id="admin-reply-form" className="admin-reply">
                <input
                  type="file"
                  id="admin-chat-file-input"
                  className="admin-reply__file"
                  hidden
                  tabIndex={-1}
                  aria-hidden="true"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt,.mp4,.mp3,.ogg,.webm"
                />
                <button type="button" className="admin-reply__attach" id="btn-admin-chat-attach" aria-label="Прикрепить файл" title="Прикрепить файл">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.38-8.38A4 4 0 1 1 18 12.84l-8.38 8.38a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                  </svg>
                </button>
                <div className="admin-reply__main">
                  <div className="admin-reply-canned" id="admin-reply-canned" role="toolbar" aria-label="Готовые ответы">
                    <button type="button" className="admin-reply-canned__btn" data-canned="where_order">Где заказ</button>
                    <button type="button" className="admin-reply-canned__btn" data-canned="how_receipt">Как чек</button>
                    <button type="button" className="admin-reply-canned__btn" data-canned="wait_time">Сроки</button>
                  </div>
                  <textarea
                    id="admin-reply-input"
                    className="admin-reply__textarea"
                    rows={2}
                    placeholder="Ответ от поддержки… Файл: кнопка скрепки, вставка из буфера или перетаскивание в область переписки."
                    maxLength={4000}
                    autoComplete="off"
                  ></textarea>
                </div>
                <button type="submit" className="admin-reply__btn" id="btn-admin-reply-send" aria-label="Отправить">
                  <svg className="admin-reply__btn-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"></path>
                    <path d="m21.854 2.147-10.94 10.939"></path>
                  </svg>
                  <span className="admin-reply__btn-label" aria-hidden="true">Отправить</span>
                </button>
              </form>
              </div>
            </div>
          </main>
        </div>
      </div>

      <div id="admin-raffles-app" className="admin-raffles-app" hidden>
        <div className="admin-raffles-toolbar admin-raffles-toolbar--raffles">
          <div className="admin-raffles-toolbar__lead">
            <span className="admin-raffles-toolbar__badge" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 12 20 22 4 22 4 12"></polyline>
                <rect x="2" y="7" width="20" height="5" rx="1"></rect>
                <line x1="12" y1="22" x2="12" y2="7"></line>
                <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
                <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
              </svg>
            </span>
            <div className="admin-raffles-toolbar__text">
              <span className="admin-raffles-toolbar__label">Акции на сайте</span>
              <p className="admin-raffles-toolbar__hint">
                Вкладка «Активные» — в продаже на сайте. «Скрытые» — не показываются на главной. Порядок карточек на сайте — поле «Порядок» (меньше — выше).
              </p>
            </div>
          </div>
          <button type="button" className="btn btn--primary admin-raffles-toolbar__btn" id="btn-raffle-new">
            <span className="admin-raffles-toolbar__btn-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </span>
            Новая акция
          </button>
        </div>
        <div className="admin-raffles-tabs" role="tablist" aria-label="Фильтр акций">
          <button
            type="button"
            className="admin-raffles-tab admin-raffles-tab--active"
            id="admin-raffles-tab-active"
            role="tab"
            aria-selected="true"
            data-raffles-tab="active"
          >
            Активные
          </button>
          <button
            type="button"
            className="admin-raffles-tab"
            id="admin-raffles-tab-hidden"
            role="tab"
            aria-selected="false"
            data-raffles-tab="hidden"
          >
            Скрытые
          </button>
        </div>
        <div className="admin-raffles-panel">
          <div id="admin-raffles-list" className="admin-raffles-list" role="list"></div>
        </div>
      </div>

      <div id="admin-payments-app" className="admin-payments-app" hidden>
        <div className="admin-raffles-toolbar admin-payments-toolbar">
          <div className="admin-payments-toolbar__text">
            <span className="admin-payments-toolbar__badge" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                <line x1="1" y1="10" x2="23" y2="10"></line>
              </svg>
            </span>
            <div className="admin-raffles-toolbar__text">
              <span className="admin-raffles-toolbar__label">Очередь оплат</span>
              <p className="admin-raffles-toolbar__hint">
                Переключайте вкладки: бронь без чека и заявки с чеком на подтверждение. Сверху в списке — более ранние заявки. Отклонение чека: комментарий уходит в письмо. «Снять бронь» — полная отмена.
              </p>
            </div>
          </div>
        </div>
        <div id="admin-payments-main" className="admin-payments-main">
          <div id="admin-payments-tabs-slot" className="admin-payments-tabs-slot" aria-live="polite"></div>
          <div id="admin-payments-list" className="admin-payments-list"></div>
        </div>
      </div>

      <div id="admin-users-app" className="admin-users-app" hidden>
        <div className="admin-raffles-toolbar admin-users-toolbar">
          <div className="admin-users-toolbar__lead">
            <span className="admin-users-toolbar__badge" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </span>
            <div className="admin-raffles-toolbar__text">
              <span className="admin-raffles-toolbar__label"
                >Пользователи <span id="admin-users-total-count" className="admin-users-toolbar__count" aria-live="polite">(…)</span></span>
              <p className="admin-raffles-toolbar__hint">Поиск по имени или телефону; отдельно — точный поиск по ID аккаунта. Если заполнен ID, текстовый поиск не используется. Карточки: правка профиля, чат поддержки, роль и блокировка.</p>
            </div>
          </div>
          <a href="/admin?tab=stats" className="admin-users-toolbar__stats-link" id="btn-admin-users-stats">
            Статистика
          </a>
        </div>
        <div className="admin-users-search-bar">
          <label className="admin-users-search-wrap admin-users-search-wrap--main">
            <span className="visually-hidden">Поиск пользователей</span>
            <input
              id="admin-users-search"
              className="input admin-users-search"
              type="search"
              placeholder="Поиск по имени или телефону…"
              autoComplete="off"
            />
          </label>
          <label className="admin-users-search-wrap admin-users-search-wrap--id">
            <span className="visually-hidden">Поиск по ID аккаунта</span>
            <input
              id="admin-users-search-id"
              className="input admin-users-search-id"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={12}
              placeholder="ID"
              title="Точный номер ID аккаунта"
            />
          </label>
        </div>
        <div id="admin-users-list" className="admin-users-list-wrap"></div>
      </div>

      <div id="admin-stats-app" className="admin-stats-app" hidden>
        <div className="admin-raffles-toolbar admin-stats-toolbar">
          <div className="admin-raffles-toolbar__text">
            <span className="admin-raffles-toolbar__label">Статистика пользователей</span>
            <p className="admin-raffles-toolbar__hint">
              Общая активность, участие в акциях и аналитика населённых пунктов с объединением похожих названий.
            </p>
          </div>
          <button type="button" className="admin-stats-toolbar__graph-btn" id="btn-admin-stats-graph">
            Показать график
          </button>
        </div>
        <div id="admin-stats-overview" className="admin-stats-overview"></div>
        <div className="admin-stats-tabs" role="tablist" aria-label="Разделы статистики">
          <button type="button" className="admin-stats-tab is-active" data-stats-tab="users" aria-selected="true">Пользователи</button>
          <button type="button" className="admin-stats-tab" data-stats-tab="raffles" aria-selected="false">По акциям</button>
          <button type="button" className="admin-stats-tab" data-stats-tab="localities" aria-selected="false">Населённые пункты</button>
        </div>
        <div id="admin-stats-users-panel" className="admin-stats-panel"></div>
        <div id="admin-stats-raffles-panel" className="admin-stats-panel" hidden></div>
        <div id="admin-stats-localities-panel" className="admin-stats-panel" hidden></div>
      </div>

      <div
        id="modal-admin-stats-graph"
        className="modal-overlay modal-overlay--admin-stats-graph"
        aria-hidden="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-stats-graph-title"
      >
        <div className="admin-stats-graph-modal">
          <div className="admin-stats-graph-modal__top">
            <h2 id="admin-stats-graph-title" className="admin-stats-graph-modal__title">График</h2>
            <button type="button" className="admin-stats-graph-modal__close" id="btn-admin-stats-graph-close" aria-label="Закрыть">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          <div id="admin-stats-graph-content" className="admin-stats-graph-modal__content"></div>
        </div>
      </div>

      <div id="admin-settings-app" className="admin-settings-app" hidden>
        <header className="admin-settings-hero">
          <div className="admin-settings-hero__icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
            </svg>
          </div>
          <div className="admin-settings-hero__text">
            <h2 className="admin-settings-hero__title">Состояние сайта</h2>
            <p className="admin-settings-hero__lead">
              Техработы не отключают доступ для администраторов: админка и запросы к API с ролью <strong>admin</strong> работают как обычно.
            </p>
          </div>
        </header>
        <div className="admin-settings-panel">
          <div className="admin-settings-card">
            <h2 className="admin-settings-card__title">Технические работы</h2>
            <p className="admin-settings-card__text">
              Для пользователей приложение и связанные запросы к API недоступны: их перенаправляет на страницу с сообщением. После отключения режима откроется доступ с главной.
            </p>
            <label className="admin-settings-toggle">
              <input type="checkbox" id="admin-settings-maintenance" className="admin-settings-toggle__input" role="switch" />
              <span className="admin-settings-toggle__track" aria-hidden="true"></span>
              <span className="admin-settings-toggle__label">Техработы включены</span>
            </label>
            <p className="admin-settings-card__status" id="admin-settings-status" role="status"></p>
          </div>
          <div className="admin-settings-card">
            <h2 className="admin-settings-card__title">Рассылка MAX</h2>
            <p className="admin-settings-card__text">
              Отправляет всем пользователям с закрепленной оплатой короткое приглашение в приватный чат MAX. Текст про номерки не добавляется.
            </p>
            <button type="button" className="admin-settings-action-btn" id="admin-settings-max-broadcast-btn">
              <span className="admin-settings-action-btn__ico" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2 11 13"></path>
                  <path d="M22 2 15 22 11 13 2 9 22 2z"></path>
                </svg>
              </span>
              <span>Рассылка в MAX (закрепленные)</span>
            </button>
            <p className="admin-settings-card__status" id="admin-settings-max-broadcast-status" role="status"></p>
          </div>
        </div>
      </div>
    </div>
    </div>
    </div>

    <div id="modal-raffle-form" className="modal-overlay modal-overlay--raffle-form" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="modal-raffle-form-title">
      <div className="modal admin-raffle-modal admin-raffle-modal--form">
        <div className="modal__top admin-raffle-modal__top">
          <span className="admin-raffle-modal__top-spacer" aria-hidden="true"></span>
          <div className="admin-raffle-modal__title-wrap">
            <span className="admin-raffle-modal__title-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            </span>
            <h2 id="modal-raffle-form-title" className="modal__top-title admin-raffle-modal__title">Акция</h2>
            <p className="admin-raffle-modal__subtitle">Заполните основные данные, оплату и публикацию</p>
          </div>
          <button type="button" className="modal__close admin-raffle-modal__close" id="modal-raffle-form-close" aria-label="Закрыть">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div className="modal__body admin-raffle-modal__body">
          <form id="form-raffle" className="admin-raffle-form" noValidate>
            <input type="hidden" id="raffle-edit-id" defaultValue="" />
            <section className="admin-raffle-section" aria-labelledby="raffle-sec-main">
              <h3 id="raffle-sec-main" className="admin-raffle-section__title">
                <span className="admin-raffle-section__icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                  </svg>
                </span>
                Основное
              </h3>
              <div className="form-group">
                <label htmlFor="raffle-title">Заголовок</label>
                <input id="raffle-title" className="input" type="text" maxLength={500} required placeholder="Например: Акция с призами" autoComplete="off" />
              </div>
              <div className="form-group">
                <label htmlFor="raffle-cover-url">Обложка — ссылка</label>
                <input id="raffle-cover-url" className="input" type="url" inputMode="url" placeholder="https://…" />
              </div>
              <div className="form-group">
                <label htmlFor="raffle-cover-file">Обложка — файл</label>
                <input id="raffle-cover-file" className="input input--file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" />
                <p className="admin-raffle-field-hint">JPEG, PNG, WebP или GIF, до 5 МБ.</p>
              </div>
            </section>
            <section className="admin-raffle-section" aria-labelledby="raffle-sec-price">
              <h3 id="raffle-sec-price" className="admin-raffle-section__title">
                <span className="admin-raffle-section__icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="1" x2="12" y2="23"></line>
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                  </svg>
                </span>
                Цена и лимит
              </h3>
              <div className="form-row-2">
                <div className="form-group">
                  <label htmlFor="raffle-price">Цена билета, ₽</label>
                  <input id="raffle-price" className="input" type="number" min="0" step="1" required inputMode="numeric" />
                </div>
                <div className="form-group">
                  <label htmlFor="raffle-tickets">Количество номерков</label>
                  <input id="raffle-tickets" className="input" type="number" min="0" step="1" required inputMode="numeric" />
                </div>
              </div>
              <div className="form-group admin-raffle-toggle-row">
                <label className="admin-toggle" htmlFor="raffle-cenopad-enabled">
                  <input id="raffle-cenopad-enabled" className="admin-toggle__input" type="checkbox" role="switch" />
                  <span className="admin-toggle__track" aria-hidden="true"></span>
                  <span className="admin-toggle__label">Вторая цена включена</span>
                </label>
                <p className="admin-raffle-field-hint admin-raffle-field-hint--tight">
                  Включает продажу по второй цене.
                </p>
              </div>
              <div className="form-group">
                <label htmlFor="raffle-cenopad-price">Вторая цена, ₽</label>
                <input id="raffle-cenopad-price" className="input" type="number" min="0" step="1" inputMode="numeric" placeholder="Например: 750" />
              </div>
              <div className="form-row-2">
                <div className="form-group">
                  <label htmlFor="raffle-cenopad-start-at">Старт второй цены</label>
                  <input id="raffle-cenopad-start-at" className="input" type="datetime-local" step={60} />
                </div>
                <div className="form-group">
                  <label htmlFor="raffle-cenopad-end-at">Окончание второй цены</label>
                  <input id="raffle-cenopad-end-at" className="input" type="datetime-local" step={60} />
                </div>
              </div>
              <p className="admin-raffle-field-hint admin-raffle-field-hint--tight" id="raffle-cenopad-stats"></p>
            </section>
            <section className="admin-raffle-section" aria-labelledby="raffle-sec-pay">
              <h3 id="raffle-sec-pay" className="admin-raffle-section__title">
                <span className="admin-raffle-section__icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                    <line x1="1" y1="10" x2="23" y2="10"></line>
                  </svg>
                </span>
                Оплата для пользователей
              </h3>
              <p className="admin-raffle-section__lead">Переключайтесь по вкладкам. Включите тумблер — и настройки метода станут доступны.</p>
              <div className="admin-pay-tabs" role="tablist" aria-label="Методы оплаты">
                <button type="button" className="admin-pay-tab is-active" id="admin-pay-tab-sber" data-pay-tab="sber" role="tab" aria-selected="true">Сбер</button>
                <button type="button" className="admin-pay-tab" id="admin-pay-tab-tbank" data-pay-tab="tbank" role="tab" aria-selected="false">Тинькофф</button>
                <button type="button" className="admin-pay-tab" id="admin-pay-tab-qr" data-pay-tab="qr" role="tab" aria-selected="false">QR</button>
              </div>
              <section className="admin-pay-panel" id="admin-pay-panel-sber" data-pay-panel="sber" role="tabpanel" aria-labelledby="admin-pay-tab-sber">
                <div className="form-group admin-raffle-toggle-row">
                  <label className="admin-toggle" htmlFor="raffle-sber-enabled">
                    <input id="raffle-sber-enabled" className="admin-toggle__input" type="checkbox" role="switch" />
                    <span className="admin-toggle__track" aria-hidden="true"></span>
                    <span className="admin-toggle__label">Сбор Сбербанк включен</span>
                  </label>
                </div>
                <div id="raffle-sber-settings">
                  <div className="form-group">
                    <label htmlFor="raffle-collection-url">Сбер — ссылка</label>
                    <input id="raffle-collection-url" className="input" type="url" inputMode="url" placeholder="https://…" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="raffle-recipient-sber">Сбер — получатель</label>
                    <textarea id="raffle-recipient-sber" className="input" rows={2} maxLength={2000} placeholder="Кому перевод и на какую цель"></textarea>
                  </div>
                </div>
              </section>
              <section className="admin-pay-panel" id="admin-pay-panel-tbank" data-pay-panel="tbank" role="tabpanel" aria-labelledby="admin-pay-tab-tbank" hidden>
                <div className="form-group admin-raffle-toggle-row">
                  <label className="admin-toggle" htmlFor="raffle-tbank-enabled">
                    <input id="raffle-tbank-enabled" className="admin-toggle__input" type="checkbox" role="switch" />
                    <span className="admin-toggle__track" aria-hidden="true"></span>
                    <span className="admin-toggle__label">Сбор Тинькофф включен</span>
                  </label>
                </div>
                <div id="raffle-tbank-settings">
                  <div className="form-group">
                    <label htmlFor="raffle-tbank-collection-url">Тинькофф — ссылка</label>
                    <input id="raffle-tbank-collection-url" className="input" type="url" inputMode="url" placeholder="https://…" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="raffle-recipient-tbank">Тинькофф — получатель</label>
                    <textarea id="raffle-recipient-tbank" className="input" rows={2} maxLength={2000} placeholder="Кому перевод и на какую цель"></textarea>
                  </div>
                </div>
              </section>
              <section className="admin-pay-panel" id="admin-pay-panel-qr" data-pay-panel="qr" role="tabpanel" aria-labelledby="admin-pay-tab-qr" hidden>
                <div className="form-group admin-raffle-toggle-row">
                  <label className="admin-toggle" htmlFor="raffle-qr-enabled">
                    <input id="raffle-qr-enabled" className="admin-toggle__input" type="checkbox" role="switch" />
                    <span className="admin-toggle__track" aria-hidden="true"></span>
                    <span className="admin-toggle__label">QR-оплата включена</span>
                  </label>
                </div>
                <div id="raffle-qr-settings">
                  <div className="form-group">
                    <label htmlFor="raffle-qr-url">QR-код — ссылка на изображение</label>
                    <input id="raffle-qr-url" className="input" type="url" inputMode="url" placeholder="https://…" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="raffle-qr-file">QR-код — файл</label>
                    <input id="raffle-qr-file" className="input input--file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" />
                    <p className="admin-raffle-field-hint">Загрузка заменит URL.</p>
                  </div>
                  <div className="form-group">
                    <label htmlFor="raffle-qr-recipient">QR — получатель</label>
                    <textarea id="raffle-qr-recipient" className="input" rows={2} maxLength={2000} placeholder="Получатель платежа по QR"></textarea>
                  </div>
                  <div className="form-group">
                    <label htmlFor="raffle-qr-purpose">QR — назначение платежа</label>
                    <input id="raffle-qr-purpose" className="input" type="text" maxLength={200} placeholder="Оплата услуг" autoComplete="off" />
                  </div>
                </div>
              </section>
              <section className="admin-raffle-section" aria-labelledby="raffle-sec-bank-cards">
                <h3 id="raffle-sec-bank-cards" className="admin-raffle-section__title">
                  <span className="admin-raffle-section__icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="20" height="14" x="2" y="5" rx="2"></rect>
                      <line x1="2" x2="22" y1="10" y2="10"></line>
                    </svg>
                  </span>
                  Банковские карты
                </h3>
                <p className="admin-raffle-field-hint admin-raffle-field-hint--tight">
                  Реквизиты для кнопки «Другие реквизиты» на оплате: по очереди с резервными картами, дневной лимит операций и учёт продаж по каждой карте.
                </p>
                <div className="form-group">
                  <label htmlFor="raffle-card-payment-scope">Оплата переводом на карту</label>
                  <select id="raffle-card-payment-scope" className="input input--select">
                    <option value="unlimited">Доступна всем покупателям (при наличии свободной карты)</option>
                    <option value="wholesale_only">Только при заказе от N номерков (N — из настройки опта ниже)</option>
                    <option value="min_order_tickets">Только при заказе от заданного числа номерков (поле ниже)</option>
                  </select>
                </div>
                <div id="raffle-card-payment-min-tickets-wrap" className="form-group" hidden>
                  <label htmlFor="raffle-card-payment-min-tickets">Минимум номерков в заказе для оплаты на карту</label>
                  <input
                    id="raffle-card-payment-min-tickets"
                    className="input"
                    type="number"
                    min={1}
                    step={1}
                    defaultValue={2}
                  />
                  <p className="admin-raffle-field-hint admin-raffle-field-hint--tight">
                    Не связано с порогом опта — отдельный порог только для кнопки «Другие реквизиты» (карта).
                  </p>
                </div>
                <div id="raffle-bank-cards-list" className="admin-bank-cards-list" role="list"></div>
                <div className="form-actions" style={{ marginTop: "0.75rem" }}>
                  <button type="button" className="btn btn--ghost" id="raffle-bank-card-add">
                    + Добавить карту
                  </button>
                </div>
              </section>
              <div className="form-group">
                <label htmlFor="raffle-rules-url">Ссылка на краткие правила акции</label>
                <input
                  id="raffle-rules-url"
                  className="input"
                  type="url"
                  inputMode="url"
                  placeholder="https://… (экран оплаты и письма)"
                  maxLength={2000}
                />
              </div>
              <div className="form-group">
                <label htmlFor="raffle-live-stream-note">Время эфира / сообщение в модалке</label>
                <textarea
                  id="raffle-live-stream-note"
                  className="input"
                  rows={2}
                  maxLength={2000}
                  placeholder="Например: Эфир закончился, смотрите запись эфира по ссылке."
                ></textarea>
              </div>
              <div className="form-row-2">
                <div className="form-group">
                  <label htmlFor="raffle-live-stream-at">Время старта эфира</label>
                  <input
                    id="raffle-live-stream-at"
                    className="input"
                    type="datetime-local"
                    step={60}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="raffle-live-stream-status">Статус эфира</label>
                  <select id="raffle-live-stream-status" className="input input--select">
                    <option value="scheduled">Запланирован</option>
                    <option value="live">Идет</option>
                    <option value="ended">Окончен</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="raffle-live-stream-url">Ссылка на эфир (для кнопки в модалке)</label>
                <input
                  id="raffle-live-stream-url"
                  className="input"
                  type="url"
                  inputMode="url"
                  placeholder="https://…"
                  maxLength={2000}
                />
              </div>
            </section>
            <section className="admin-raffle-section" aria-labelledby="raffle-sec-pub">
              <h3 id="raffle-sec-pub" className="admin-raffle-section__title">
                <span className="admin-raffle-section__icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                </span>
                Публикация
              </h3>
              <div className="form-row-2">
                <div className="form-group">
                  <label htmlFor="raffle-status">Статус</label>
                  <select id="raffle-status" className="input input--select">
                    <option value="active">Активен</option>
                    <option value="closed">Продажи закрыты</option>
                    <option value="paused">Техническая пауза</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="raffle-sort">Порядок в списке</label>
                  <input id="raffle-sort" className="input" type="number" step={1} defaultValue={0} />
                  <p className="admin-raffle-field-hint admin-raffle-field-hint--tight">Меньшее число — выше на главной.</p>
                </div>
              </div>
              <div className="form-group admin-raffle-toggle-row">
                <label className="admin-toggle" htmlFor="raffle-wholesale-enabled">
                  <input id="raffle-wholesale-enabled" className="admin-toggle__input" type="checkbox" role="switch" />
                  <span className="admin-toggle__track" aria-hidden="true"></span>
                  <span className="admin-toggle__label">Оптовики</span>
                </label>
                <p className="admin-raffle-field-hint admin-raffle-field-hint--tight">
                  Отдельный список оптовиков (№ 1, 2, 3… по очереди закрепления) и оранжевое выделение в списке участников. Бонусные номерки в счёт не входят.
                </p>
              </div>
              <div id="raffle-wholesale-every-n-wrap" className="form-group" hidden>
                <label htmlFor="raffle-wholesale-every-n">Закреплённых номерков на 1 номер оптовика</label>
                <input
                  id="raffle-wholesale-every-n"
                  className="input"
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={10}
                />
                <p className="admin-raffle-field-hint admin-raffle-field-hint--tight">По умолчанию 10. Любое целое число от 1.</p>
              </div>
              <div className="form-group admin-raffle-toggle-row" role="group" aria-labelledby="raffle-promo-pack-legend">
                <div id="raffle-promo-pack-legend" className="admin-toggle__label">
                  Акция «5 + бонус»
                </div>
                <p className="admin-raffle-field-hint admin-raffle-field-hint--tight">
                  Можно включить только один вариант. Счётчики закреплённых бонусных номерков ведутся отдельно для 5+1 и 5+2.
                </p>
                <div className="admin-promo-pack-radios" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <label className="admin-radio-line" style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                    <input id="raffle-promo-pack-none" type="radio" name="raffle-promo-pack" value="none" defaultChecked />
                    <span>Нет</span>
                  </label>
                  <label className="admin-radio-line" style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                    <input id="raffle-promo-pack-5plus1" type="radio" name="raffle-promo-pack" value="5plus1" />
                    <span>5+1 — за каждые 5 оплаченных закрепляется 1 бонусный номерок</span>
                  </label>
                  <label className="admin-radio-line" style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                    <input id="raffle-promo-pack-5plus2" type="radio" name="raffle-promo-pack" value="5plus2" />
                    <span>5+2 — за каждые 5 оплаченных закрепляется 2 бонусных номерка</span>
                  </label>
                </div>
                <p className="admin-raffle-field-hint admin-raffle-field-hint--tight" id="raffle-promo-5-plus-1-stats"></p>
              </div>
              <div className="form-group admin-raffle-toggle-row">
                <label className="admin-toggle" htmlFor="raffle-hidden-from-public">
                  <input id="raffle-hidden-from-public" className="admin-toggle__input" type="checkbox" role="switch" />
                  <span className="admin-toggle__track" aria-hidden="true"></span>
                  <span className="admin-toggle__label">Скрыть с сайта</span>
                </label>
                <p className="admin-raffle-field-hint admin-raffle-field-hint--tight">
                  Не показывать в приложении и не отдавать по API, пока включено. Исключение: у пользователя уже есть активная заявка (бронь или проверка чека) — он сможет её завершить.
                </p>
              </div>
            </section>
            <div className="form-actions form-actions--split admin-raffle-form__actions">
              <button type="button" className="btn btn--ghost admin-raffle-form__btn-cancel" id="btn-raffle-cancel">Отмена</button>
              <button type="submit" className="btn btn--primary admin-raffle-form__btn-save" id="btn-raffle-submit">
                <span className="admin-raffle-form__btn-save-ico" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                  </svg>
                </span>
                <span id="btn-raffle-submit-label">Сохранить</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <div id="modal-raffle-participants" className="modal-overlay modal-overlay--raffle-form" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="modal-raffle-participants-title">
      <div className="modal admin-raffle-modal admin-raffle-modal--participants">
        <div className="modal__top admin-raffle-modal__top">
          <span className="admin-raffle-modal__top-spacer" aria-hidden="true"></span>
          <div className="admin-raffle-modal__title-wrap">
            <span className="admin-raffle-modal__title-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </span>
            <h2 id="modal-raffle-participants-title" className="modal__top-title admin-raffle-modal__title">Участники акции</h2>
          </div>
          <button type="button" className="modal__close admin-raffle-modal__close" id="modal-raffle-participants-close" aria-label="Закрыть">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div className="modal__body admin-raffle-modal__body">
          <div className="admin-raffle-participants">
            <div className="admin-raffle-participants-tabs" role="tablist" aria-label="Разделы участников">
              <button type="button" className="admin-raffle-participants-tab is-active" id="raffle-participants-tab-list" data-tab="participants" role="tab" aria-selected="true" aria-controls="raffle-participants-panel-list">
                Участники
              </button>
              <button type="button" className="admin-raffle-participants-tab" id="raffle-participants-tab-wholesalers" data-tab="wholesalers" role="tab" aria-selected="false" aria-controls="raffle-participants-panel-wholesalers">
                Оптовики
              </button>
              <button type="button" className="admin-raffle-participants-tab" id="raffle-participants-tab-assign" data-tab="assign" role="tab" aria-selected="false" aria-controls="raffle-participants-panel-assign">
                Выдача номерков
              </button>
            </div>
            <section
              id="raffle-participants-panel-list"
              className="admin-raffle-participants-panel"
              data-panel="participants"
              role="tabpanel"
              aria-labelledby="raffle-participants-tab-list"
              aria-hidden="false"
            >
              <label className="form-group admin-raffle-participants__search" htmlFor="raffle-participants-search">
                <span className="admin-raffle-participants__search-label">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  Поиск: номерок или телефон
                </span>
                <input
                  id="raffle-participants-search"
                  className="input admin-raffle-participants__search-input"
                  type="search"
                  inputMode="numeric"
                  placeholder="До 6 цифр — номерок; от 7 — телефон"
                  autoComplete="off"
                />
              </label>
              <div id="raffle-participants-list" className="admin-raffle-participants__list"></div>
            </section>
            <section id="raffle-participants-panel-wholesalers" className="admin-raffle-participants-panel" data-panel="wholesalers" role="tabpanel" aria-labelledby="raffle-participants-tab-wholesalers" aria-hidden="true" hidden>
              <div id="raffle-wholesalers-wrap" className="admin-raffle-wholesalers admin-raffle-wholesalers--tab">
                <p id="raffle-wholesalers-lead" className="admin-raffle-wholesalers__lead">
                  Номер оптовика выдаётся за каждые 10 закреплённых номерков (глобальная очередь по времени закрепления).
                </p>
                <div id="raffle-wholesalers-list" className="admin-raffle-wholesalers__list"></div>
              </div>
            </section>
            <section id="raffle-participants-panel-assign" className="admin-raffle-participants-panel" data-panel="assign" role="tabpanel" aria-labelledby="raffle-participants-tab-assign" aria-hidden="true" hidden>
              <div className="admin-raffle-single-assign">
                <h3 className="admin-raffle-single-assign__title">Выдать номерок по телефону</h3>
                <p className="admin-raffle-single-assign__hint">Введите телефон и номерок. Перед выдачей система проверит, свободен ли номерок.</p>
                <div className="admin-raffle-single-assign__grid">
                  <label className="form-group">
                    <span>Телефон</span>
                    <input id="raffle-single-phone" className="input" type="tel" inputMode="tel" placeholder="79141234567" autoComplete="off" />
                  </label>
                  <label className="form-group">
                    <span>Номерок</span>
                    <input id="raffle-single-ticket" className="input" type="number" min="1" inputMode="numeric" placeholder="Например: 2444" autoComplete="off" />
                  </label>
                </div>
                <label className="form-group admin-raffle-single-assign__note">
                  <span>Комментарий для пользователя (необязательно)</span>
                  <textarea
                    id="raffle-single-note"
                    className="input admin-raffle-single-assign__note-input"
                    rows={2}
                    maxLength={500}
                    placeholder="Например: за участие в эфире. Если пусто — в чат уйдёт только факт закрепления номерка."
                    autoComplete="off"
                  />
                </label>
                <p id="raffle-single-check" className="admin-raffle-single-assign__check" role="status">Введите номерок для проверки.</p>
                <button type="button" className="btn btn--primary admin-raffle-single-assign__btn" id="raffle-single-submit" disabled>Выдать номерок</button>
              </div>
              <div className="admin-raffle-bulk-assign">
                <label className="admin-raffle-bulk-assign__label" htmlFor="raffle-bulk-phones">
                  Быстрое назначение номерков по списку телефонов
                </label>
                <p className="admin-raffle-bulk-assign__hint">
                  По одному номеру на строку. Желаемый номерок у первой строки — «Первый номерок», у следующих строк — по порядку; если
                  номер занят, берётся следующий свободный. Одному телефону — один номер за загрузку; повторы в списке и те, у кого уже
                  есть номерок в акции, пропускаются.
                </p>
                <textarea
                  id="raffle-bulk-phones"
                  className="input admin-raffle-bulk-assign__textarea"
                  rows={5}
                  placeholder="89144617846&#10;89143687442&#10;…"
                  autoComplete="off"
                ></textarea>
                <div className="admin-raffle-bulk-assign__row">
                  <label className="admin-raffle-bulk-assign__start">
                    <span className="admin-raffle-bulk-assign__start-label">Первый номерок</span>
                    <input
                      id="raffle-bulk-start"
                      className="input admin-raffle-bulk-assign__start-input"
                      type="number"
                      min={1}
                      defaultValue={1}
                      inputMode="numeric"
                    />
                  </label>
                  <button type="button" className="btn btn--primary admin-raffle-bulk-assign__btn" id="raffle-bulk-submit">
                    Назначить
                  </button>
                </div>
                <p id="raffle-bulk-result" className="admin-raffle-bulk-assign__result" role="status" hidden></p>
              </div>
              <div className="admin-raffle-legacy-assign">
                <label className="admin-raffle-bulk-assign__label" htmlFor="raffle-legacy-source">
                  Назначение по номеркам из прошлой акции
                </label>
                <p className="admin-raffle-bulk-assign__hint">
                  Выберите акцию-источник и перечислите номерки <strong>из той акции</strong> через запятую. Система найдёт владельца каждого номерка и закрепит в <strong>текущей</strong> акции номерки подряд, начиная с указанного «Первый номерок»: 1-я позиция в списке → этот номерок, 2-я → +1, и т.д. Автоматически при запуске никому не назначается. Зарегистрированным уходит чат и уведомление.
                </p>
                <div className="form-group">
                  <label htmlFor="raffle-legacy-source">Акция-источник (прошлая)</label>
                  <select id="raffle-legacy-source" className="input input--select" disabled defaultValue="">
                    <option value="">Загрузка…</option>
                  </select>
                </div>
                <div className="admin-raffle-bulk-assign__row">
                  <label className="admin-raffle-bulk-assign__start">
                    <span className="admin-raffle-bulk-assign__start-label">Первый номерок в этой акции</span>
                    <input
                      id="raffle-legacy-target-start"
                      className="input admin-raffle-bulk-assign__start-input"
                      type="number"
                      min={1}
                      defaultValue={1}
                      inputMode="numeric"
                    />
                  </label>
                </div>
                <label className="form-group" htmlFor="raffle-legacy-source-tickets">
                  <span>Номерки из акции-источника (через запятую)</span>
                  <textarea
                    id="raffle-legacy-source-tickets"
                    className="input admin-raffle-bulk-assign__textarea"
                    rows={5}
                    placeholder="500, 1617, 700, 1143, …"
                    autoComplete="off"
                  ></textarea>
                </label>
                <label className="form-group admin-raffle-single-assign__note" htmlFor="raffle-legacy-note">
                  <span>Комментарий для пользователей (необязательно, один на всю загрузку)</span>
                  <textarea
                    id="raffle-legacy-note"
                    className="input admin-raffle-single-assign__note-input"
                    rows={2}
                    maxLength={500}
                    placeholder="Если пусто — только факт закрепления номерков."
                    autoComplete="off"
                  />
                </label>
                <div className="admin-raffle-bulk-assign__row">
                  <button type="button" className="btn btn--primary admin-raffle-bulk-assign__btn" id="raffle-legacy-submit">
                    Назначить
                  </button>
                </div>
                <p id="raffle-legacy-result" className="admin-raffle-bulk-assign__result" role="status" hidden></p>
              </div>
            </section>
            </div>
          </div>
        </div>
      </div>

    <div
      id="modal-raffle-buyer"
      className="modal-overlay modal-overlay--raffle-form modal-overlay--raffle-buyer"
      aria-hidden="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-raffle-buyer-title"
    >
      <div className="modal admin-raffle-modal admin-raffle-modal--buyer">
        <div className="modal__top admin-raffle-modal__top">
          <span className="admin-raffle-modal__top-spacer" aria-hidden="true"></span>
          <div className="admin-raffle-modal__title-wrap">
            <span className="admin-raffle-modal__title-icon admin-raffle-modal__title-icon--buyer" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </span>
            <h2 id="modal-raffle-buyer-title" className="modal__top-title admin-raffle-modal__title">Покупатель</h2>
          </div>
          <button type="button" className="modal__close admin-raffle-modal__close" id="modal-raffle-buyer-close" aria-label="Закрыть">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div className="modal__body admin-raffle-modal__body">
          <p className="admin-raffle-buyer-modal__lead">
            <span className="admin-raffle-buyer-modal__lead-ico" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </span>
            Данные скрыты. Нажмите на блок ниже, чтобы показать.
          </p>
          <div
            id="raffle-buyer-reveal"
            className="admin-raffle-buyer-modal__reveal"
            role="button"
            tabIndex={0}
            aria-label="Показать или скрыть данные покупателя"
          >
            <div className="admin-raffle-buyer-modal__fields">
              <div className="admin-raffle-buyer-modal__row">
                <span className="admin-raffle-buyer-modal__label">Имя</span>
                <span id="raffle-buyer-name" className="admin-raffle-buyer-modal__value"></span>
              </div>
              <div className="admin-raffle-buyer-modal__row">
                <span className="admin-raffle-buyer-modal__label">Телефон</span>
                <span id="raffle-buyer-phone" className="admin-raffle-buyer-modal__value"></span>
              </div>
              <div className="admin-raffle-buyer-modal__row">
                <span className="admin-raffle-buyer-modal__label">Населенный пункт</span>
                <span id="raffle-buyer-locality" className="admin-raffle-buyer-modal__value"></span>
              </div>
            </div>
          </div>
          <div className="admin-raffle-buyer-modal__actions">
            <button type="button" className="admin-raffle-btn admin-raffle-btn--chat" id="raffle-buyer-chat" hidden>
              <svg className="admin-raffle-btn__ico" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path>
              </svg>
              Написать в чат
            </button>
            <button type="button" className="admin-raffle-btn admin-raffle-btn--danger" id="raffle-buyer-detach">
              Снять номерок с пользователя
            </button>
          </div>
        </div>
      </div>
    </div>

    <div id="modal-edit-user" className="modal-overlay" aria-hidden="true" role="dialog" aria-labelledby="edit-user-title">
      <div className="modal admin-edit-modal">
        <div className="modal__top">
          <span></span>
          <h2 id="edit-user-title" className="modal__top-title">Данные пользователя</h2>
          <button type="button" className="modal__close" id="modal-edit-user-close" aria-label="Закрыть">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div className="modal__body">
          <p className="admin-edit-user-id" id="edit-user-account-id" aria-live="polite"></p>
          <form id="form-edit-user" noValidate>
            <div className="form-group">
              <label htmlFor="edit-user-name">Имя и фамилия</label>
              <input id="edit-user-name" className="input" type="text" autoComplete="name" maxLength={200} />
            </div>
            <div className="form-group">
              <label htmlFor="edit-user-phone">Телефон</label>
              <input id="edit-user-phone" className="input input--phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="+7 (___) ___-__-__" />
            </div>
            <div className="form-group">
              <label htmlFor="edit-user-locality">Населенный пункт</label>
              <input id="edit-user-locality" className="input" type="text" autoComplete="address-level2" maxLength={200} />
            </div>
            <div className="form-group">
              <label htmlFor="edit-user-password-new">Новый пароль</label>
              <input id="edit-user-password-new" className="input" type="password" autoComplete="new-password" />
              <p className="admin-edit-password-hint">Оставьте пустым, чтобы не менять. Не короче 6 символов.</p>
            </div>
            <div className="form-group">
              <label htmlFor="edit-user-password-confirm">Повторите пароль</label>
              <input id="edit-user-password-confirm" className="input" type="password" autoComplete="new-password" />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn--primary">Сохранить</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <div
      id="modal-admin-user-tickets"
      className="modal-overlay"
      aria-hidden="true"
      role="dialog"
      aria-labelledby="admin-user-tickets-title"
    >
      <div className="modal admin-edit-modal admin-user-tickets-modal">
        <div className="modal__top">
          <span></span>
          <h2 id="admin-user-tickets-title" className="modal__top-title">Номерки</h2>
          <button type="button" className="modal__close" id="modal-admin-user-tickets-close" aria-label="Закрыть">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div className="modal__body">
          <p id="admin-user-tickets-raffle" className="admin-user-tickets__subtitle"></p>
          <div id="admin-user-tickets-content" className="admin-user-tickets__content custom-scrollbar"></div>
        </div>
      </div>
    </div>
  </div>
  );
}
