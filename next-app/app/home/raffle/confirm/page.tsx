import type { Metadata } from "next";
import RaffleConfirmClient from "../../../../components/ab/RaffleConfirmClient";

export const metadata: Metadata = {
  title: "Подтверждение платежа",
  description: "Прикрепите чек для проверки.",
};

export default function HomeRaffleConfirmPage() {
  return (
    <>
      <div className="raffle-confirm-layout" id="raffle-confirm-layout">
        <header className="raffle-confirm-topbar">
          <button type="button" className="raffle-confirm-back" id="raffle-confirm-back" aria-label="Назад к оплате">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="raffle-confirm-topbar__title">Подтверждение платежа</h1>
          <span className="raffle-confirm-topbar__spacer" aria-hidden="true" />
        </header>
        <main className="raffle-confirm-main">
          <p id="raffle-confirm-lead" className="raffle-confirm-lead" />
          <div className="raffle-confirm-attach-wrap">
            <label className="raffle-confirm-file-label" htmlFor="raffle-confirm-file">
              <span className="raffle-confirm-file-label__icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </span>
              <span className="raffle-confirm-file-label__text">Прикрепить чек</span>
              <span id="raffle-confirm-file-name" className="raffle-confirm-file-name" />
            </label>
            <input type="file" id="raffle-confirm-file" className="raffle-confirm-file-input" accept="image/*,application/pdf" />
            <div id="raffle-confirm-upload-progress" className="raffle-confirm-upload-progress" hidden>
              <div className="raffle-confirm-upload-progress__track">
                <div id="raffle-confirm-upload-progress-fill" className="raffle-confirm-upload-progress__fill" />
              </div>
              <p id="raffle-confirm-upload-progress-text" className="raffle-confirm-upload-progress__text">
                Загрузка: 0%
              </p>
            </div>
          </div>
          <p className="raffle-confirm-hint">
            Скрин из банка: дата, сумма и получатель. До 10 МБ; большие фото страница попробует сжать перед отправкой.
          </p>
          <button
            type="button"
            className="btn btn--primary raffle-confirm-submit raffle-confirm-submit--disabled"
            id="raffle-confirm-send"
            disabled
          >
            Отправить чек
          </button>
        </main>
      </div>
      <RaffleConfirmClient />
    </>
  );
}
