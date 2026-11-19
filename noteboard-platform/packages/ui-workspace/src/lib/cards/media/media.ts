/**
 * Helpers shared by the audio and video cards: time labels, file names, one player at a time,
 * recording formats, reading a file's length/size before it is stored, and video links.
 */

/** 75.4 → "1:15", 3725 → "1:02:05"; unknown lengths show "0:00". */
export function formatTime(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** "Interview take 2.final.mp3" → "Interview take 2.final" (a file's name as a title). */
export function titleFromFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).trim().slice(0, 200);
}

const EXT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/ogg': 'ogv',
};

/** The extension to store a file under: from its name when it has one, otherwise from its type. */
export function extensionFor(fileName: string, mime: string): string {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(fileName)?.[1];
  if (fromName) return fromName.toLowerCase();
  return EXT_BY_MIME[mime.split(';')[0].trim().toLowerCase()] ?? 'bin';
}

/** The recording format to ask for: the first one this browser can make (null = its default). */
export function pickRecordingType(isSupported: (t: string) => boolean): string | null {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg']) {
    try {
      if (isSupported(t)) return t;
    } catch {
      /* some browsers throw for types they don't know */
    }
  }
  return null;
}

/** "Voice note 20 Nov, 14:05" */
export function voiceNoteTitle(at = new Date()): string {
  const d = at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const t = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `Voice note ${d}, ${t}`;
}

// ---------- one player at a time ----------

let current: HTMLMediaElement | null = null;

/** Call when a player starts: any other card that is playing pauses. */
export function claimPlayback(el: HTMLMediaElement): void {
  if (current && current !== el && !current.paused) current.pause();
  current = el;
}

/** Call when a player goes away. */
export function releasePlayback(el: HTMLMediaElement): void {
  if (current === el) current = null;
}

/** Stops whatever card is playing (e.g. before a YouTube or Vimeo player starts). */
export function pauseAll(): void {
  if (current && !current.paused) current.pause();
}

// ---------- reading a file before it is stored ----------

export interface MediaInfo {
  duration: number;
  width: number;
  height: number;
}

/**
 * Reads the length (and picture size) of an audio or video file. Gives zeros when the browser
 * can't tell in time (some recordings only know their length once played to the end).
 */
export function probeMedia(blob: Blob, kind: 'audio' | 'video', timeoutMs = 4000): Promise<MediaInfo> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return resolve({ duration: 0, width: 0, height: 0 });
    const el = document.createElement(kind);
    const url = URL.createObjectURL(blob);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const duration = Number.isFinite(el.duration) ? el.duration : 0;
      const v = el as HTMLVideoElement;
      resolve({ duration, width: v.videoWidth || 0, height: v.videoHeight || 0 });
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
    };
    const timer = setTimeout(finish, timeoutMs);
    el.preload = 'metadata';
    el.muted = true;
    el.onloadedmetadata = finish;
    el.onerror = finish;
    el.src = url;
  });
}

// ---------- video links ----------

export interface VideoLink {
  provider: 'YouTube' | 'Vimeo';
  id: string;
  /** The player address (privacy-friendly YouTube domain; Vimeo without tracking). */
  embed: string;
}

/** "1h2m3s", "90s", "90" → seconds (0 when it can't be read). */
function seconds(t: string | null): number {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

/** A web address as typed (with or without https://), or null when it isn't an http(s) one. */
export function parseWebUrl(raw: string): URL | null {
  const t = raw.trim();
  if (!t || /\s/.test(t)) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`);
    const host = u.hostname;
    return (u.protocol === 'https:' || u.protocol === 'http:') && (host.includes('.') || host === 'localhost') ? u : null;
  } catch {
    return null;
  }
}

/**
 * Recognises YouTube (watch, youtu.be, shorts, live, embed) and Vimeo links and gives the player
 * address for them; anything else is null (the card then shows it as a plain link).
 */
export function parseVideoLink(raw: string): VideoLink | null {
  const u = parseWebUrl(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  const YT_ID = /^[A-Za-z0-9_-]{11}$/;
  let yt: string | undefined;
  if (host === 'youtu.be') yt = parts[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (parts[0] === 'watch') yt = u.searchParams.get('v') ?? undefined;
    else if (['shorts', 'live', 'embed', 'v', 'e'].includes(parts[0])) yt = parts[1];
  }
  if (yt && YT_ID.test(yt)) {
    const start = seconds(u.searchParams.get('t') ?? u.searchParams.get('start'));
    return { provider: 'YouTube', id: yt, embed: `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0${start ? `&start=${start}` : ''}` };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    // vimeo.com/123, vimeo.com/123/abcdef (unlisted), vimeo.com/channels/x/123, player.vimeo.com/video/123
    const i = parts.findIndex((p) => /^\d{1,12}$/.test(p));
    if (i < 0) return null;
    const id = parts[i];
    const hash = u.searchParams.get('h') ?? (/^[0-9a-f]{6,20}$/i.test(parts[i + 1] ?? '') ? parts[i + 1] : null);
    return { provider: 'Vimeo', id, embed: `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1${hash ? `&h=${encodeURIComponent(hash)}` : ''}` };
  }
  return null;
}

/** "https://www.example.com/a?b" → "example.com" */
export function domainOf(raw: string): string {
  return parseWebUrl(raw)?.hostname.replace(/^www\./, '') ?? '';
}
