/**
 * Telegram Mini App SDK initialization.
 * Wrapped in try-catch for dev mode outside Telegram.
 */
export async function initTelegram() {
  try {
    const { init, miniApp, themeParams } = await import('@telegram-apps/sdk-react');
    await init();
    miniApp.ready();
    if (themeParams.mountSync) {
      themeParams.mountSync();
    }
    return { miniApp, themeParams };
  } catch (e) {
    console.warn('[Telegram SDK] Not running inside Telegram, using dev mode:', e);
    return null;
  }
}

export function hapticFeedback(type: 'light' | 'medium' | 'heavy' = 'light') {
  try {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.HapticFeedback) {
      tg.HapticFeedback.impactOccurred(type);
    }
  } catch {
    // noop outside Telegram
  }
}
