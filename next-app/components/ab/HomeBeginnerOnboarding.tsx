"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen, ChevronRight, CircleHelp, X } from "lucide-react";
import { getAbMyTicketsCached } from "../../lib/ab-my-tickets-cache";
import { getAbParticipationHistoryCached } from "../../lib/ab-participation-history-cache";
import { hasEverConfirmedTickets } from "../../lib/ab-has-confirmed-tickets";
import { AB_USER_WS_EVENT } from "../../lib/ab-user-ws-events";

type Props = {
  authVerified: boolean;
  sessionToken?: string;
};

const STEPS = [
  {
    title: "1. Выберите акцию",
    text: "На главной откройте карточку активной акции. Внутри — сетка номерков: белые свободны, серые уже заняты другими участниками.",
  },
  {
    title: "2. Отметьте номерки",
    text: "Нажимайте на белые номерки — они попадут в корзину. Можно выбрать несколько штук за раз (лимит указан на странице акции).",
  },
  {
    title: "3. Забронируйте",
    text: "Нажмите «Забронировать» в корзине. Номерки закрепятся за вами на ограниченное время — обычно 15 минут, чтобы успеть оплатить.",
  },
  {
    title: "4. Оплатите и прикрепите чек",
    text: "Переведите сумму по реквизитам на экране оплаты и загрузите скрин или фото чека. Без чека заявка не уйдёт на проверку.",
  },
  {
    title: "5. Дождитесь проверки",
    text: "После загрузки чека номерки становятся «на проверке» (оранжевые). Когда администратор подтвердит оплату — они станут закреплёнными (зелёные).",
  },
] as const;

const LEGEND = [
  { cls: "home-beginner-legend__swatch home-beginner-legend__swatch--free", label: "Белый — свободный, можно выбрать" },
  { cls: "home-beginner-legend__swatch home-beginner-legend__swatch--taken", label: "Серый — занят другим участником" },
  { cls: "home-beginner-legend__swatch home-beginner-legend__swatch--reserved", label: "Оранжевый — ваш, ожидает оплаты или проверки чека" },
  { cls: "home-beginner-legend__swatch home-beginner-legend__swatch--confirmed", label: "Зелёный — закреплён за вами (участие подтверждено)" },
] as const;

const FAQ = [
  {
    q: "Как понять, что номерок закреплён?",
    a: "В сетке акции он отображается зелёным. В профиле (внизу экрана) в блоке «Мои билеты» такие номерки в разделе «Закреплённые». В истории участий статус будет «Закреплено». Это значит, что оплата принята и номерок участвует в акции.",
  },
  {
    q: "Что значит «на проверке»?",
    a: "Вы уже отправили чек, и администратор проверяет перевод. Номерки оранжевые. Обычно проверка занимает от нескольких минут до пары часов — не закрывайте страницу сразу после оплаты, при необходимости зайдите в чат поддержки.",
  },
  {
    q: "Что значит «забронирован»?",
    a: "Номерок временно закреплён за вами, но оплата ещё не завершена. У вас есть ограниченное время (таймер на экране оплаты), чтобы перевести деньги и прикрепить чек. Если время вышло — бронь снимается, номерки снова станут свободными.",
  },
  {
    q: "Почему при бронировании подставился другой номерок?",
    a: "Если кто-то успел занять ваш номерок в последнюю секунду, сайт автоматически подставит ближайший свободный (соседний), чтобы вы не потеряли количество билетов. Мы покажем сообщение с заменой — перед оплатой проверьте итоговый список в корзине.",
  },
  {
    q: "Где смотреть все мои номерки?",
    a: "Кнопка «Профиль» в нижней панели — там бронь, проверка и закреплённые по текущей акции. Полная история по всем акциям — кнопка «История» в том же блоке.",
  },
  {
    q: "Когда исчезнет этот раздел обучения?",
    a: "Блок «Обучение для новичков» скроется автоматически, как только у вас появится хотя бы один закреплённый номерок в любой акции.",
  },
] as const;

export default function HomeBeginnerOnboarding({ authVerified, sessionToken }: Props) {
  const [ready, setReady] = useState(false);
  const [showBlock, setShowBlock] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!authVerified || !sessionToken) {
      setShowBlock(false);
      setReady(true);
      return;
    }
    try {
      const [tickets, history] = await Promise.all([
        getAbMyTicketsCached(),
        getAbParticipationHistoryCached(),
      ]);
      setShowBlock(!hasEverConfirmedTickets(tickets, history));
    } catch {
      setShowBlock(false);
    } finally {
      setReady(true);
    }
  }, [authVerified, sessionToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!authVerified || !sessionToken) return;
    const onUserWs = (ev: Event) => {
      const d = (ev as CustomEvent<{ type?: string }>).detail;
      if (!d || typeof d !== "object") return;
      if (d.type === "raffle_tickets_updated" || d.type === "order_status_updated") {
        void refresh();
      }
    };
    window.addEventListener(AB_USER_WS_EVENT, onUserWs as EventListener);
    return () => window.removeEventListener(AB_USER_WS_EVENT, onUserWs as EventListener);
  }, [authVerified, sessionToken, refresh]);

  useEffect(() => {
    if (!modalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [modalOpen]);

  if (!ready || !showBlock) return null;

  return (
    <>
      <section className="home-beginner-block" aria-labelledby="home-beginner-block-title">
        <div className="home-beginner-block__card">
          <div className="home-beginner-block__icon-wrap" aria-hidden="true">
            <BookOpen size={22} strokeWidth={2.2} />
          </div>
          <div className="home-beginner-block__text">
            <h2 id="home-beginner-block-title" className="home-beginner-block__title">
              Обучение для новичков
            </h2>
            <p className="home-beginner-block__lead">
              Пошагово: как выбрать номерки, оплатить, прикрепить чек и дождаться закрепления. С ответами на частые
              вопросы.
            </p>
          </div>
          <button type="button" className="home-beginner-block__btn" onClick={() => setModalOpen(true)}>
            <span>Пройти</span>
            <ChevronRight size={18} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      </section>

      <div
        id="modal-beginner-guide"
        className={"modal-overlay modal-overlay--beginner-guide" + (modalOpen ? " is-open" : "")}
        aria-hidden={modalOpen ? "false" : "true"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-beginner-modal-title"
        onClick={(e) => e.target === e.currentTarget && setModalOpen(false)}
      >
        <div className="modal home-beginner-modal">
          <button
            type="button"
            className="home-beginner-modal__close"
            aria-label="Закрыть"
            onClick={() => setModalOpen(false)}
          >
            <X size={20} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <div className="home-beginner-modal__head">
            <span className="home-beginner-modal__badge">
              <BookOpen size={16} strokeWidth={2.2} aria-hidden="true" />
              Обучение
            </span>
            <h2 id="home-beginner-modal-title" className="home-beginner-modal__title">
              Как участвовать в акции
            </h2>
            <p className="home-beginner-modal__intro">
              Ниже — простая схема от выбора номерка до закрепления. Раздел исчезнет с главной, когда у вас появится первый
              зелёный (закреплённый) номерок.
            </p>
          </div>
          <div className="home-beginner-modal__body custom-scrollbar">
            <section className="home-beginner-panel">
              <h3 className="home-beginner-panel__title">Цвета в сетке номерков</h3>
              <ul className="home-beginner-legend">
                {LEGEND.map((item) => (
                  <li key={item.label} className="home-beginner-legend__row">
                    <span className={item.cls} aria-hidden="true" />
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="home-beginner-panel">
              <h3 className="home-beginner-panel__title">Пошагово</h3>
              <ol className="home-beginner-steps">
                {STEPS.map((step) => (
                  <li key={step.title} className="home-beginner-steps__item">
                    <h4 className="home-beginner-steps__title">{step.title}</h4>
                    <p className="home-beginner-steps__text">{step.text}</p>
                  </li>
                ))}
              </ol>
            </section>

            <section className="home-beginner-panel home-beginner-panel--faq">
              <h3 className="home-beginner-panel__title">
                <CircleHelp size={18} strokeWidth={2.2} aria-hidden="true" />
                Частые вопросы
              </h3>
              <div className="home-beginner-faq">
                {FAQ.map((item) => (
                  <details key={item.q} className="home-beginner-faq__item">
                    <summary className="home-beginner-faq__q">{item.q}</summary>
                    <p className="home-beginner-faq__a">{item.a}</p>
                  </details>
                ))}
              </div>
            </section>
          </div>
          <div className="home-beginner-modal__footer">
            <button type="button" className="home-beginner-modal__cta" onClick={() => setModalOpen(false)}>
              Понятно, к акциям
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
