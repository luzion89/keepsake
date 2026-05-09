/**
 * #202 / #134 — beforeinstallprompt hook
 *
 * Captures the browser install prompt so the app can show a custom
 * "Install to Home Screen" button in Settings.
 *
 * Chrome fires beforeinstallprompt when PWA is installable and has
 * NOT yet been installed. We preventDefault() to suppress the mini-
 * infobar and store the event for manual trigger.
 */

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let _deferred: BeforeInstallPromptEvent | null = null;

export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState<boolean>(!!_deferred);
  const [isStandalone] = useState<boolean>(
    typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches,
  );

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      _deferred = e as BeforeInstallPromptEvent;
      console.log('[PWA] beforeinstallprompt captured ✅', e);
      setCanInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const promptInstall = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!_deferred) {
      console.warn('[PWA] promptInstall: no deferred event — browser may not support install or already installed');
      return 'unavailable';
    }
    await _deferred.prompt();
    const { outcome } = await _deferred.userChoice;
    console.log('[PWA] install userChoice:', outcome);
    if (outcome === 'accepted') {
      _deferred = null;
      setCanInstall(false);
    }
    return outcome;
  };

  return { canInstall, isStandalone, promptInstall };
}
