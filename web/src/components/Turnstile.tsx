// Cloudflare Turnstile widget — script is loaded once per page; the widget
// re-renders when the siteKey changes and reports tokens upward.
import { useEffect, useRef } from 'react';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    onNexorTurnstileLoad?: () => void;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    window.onNexorTurnstileLoad = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('turnstile failed to load'));
    };
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onNexorTurnstileLoad&render=explicit';
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error('turnstile script failed'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function Turnstile({
  siteKey,
  onToken,
  onExpire,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  onExpire?: () => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const tokenRef = useRef(onToken);
  const expireRef = useRef(onExpire);
  tokenRef.current = onToken;
  expireRef.current = onExpire;

  useEffect(() => {
    let cancelled = false;
    void loadTurnstile()
      .then((ts) => {
        if (cancelled || !holder.current || holder.current.childElementCount > 0) return;
        widgetId.current = ts.render(holder.current, {
          sitekey: siteKey,
          theme: 'dark',
          callback: (token: string) => tokenRef.current(token),
          'expired-callback': () => {
            tokenRef.current('');
            expireRef.current?.();
          },
          'error-callback': () => tokenRef.current(''),
        });
      })
      .catch(() => tokenRef.current(''));
    return () => {
      cancelled = true;
      if (widgetId.current != null) {
        try { window.turnstile?.remove(widgetId.current); } catch { /* ignore */ }
        widgetId.current = null;
      }
    };
  }, [siteKey]);

  return <div ref={holder} className="flex justify-center [&>iframe]:rounded-lg" />;
}
