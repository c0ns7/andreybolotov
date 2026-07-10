/** Контакт администратора для сброса пароля и поддержки (fallback, если API ещё не ответил). */
export const AB_ADMIN_MAX_URL_DEFAULT =
  "https://max.ru/u/f9LHodD0cOKSJihr4puAfiyfPGQJWImlRAdNuRhpYwI7qse5YaB625-1d3w";

/** @deprecated используйте AB_ADMIN_MAX_URL_DEFAULT или значение из /api/site/status */
export const AB_ADMIN_MAX_URL = AB_ADMIN_MAX_URL_DEFAULT;

export const AB_PASSWORD_RESET_ADMIN_TEXT =
  "Сброс пароля через сайт недоступен. Напишите администратору в MAX — поможем восстановить доступ.";

export const AB_ADMIN_MAX_LINK_LABEL = "Написать в MAX";

export const AB_PASSWORD_RESET_REQUIRED_FIELDS = [
  "номер телефона",
  "ФИО",
  "населённый пункт",
] as const;

/** Официальная иконка MAX (SVG). */
export const AB_MAX_LOGO_SVG = "https://maxicons.ru/icons/MAX.svg";
