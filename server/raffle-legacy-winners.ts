/**
 * Победители бесплатной раздачи (порядок = строка в списке телефонов при массовом назначении).
 * Привязка к «прошлой акции» задаётся в LEGACY_WINNER_TICKETS_BY_SOURCE_RAFFLE_ID или
 * переменной окружения LEGACY_FREE_WINNERS_SOURCE_RAFFLE_IDS (id через запятую).
 */

const LEGACY_FREE_WINNERS_150_RAW = [
  1653, 491, 93, 1202, 1763, 447, 1333, 746, 982, 515, 275, 1441, 999, 220, 1135, 1184, 778, 392, 229, 222, 1221,
  1957, 1841, 1484, 1213, 109, 16, 1629, 1805, 1907, 309, 1119, 954, 1265, 225, 1641, 58, 1459, 209, 393, 273, 231,
  330, 1605, 191, 5, 667, 937, 1711, 1920, 241, 1669, 193, 640, 1871, 1137, 1757, 1964, 1655, 1687, 1975, 713, 1054,
  760, 490, 478, 1861, 941, 1430, 189, 502, 893, 672, 223, 1308, 750, 1712, 1378, 34, 372, 676, 1612, 286, 610, 1601,
  33, 1017, 922, 751, 622, 1092, 463, 1966, 1047, 259, 1470, 1452, 532, 515, 448, 500, 1617, 700, 1143, 1794, 852,
  805, 1178, 924, 1337, 125, 863, 1114, 518, 1127, 1460, 1111, 1997, 1767, 1247, 484, 713, 1431, 1342, 73, 1321, 1836,
  1616, 18, 848, 909, 751, 83, 1203, 867, 248, 334, 731, 581, 1989, 1916, 769, 1494, 371, 1257, 108, 1923, 1338, 918,
  1850,
] as const;

export const LEGACY_FREE_WINNERS_150: readonly number[] = LEGACY_FREE_WINNERS_150_RAW;

/**
 * Явная привязка: id акции в БД (прошлая акция) → тот же порядок номерков для выдачи в новой акции.
 * Пример: `{ 42: LEGACY_FREE_WINNERS_150 }`
 */
export const LEGACY_WINNER_TICKETS_BY_SOURCE_RAFFLE_ID: Record<number, readonly number[]> = {};

let envSourceIdsCache: number[] | null = null;

function parseEnvSourceRaffleIds(): number[] {
  if (envSourceIdsCache) return envSourceIdsCache;
  const raw = (process.env.LEGACY_FREE_WINNERS_SOURCE_RAFFLE_IDS || "").trim();
  if (!raw) {
    envSourceIdsCache = [];
    return envSourceIdsCache;
  }
  const out = new Set<number>();
  for (const part of raw.split(/[\s,]+/)) {
    const id = Math.floor(Number(part));
    if (Number.isFinite(id) && id > 0) out.add(id);
  }
  envSourceIdsCache = [...out].sort((a, b) => a - b);
  return envSourceIdsCache;
}

/** Все id «источников», для которых настроен список (админка → выпадающее меню). */
export function getLegacyWinnerSourceRaffleIds(): number[] {
  const s = new Set<number>();
  for (const k of Object.keys(LEGACY_WINNER_TICKETS_BY_SOURCE_RAFFLE_ID)) {
    const id = Math.floor(Number(k));
    if (id > 0) s.add(id);
  }
  for (const id of parseEnvSourceRaffleIds()) s.add(id);
  return [...s].sort((a, b) => a - b);
}

/** Список номерков для выбранной прошлой акции или null, если источник не настроен. */
export function getLegacyWinnerTicketListForSourceRaffle(sourceRaffleId: number): readonly number[] | null {
  const id = Math.floor(Number(sourceRaffleId));
  if (!Number.isFinite(id) || id < 1) return null;
  const fromMap = LEGACY_WINNER_TICKETS_BY_SOURCE_RAFFLE_ID[id];
  if (fromMap && fromMap.length > 0) return fromMap;
  if (parseEnvSourceRaffleIds().includes(id)) return LEGACY_FREE_WINNERS_150;
  return null;
}
