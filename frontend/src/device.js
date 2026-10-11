/**
 * What kind of device the app runs on — checked in JS, so it works the same in the
 * desktop/mobile app (Wails) and in the web version opened in a phone's browser.
 *
 *   isMobileDevice() — a phone or a tablet: no "Full screen", no "Exit"
 *                      (phones manage windows and close apps themselves)
 *
 * Not by the screen width: a narrow desktop window is still a desktop.
 */
import { System, Browser } from '@wailsio/runtime';

let cached = null;

export function isMobileDevice() {
    if (cached != null) return cached;
    cached = detect();
    return cached;
}

function detect() {
    // the Wails app knows its platform (Android / iOS builds)
    try {
        if (System.IsMobile()) return true;
    } catch {
        // a plain browser: no Wails runtime
    }
    const nav = globalThis.navigator;
    if (!nav) return false;
    // Chromium: User-Agent Client Hints
    if (nav.userAgentData && typeof nav.userAgentData.mobile === 'boolean' && nav.userAgentData.mobile) return true;
    const ua = nav.userAgent ?? '';
    if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return true;
    // iPadOS 13+ says it is a Mac: a "Mac" with a touch screen is an iPad
    if (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return true;
    return false;
}

/**
 * Open a web link outside the app, in the system browser.
 *   Android: the app's own bridge (window.wails.openURL — WailsJSBridge.java), since Wails
 *            has no Android Browser.OpenURL and window.open does nothing in the WebView;
 *   desktop / iOS: Wails Browser.OpenURL; a plain browser (web version): a new tab.
 */
export function openExternal(url) {
    if (!url) return;
    const android = globalThis.window?.wails;
    if (android && typeof android.openURL === 'function') {
        android.openURL(String(url));
        return;
    }
    Browser.OpenURL(url).catch(() => window.open(url, '_blank', 'noopener'));
}
