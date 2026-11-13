export default function AppDockNavLegacy() {
  return (
    <>
      <div id="panel-chat" className="panel-chat screen--hidden" aria-hidden="true">
        <div className="panel-chat__inner">
          <header className="panel-chat__head">
            <div className="panel-chat__head-left">
              <div className="panel-chat__icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"></path>
                </svg>
              </div>
              <div>
                <h2 className="panel-chat__title">Поддержка</h2>
                <p className="panel-chat__status">Обычно отвечаем в течение дня</p>
              </div>
            </div>
            <button type="button" className="panel-chat__close" id="btn-chat-close" aria-label="Закрыть чат">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18"></path>
                <path d="m6 6 12 12"></path>
              </svg>
            </button>
          </header>
          <div className="panel-chat__hint" id="panel-chat-hint">Чат защищен сквозным шифрованием (RLS).</div>
          <div id="chat-messages" className="panel-chat__messages custom-scrollbar"></div>
          <form id="form-chat" className="panel-chat__form">
            <input type="file" id="chat-file-input" hidden tabIndex={-1} aria-hidden="true" />
            <button type="button" className="panel-chat__attach" id="btn-chat-attach" aria-label="Прикрепить файл">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.38-8.38A4 4 0 1 1 18 12.84l-8.38 8.38a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
              </svg>
            </button>
            <input id="chat-input" className="panel-chat__input" type="text" autoComplete="off" placeholder="Сообщение..." maxLength={4000} />
            <button type="submit" className="panel-chat__send" id="btn-chat-send" aria-label="Отправить">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"></path>
                <path d="m21.854 2.147-10.94 10.939"></path>
              </svg>
            </button>
          </form>
        </div>
      </div>

      <nav className="bottom-nav" id="bottom-nav" aria-label="Разделы приложения">
        <button type="button" className="bottom-nav-scrolltop" id="tab-scroll-top" aria-label="Наверх" title="Наверх" hidden>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m18 15-6-6-6 6"></path>
          </svg>
        </button>
        <div className="bottom-nav__inner bottom-nav__inner--3">
          <button type="button" className="bottom-nav-btn" id="tab-home" aria-label="Главная">
            <span className="bottom-nav-btn__icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            </span>
            <span className="bottom-nav-btn__label">Главная</span>
          </button>
          <button type="button" className="bottom-nav-btn bottom-nav-btn--dock-search" id="tab-ticket-search" aria-label="Поиск номера">
            <span className="bottom-nav-btn__icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m21 21-4.34-4.34"></path>
                <circle cx="11" cy="11" r="8"></circle>
              </svg>
            </span>
            <span className="bottom-nav-btn__label">Поиск</span>
          </button>
          <button type="button" className="bottom-nav-btn" id="tab-chat" aria-label="Чат поддержки">
            <span className="bottom-nav-btn__icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path>
              </svg>
            </span>
            <span className="bottom-nav-btn__label">Чат поддержки</span>
          </button>
          <button type="button" className="bottom-nav-btn" id="tab-profile" aria-label="Профиль">
            <span className="bottom-nav-btn__icon">
              <span id="bottom-nav-profile-letter">К</span>
              <span id="tickets-nav-badge" className="bottom-nav-btn__badge tickets-nav-badge" hidden aria-hidden="true"></span>
              <span className="bottom-nav-profile__dot" aria-hidden="true"></span>
            </span>
            <span className="bottom-nav-btn__label">Профиль</span>
          </button>
        </div>
      </nav>
    </>
  );
}
