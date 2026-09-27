/**
 * Query loader state: counts backend calls in flight.
 *
 * The overlay shows up only if a call takes longer than SHOW_DELAY, so quick
 * queries don't flash it, and stays at least MIN_VISIBLE so it doesn't blink.
 */
const SHOW_DELAY = 200;
const MIN_VISIBLE = 300;

export const loader = $state({ visible: false });

let pending = 0;
let showTimer = null;
let shownAt = 0;

function start() {
    if (pending++ > 0) return;
    showTimer = setTimeout(() => {
        loader.visible = true;
        shownAt = Date.now();
    }, SHOW_DELAY);
}

function stop() {
    if (--pending > 0) return;
    clearTimeout(showTimer);
    if (!loader.visible) return;
    const left = MIN_VISIBLE - (Date.now() - shownAt);
    setTimeout(() => {
        if (pending === 0) loader.visible = false;
    }, Math.max(0, left));
}

/** Shows the loader while the promise is pending; returns the same result. */
export function track(promise) {
    if (!promise || typeof promise.then !== 'function') return promise;
    start();
    return promise.finally(stop);
}
