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
            <button type="button" className="raffle-confirm-file-label" id="raffle-confirm-file-btn">
              <span className="raffle-confirm-file-label__icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </span>
              <span className="raffle-confirm-file-label__text">Прикрепить чек</span>
            </button>
            <input
              type="file"
              id="raffle-confirm-file"
              className="raffle-confirm-file-input"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf"
              tabIndex={-1}
            />
            <div id="raffle-confirm-file-preview" className="pay-sheet-receipt-preview" hidden>
              <div className="pay-sheet-receipt-preview__frame">
                <img id="raffle-confirm-file-preview-img" className="pay-sheet-receipt-preview__img" alt="Превью чека" hidden />
                <div id="raffle-confirm-file-preview-pdf" className="pay-sheet-receipt-preview__pdf" hidden>
                  <span className="pay-sheet-receipt-preview__pdf-badge">PDF</span>
                  <span id="raffle-confirm-file-preview-pdf-name" className="pay-sheet-receipt-preview__pdf-name" />
                </div>
                <button
                  type="button"
                  id="raffle-confirm-file-remove"
                  className="pay-sheet-receipt-preview__remove"
                  aria-label="Удалить файл и выбрать другой"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              </div>
              <p id="raffle-confirm-file-name" className="pay-sheet-receipt-preview__caption" />
            </div>
          </div>
          <p className="raffle-confirm-hint">
            Чек в PDF или цельный скриншот с полной информацией: дата и время, получатель, отправитель, сумма. До 10 МБ;
            большие фото страница попробует сжать перед отправкой.
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
