"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { AB_USER_WS_EVENT } from "../../lib/ab-user-ws-events";

const LS_OFF_KEY = "ab_bg_music_off";

export type SiteMusicTrack = {
  id: number;
  title: string;
  file_url: string;
  mime: string;
};

type MusicPlaybackMode = "sequential" | "shuffle";

type SiteMusicPayload = {
  music_enabled: boolean;
  music_default_volume: number;
  music_playback_mode: MusicPlaybackMode;
  tracks: SiteMusicTrack[];
};

function shuffleIndices(len: number): number[] {
  const arr = Array.from({ length: len }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

type SiteMusicContextValue = {
  available: boolean;
  userOff: boolean;
  isPlaying: boolean;
  toggleUserMusic: () => void;
  refresh: () => Promise<void>;
};

const SiteMusicContext = createContext<SiteMusicContextValue | null>(null);

function readUserOff(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = localStorage.getItem(LS_OFF_KEY);
    if (v === null) return true;
    return v === "1";
  } catch {
    return true;
  }
}

function writeUserOff(off: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_OFF_KEY, off ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function isAppMusicRoute(pathname: string): boolean {
  const p = pathname || "/";
  return (
    p === "/home" ||
    p.startsWith("/home/") ||
    p.startsWith("/raffle/") ||
    p === "/home/raffle"
  );
}

export function SiteMusicProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackIdxRef = useRef(0);
  const shuffleOrderRef = useRef<number[]>([]);
  const shufflePosRef = useRef(0);
  const [payload, setPayload] = useState<SiteMusicPayload>({
    music_enabled: false,
    music_default_volume: 35,
    music_playback_mode: "sequential",
    tracks: [],
  });
  const [loaded, setLoaded] = useState(false);
  const [userOff, setUserOff] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);

  const available = payload.music_enabled && payload.tracks.length > 0;
  const routeOk = isAppMusicRoute(pathname);
  const shouldPlay = available && !userOff && routeOk;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/site/music", { cache: "no-store" });
      const data = (await res.json()) as SiteMusicPayload;
      const tracks = Array.isArray(data.tracks) ? data.tracks : [];
      const mode: MusicPlaybackMode =
        String(data.music_playback_mode || "").trim().toLowerCase() === "shuffle" ? "shuffle" : "sequential";
      setPayload({
        music_enabled: !!data.music_enabled,
        music_default_volume: Math.max(0, Math.min(100, Math.floor(Number(data.music_default_volume) || 35))),
        music_playback_mode: mode,
        tracks,
      });
      trackIdxRef.current = 0;
      shuffleOrderRef.current = tracks.length > 1 ? shuffleIndices(tracks.length) : tracks.length === 1 ? [0] : [];
      shufflePosRef.current = 0;
    } catch {
      /* ignore */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    setUserOff(readUserOff());
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onWs = (ev: Event) => {
      const d = (ev as CustomEvent<SiteMusicPayload & { type?: string }>).detail;
      if (!d || d.type !== "site_music_updated") return;
      const tracks = Array.isArray(d.tracks) ? d.tracks : [];
      const mode: MusicPlaybackMode =
        String(d.music_playback_mode || "").trim().toLowerCase() === "shuffle" ? "shuffle" : "sequential";
      setPayload({
        music_enabled: !!d.music_enabled,
        music_default_volume: Math.max(0, Math.min(100, Math.floor(Number(d.music_default_volume) || 35))),
        music_playback_mode: mode,
        tracks,
      });
      trackIdxRef.current = 0;
      shuffleOrderRef.current = tracks.length > 1 ? shuffleIndices(tracks.length) : tracks.length === 1 ? [0] : [];
      shufflePosRef.current = 0;
    };
    window.addEventListener(AB_USER_WS_EVENT, onWs as EventListener);
    return () => window.removeEventListener(AB_USER_WS_EVENT, onWs as EventListener);
  }, []);

  const advanceToNextTrack = useCallback(
    (len: number) => {
      if (len <= 1) {
        trackIdxRef.current = 0;
        return;
      }
      if (payload.music_playback_mode === "shuffle") {
        if (shuffleOrderRef.current.length !== len) {
          shuffleOrderRef.current = shuffleIndices(len);
          shufflePosRef.current = 0;
        }
        shufflePosRef.current = (shufflePosRef.current + 1) % len;
        trackIdxRef.current = shuffleOrderRef.current[shufflePosRef.current] ?? 0;
        return;
      }
      trackIdxRef.current = (trackIdxRef.current + 1) % len;
    },
    [payload.music_playback_mode],
  );

  const playCurrent = useCallback(async () => {
    const audio = audioRef.current;
    const tracks = payload.tracks;
    if (!audio || !tracks.length || !shouldPlay) {
      setIsPlaying(false);
      return;
    }
    const idx = trackIdxRef.current % tracks.length;
    const track = tracks[idx];
    if (!track?.file_url) return;
    const target = track.file_url.startsWith("http") ? track.file_url : track.file_url;
    const currentSrc = audio.currentSrc || audio.src;
    const needsNewSrc = !currentSrc.endsWith(target);
    if (needsNewSrc) {
      audio.src = target;
      audio.load();
    }
    audio.volume = Math.max(0, Math.min(1, payload.music_default_volume / 100));
    try {
      await audio.play();
      setIsPlaying(true);
      setNeedsGesture(false);
    } catch {
      setIsPlaying(false);
      setNeedsGesture(true);
    }
  }, [payload.tracks, payload.music_default_volume, shouldPlay]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!shouldPlay) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    void playCurrent();
  }, [shouldPlay, playCurrent, payload.tracks, payload.music_default_volume, payload.music_playback_mode]);

  useEffect(() => {
    const len = payload.tracks.length;
    if (len > 1) {
      shuffleOrderRef.current = shuffleIndices(len);
      shufflePosRef.current = 0;
      if (payload.music_playback_mode === "shuffle") {
        trackIdxRef.current = shuffleOrderRef.current[0] ?? 0;
      }
    } else {
      trackIdxRef.current = 0;
      shuffleOrderRef.current = len === 1 ? [0] : [];
      shufflePosRef.current = 0;
    }
  }, [payload.tracks, payload.music_playback_mode]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      const len = payload.tracks.length;
      if (!len) return;
      advanceToNextTrack(len);
      void playCurrent();
    };
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [payload.tracks, playCurrent, advanceToNextTrack]);

  const toggleUserMusic = useCallback(() => {
    if (!userOff && !isPlaying && shouldPlay) {
      trackIdxRef.current = 0;
      void playCurrent();
      return;
    }
    setUserOff((prev) => {
      const next = !prev;
      writeUserOff(next);
      if (!next) {
        trackIdxRef.current = 0;
        void playCurrent();
      } else {
        audioRef.current?.pause();
        setIsPlaying(false);
      }
      return next;
    });
  }, [userOff, isPlaying, shouldPlay, playCurrent]);

  const value = useMemo<SiteMusicContextValue>(
    () => ({
      available: loaded && available,
      userOff,
      isPlaying: shouldPlay && isPlaying,
      toggleUserMusic,
      refresh,
    }),
    [loaded, available, userOff, shouldPlay, isPlaying, toggleUserMusic, refresh],
  );

  return (
    <SiteMusicContext.Provider value={value}>
      <audio ref={audioRef} preload="auto" className="ab-site-music-audio" aria-hidden="true" />
      {needsGesture && shouldPlay ? (
        <span className="ab-site-music-sr" aria-live="polite">
          Нажмите иконку музыки, чтобы включить звук
        </span>
      ) : null}
      {children}
    </SiteMusicContext.Provider>
  );
}

export function useSiteMusic(): SiteMusicContextValue {
  const ctx = useContext(SiteMusicContext);
  if (!ctx) {
    return {
      available: false,
      userOff: true,
      isPlaying: false,
      toggleUserMusic: () => {},
      refresh: async () => {},
    };
  }
  return ctx;
}
