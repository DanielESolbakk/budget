import type { Session } from "electron";

/**
 * URL patterns permitted through the outbound network guard.
 *
 * These cover the internal Electron renderer loading paths and the optional
 * local development renderer URL.  Everything else — in particular any
 * external HTTP/HTTPS host — is blocked to preserve the local-first privacy
 * posture of the application.
 */
const ALLOWED_URL_PATTERNS: RegExp[] = [
  /^devtools:/,
  /^chrome-extension:/,
  /^https?:\/\/localhost(:\d+)?(\/|$)/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?(\/|$)/,
];

function isLocalFileUrl(url: string): boolean {
  if (!url.toLowerCase().startsWith("file://")) return false;

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "file:" &&
      (parsedUrl.hostname === "" || parsedUrl.hostname.toLowerCase() === "localhost");
  } catch {
    return false;
  }
}

/**
 * Returns `true` when the given URL is permitted through the outbound network
 * guard.  External HTTP/HTTPS requests return `false`.
 *
 * This function is kept pure so it can be unit-tested without an Electron
 * session.
 */
export function isUrlPermitted(url: string): boolean {
  return isLocalFileUrl(url) || ALLOWED_URL_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * Installs a session-level outbound network guard on the provided Electron
 * `Session` instance.  Any HTTP/HTTPS request to an external host is
 * cancelled before it is sent.
 *
 * Permitted request targets:
 *   - local `file://`        — renderer HTML and bundled static assets
 *   - `devtools://`          — Chrome DevTools internal frames
 *   - `chrome-extension://`  — extension runtime URLs
 *   - `localhost` / `127.0.0.1` — local development renderer (Vite dev server)
 *
 * Blocked request targets:
 *   - Any HTTP or HTTPS URL pointing to an external hostname
 *
 * Call this function once, after `app.whenReady()` resolves, before the first
 * `BrowserWindow` is created so the guard is active from the first renderer
 * load.
 */
export function installNetworkGuard(session: Session): void {
  session.webRequest.onBeforeRequest((details, callback) => {
    if (isUrlPermitted(details.url)) {
      callback({});
    } else {
      callback({ cancel: true });
    }
  });
}
