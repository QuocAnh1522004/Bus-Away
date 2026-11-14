/**
 * Ad-network glue, written from the public specs (MRAID 2/3, Meta FbPlayableAd, ironSource dapi,
 * Google ExitApi, Mintegral gameEnd/install). One `openStore()` for every network.
 */
type Mraid = {
  getState?: () => string;
  isViewable?: () => boolean;
  addEventListener?: (ev: string, cb: (...a: unknown[]) => void) => void;
  open?: (url: string) => void;
};

declare global {
  interface Window {
    mraid?: Mraid;
    FbPlayableAd?: { onCTAClick?: () => void };
    ExitApi?: { exit?: () => void };
    dapi?: { openStoreUrl?: () => void; isReady?: () => boolean; addEventListener?: (ev: string, cb: (...a: unknown[]) => void) => void };
    install?: () => void;
    gameEnd?: () => void;
    gameReady?: () => void;
  }
}

export const STORE = {
  android: 'https://play.google.com/store/apps/details?id=com.ig.busybus', // "Bus Away" by iKame Games
  // No iOS listing found yet (Nov 2026). Until one exists, iOS users land on the Play page too.
  // Put the App Store URL here when the app is published.
  ios: '',
};

export function openStore() {
  const url = (/iphone|ipad|ipod|macintosh/i.test(navigator.userAgent) && STORE.ios) || STORE.android;
  try {
    if (typeof window.install === 'function') return window.install(); // Mintegral
    if (window.FbPlayableAd?.onCTAClick) return window.FbPlayableAd.onCTAClick(); // Meta
    if (window.dapi?.openStoreUrl) return window.dapi.openStoreUrl(); // ironSource
    if (window.ExitApi?.exit) return window.ExitApi.exit(); // Google Ads
    if (window.mraid?.open) return window.mraid.open(url); // AppLovin / Unity / generic MRAID
  } catch {
    /* fall through to window.open */
  }
  window.open(url, '_blank');
}

export function notifyGameEnd() {
  try {
    window.gameEnd?.();
  } catch {
    /* ignore */
  }
}

/** Resolve once the container says the ad may run (MRAID ready + viewable), else immediately. */
export function whenAdReady(): Promise<void> {
  const m = window.mraid;
  if (!m?.getState) return Promise.resolve();
  return new Promise((resolve) => {
    const viewable = () => {
      if (!m.isViewable || m.isViewable()) resolve();
      else m.addEventListener?.('viewableChange', (v) => v && resolve());
    };
    if (m.getState?.() === 'loading') m.addEventListener?.('ready', viewable);
    else viewable();
  });
}

/** Pause hook: MRAID viewability + page visibility. */
export function onVisibilityChange(cb: (visible: boolean) => void) {
  document.addEventListener('visibilitychange', () => cb(!document.hidden));
  window.mraid?.addEventListener?.('viewableChange', (v) => cb(Boolean(v)));
}
