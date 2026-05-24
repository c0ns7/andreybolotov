import { pgAll, pgExec, pgGet } from "./pg-sql.js";
import { getSiteSettings } from "./db.js";

export type SiteMusicTrackRow = {
  id: number;
  title: string;
  file_url: string;
  mime: string;
  enabled: number;
  sort_order: number;
  created_at: number;
};

export type SiteMusicTrackDto = {
  id: number;
  title: string;
  file_url: string;
  mime: string;
  enabled: boolean;
  sort_order: number;
  created_at: number;
};

export type PublicSiteMusicPayload = {
  music_enabled: boolean;
  music_default_volume: number;
  tracks: Array<{ id: number; title: string; file_url: string; mime: string }>;
};

function trackToDto(row: SiteMusicTrackRow): SiteMusicTrackDto {
  return {
    id: Math.floor(Number(row.id)),
    title: String(row.title || "").trim() || "Трек",
    file_url: String(row.file_url || "").trim(),
    mime: String(row.mime || "").trim(),
    enabled: Number(row.enabled) === 1,
    sort_order: Math.floor(Number(row.sort_order) || 0),
    created_at: Math.floor(Number(row.created_at) || 0),
  };
}

export async function listSiteMusicTracks(): Promise<SiteMusicTrackDto[]> {
  const rows = await pgAll<SiteMusicTrackRow>(
    `SELECT id, title, file_url, mime, enabled, sort_order, created_at
     FROM site_music_tracks
     ORDER BY sort_order ASC, id ASC`,
  );
  return rows.map(trackToDto);
}

export async function listEnabledSiteMusicTracks(): Promise<SiteMusicTrackDto[]> {
  const rows = await pgAll<SiteMusicTrackRow>(
    `SELECT id, title, file_url, mime, enabled, sort_order, created_at
     FROM site_music_tracks
     WHERE enabled = 1
     ORDER BY sort_order ASC, id ASC`,
  );
  return rows.map(trackToDto);
}

export async function insertSiteMusicTrack(data: {
  title: string;
  file_url: string;
  mime: string;
  enabled?: boolean;
}): Promise<SiteMusicTrackDto> {
  const now = Date.now();
  const maxSort = await pgGet<{ m: number }>(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM site_music_tracks`);
  const sortOrder = Math.floor(Number(maxSort?.m ?? -1)) + 1;
  const title = String(data.title || "").trim().slice(0, 180) || "Трек";
  const fileUrl = String(data.file_url || "").trim().slice(0, 500);
  const mime = String(data.mime || "").trim().slice(0, 120);
  await pgExec(
    `INSERT INTO site_music_tracks (title, file_url, mime, enabled, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [title, fileUrl, mime, data.enabled === false ? 0 : 1, sortOrder, now],
  );
  const row = await pgGet<SiteMusicTrackRow>(
    `SELECT id, title, file_url, mime, enabled, sort_order, created_at
     FROM site_music_tracks
     ORDER BY id DESC
     LIMIT 1`,
  );
  if (!row) throw new Error("TRACK_INSERT_FAILED");
  return trackToDto(row);
}

export async function updateSiteMusicTrack(
  id: number,
  patch: { title?: string; enabled?: boolean },
): Promise<SiteMusicTrackDto | null> {
  const rid = Math.floor(Number(id));
  if (!Number.isFinite(rid) || rid < 1) return null;
  const row = await pgGet<SiteMusicTrackRow>(`SELECT id FROM site_music_tracks WHERE id = ?`, [rid]);
  if (!row) return null;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    vals.push(String(patch.title || "").trim().slice(0, 180) || "Трек");
  }
  if (patch.enabled !== undefined) {
    sets.push("enabled = ?");
    vals.push(patch.enabled ? 1 : 0);
  }
  if (!sets.length) {
    const cur = await pgGet<SiteMusicTrackRow>(
      `SELECT id, title, file_url, mime, enabled, sort_order, created_at FROM site_music_tracks WHERE id = ?`,
      [rid],
    );
    return cur ? trackToDto(cur) : null;
  }
  vals.push(rid);
  await pgExec(`UPDATE site_music_tracks SET ${sets.join(", ")} WHERE id = ?`, vals);
  const next = await pgGet<SiteMusicTrackRow>(
    `SELECT id, title, file_url, mime, enabled, sort_order, created_at FROM site_music_tracks WHERE id = ?`,
    [rid],
  );
  return next ? trackToDto(next) : null;
}

export async function deleteSiteMusicTrack(id: number): Promise<boolean> {
  const rid = Math.floor(Number(id));
  if (!Number.isFinite(rid) || rid < 1) return false;
  await pgExec(`DELETE FROM site_music_tracks WHERE id = ?`, [rid]);
  return true;
}

export async function reorderSiteMusicTracks(ids: number[]): Promise<void> {
  const clean = [...new Set(ids.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0))];
  for (let i = 0; i < clean.length; i++) {
    await pgExec(`UPDATE site_music_tracks SET sort_order = ? WHERE id = ?`, [i, clean[i]]);
  }
}

export async function getPublicSiteMusicPayload(): Promise<PublicSiteMusicPayload> {
  const settings = await getSiteSettings();
  const tracks = settings.music_enabled ? await listEnabledSiteMusicTracks() : [];
  return {
    music_enabled: settings.music_enabled,
    music_default_volume: settings.music_default_volume,
    tracks: tracks
      .filter((t) => t.file_url)
      .map((t) => ({ id: t.id, title: t.title, file_url: t.file_url, mime: t.mime })),
  };
}
