/**
 * Telegram Mini App integration.
 * Uses window.Telegram.WebApp directly (loaded via script tag in index.html).
 * Falls back gracefully in dev mode outside Telegram.
 */

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

interface TelegramWebApp {
  ready(): void;
  expand(): void;
  close(): void;
  isExpanded: boolean;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  initDataUnsafe: { start_param?: string; user?: { id: number; first_name: string; username?: string } };
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  BackButton: { show(): void; hide(): void; isVisible: boolean; onClick(cb: () => void): void; offClick(cb: () => void): void };
  MainButton: { text: string; isVisible: boolean; show(): void; hide(): void; setText(t: string): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
  version: string;
  platform: string;
}

export const tg: TelegramWebApp | null = (window as Window).Telegram?.WebApp ?? null;

export function initTelegram(): void {
  if (!tg) {
    console.warn('[Telegram] Dev mode — running outside Telegram');
    return;
  }
  tg.ready();
  tg.expand();
  applyTelegramTheme();
  tg.onEvent('themeChanged', applyTelegramTheme);
}

/** Read ticker from ?ticker= query param or Telegram startParam deep link */
export function getInitialTicker(fallback = 'ALAB'): string {
  const fromUrl = new URLSearchParams(window.location.search).get('ticker');
  if (fromUrl) return fromUrl.toUpperCase();
  const startParam = tg?.initDataUnsafe?.start_param;
  if (startParam) return startParam.toUpperCase();
  return fallback;
}

/** Apply Telegram theme palette to our CSS variables */
export function applyTelegramTheme(): void {
  if (!tg?.themeParams) return;
  const tp = tg.themeParams;
  const root = document.documentElement;
  if (tp.bg_color) root.style.setProperty('--bg', tp.bg_color);
  if (tp.secondary_bg_color) root.style.setProperty('--bg-card', tp.secondary_bg_color);
  if (tp.text_color) root.style.setProperty('--text', tp.text_color);
  if (tp.hint_color) {
    root.style.setProperty('--text-hint', tp.hint_color);
    root.style.setProperty('--text-secondary', tp.hint_color);
  }
  if (tp.link_color) {
    root.style.setProperty('--accent', tp.link_color);
    root.style.setProperty('--blue', tp.link_color);
  }
  document.body.dataset.theme = tg.colorScheme ?? 'dark';
}

export function hapticFeedback(type: 'light' | 'medium' | 'heavy' = 'light'): void {
  tg?.HapticFeedback?.impactOccurred(type);
}

export function hapticSuccess(): void {
  tg?.HapticFeedback?.notificationOccurred('success');
}

export function hapticError(): void {
  tg?.HapticFeedback?.notificationOccurred('error');
}

export function showBackButton(cb: () => void): void {
  if (!tg?.BackButton) return;
  tg.BackButton.onClick(cb);
  tg.BackButton.show();
}

export function hideBackButton(cb: () => void): void {
  if (!tg?.BackButton) return;
  tg.BackButton.offClick(cb);
  tg.BackButton.hide();
}
