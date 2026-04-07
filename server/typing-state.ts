/** In-memory флаги «печатает» — дублируют WS для HTTP/poll */

type Row = { user: boolean; staff: boolean };

const typingState = new Map<number, Row>();

function ensureRow(userId: number): Row {
  let r = typingState.get(userId);
  if (!r) {
    r = { user: false, staff: false };
    typingState.set(userId, r);
  }
  return r;
}

export function setUserTyping(userId: number, active: boolean): void {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return;
  const r = ensureRow(id);
  r.user = !!active;
}

export function setStaffTypingForUser(userId: number, active: boolean): void {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return;
  const r = ensureRow(id);
  r.staff = !!active;
}

export function getUserTypingForThread(userId: number): boolean {
  const id = Number(userId);
  return typingState.get(id)?.user ?? false;
}

export function getStaffTypingForUser(userId: number): boolean {
  const id = Number(userId);
  return typingState.get(id)?.staff ?? false;
}
