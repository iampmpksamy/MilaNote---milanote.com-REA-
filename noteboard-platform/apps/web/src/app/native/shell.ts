/**
 * Start-up glue for the native apps, loaded only inside them (never in the browser bundle's
 * start-up path): Back button, status bar, haptics, clipboard and things shared into the app.
 */
import { platform } from './platform';

type W = Window & {
  nbHaptic?: () => void;
  nbClipboard?: { writeText(t: string): Promise<void>; read(): Promise<{ text?: string; image?: Blob } | null> };
};

/** Delivers shared content to the boards once they are open (they may still be loading). */
function deliverShare(detail: { text?: string; files?: File[] }): void {
  let tries = 0;
  const attempt = () => {
    const taken = !window.dispatchEvent(new CustomEvent('nb-share-in', { detail, cancelable: true }));
    if (!taken && tries++ < 60) setTimeout(attempt, 500);
  };
  attempt();
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: m[1] });
}

export async function startNativeShell(): Promise<void> {
  const p = platform();
  const w = window as W;
  if (p === 'android' || p === 'ios') {
    const [{ App }, { Haptics, ImpactStyle }, { Clipboard }, { StatusBar, Style }, { Keyboard }] = await Promise.all([
      import('@capacitor/app'),
      import('@capacitor/haptics'),
      import('@capacitor/clipboard'),
      import('@capacitor/status-bar'),
      import('@capacitor/keyboard'),
    ]);

    w.nbHaptic = () => void Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
    w.nbClipboard = {
      writeText: (t) => Clipboard.write({ string: t }),
      read: async () => {
        const r = await Clipboard.read();
        if (r.type?.startsWith('image/') || r.value.startsWith('data:image/')) {
          const b = dataUrlToBlob(r.value);
          return b ? { image: b } : null;
        }
        return r.value ? { text: r.value } : null;
      },
    };

    // Android Back: close what's open, go up a board, then a page back, then leave the app.
    await App.addListener('backButton', () => {
      const handled = !window.dispatchEvent(new Event('nb-back', { cancelable: true }));
      if (handled) return;
      if (location.pathname !== '/' && history.length > 1) history.back();
      else void App.minimizeApp();
    });

    // Back in the foreground: fetch other devices' changes and send ours.
    await App.addListener('resume', () => window.dispatchEvent(new Event('nb-resume')));

    // Status bar follows the light/dark theme.
    const paint = () => {
      const dark = document.documentElement.classList.contains('nb-dark');
      void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
      if (p === 'android') void StatusBar.setBackgroundColor({ color: dark ? '#272727' : '#ffffff' }).catch(() => undefined);
    };
    paint();
    new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // The keyboard's accessory bar isn't needed (the note toolbar has the buttons).
    if (p === 'ios') void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => undefined);

    // Things shared to Noteboard from other apps (Android share sheet).
    if (p === 'android') {
      const { registerPlugin } = await import('@capacitor/core');
      interface Shared {
        text?: string;
        files?: { name: string; type: string; data: string }[];
      }
      const ShareIn = registerPlugin<{
        takePending(): Promise<Shared>;
        addListener(e: 'shared', cb: (s: Shared) => void): Promise<{ remove(): Promise<void> }>;
      }>('NoteboardShareIn');
      const take = (s: Shared) => {
        const files = (s.files ?? []).map((f) => {
          const blob = dataUrlToBlob(`data:${f.type};base64,${f.data}`);
          return blob ? new File([blob], f.name, { type: f.type }) : null;
        });
        if (s.text || files.length) deliverShare({ text: s.text, files: files.filter((f): f is File => !!f) });
      };
      await ShareIn.addListener('shared', take).catch(() => undefined);
      const pending = await ShareIn.takePending().catch(() => null);
      if (pending) take(pending);
    }
  }

  if (p === 'windows') {
    // Windows: the window title follows the app; files dropped on the window are handled by the
    // board's own drop handler (the webview passes them through).
    w.nbHaptic = () => undefined;
  }
}
