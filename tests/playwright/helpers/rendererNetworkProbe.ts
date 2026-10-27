import type { Page } from "@playwright/test";

interface RendererNetworkState {
  __budgetRendererNetworkAttempts?: string[];
  __budgetRendererNetworkBlockedAttempts?: string[];
}

export interface RendererNetworkAttemptObservation {
  httpRequests: string[];
  webSocketRequests: string[];
}

export async function installRendererNetworkAttemptBlocker(
  page: Page
): Promise<void> {
  await page.evaluate(() => {
    const state = window as Window & RendererNetworkState;
    state.__budgetRendererNetworkBlockedAttempts = [];

    function externalTarget(value: string | URL | Request): string | null {
      try {
        const rawTarget = value instanceof Request
          ? value.url
          : value instanceof URL
            ? value.href
            : value;
        const target = new URL(rawTarget, window.location.href);
        if (
          target.origin === window.location.origin ||
          !["http:", "https:", "ws:", "wss:"].includes(target.protocol)
        ) {
          return null;
        }
        return target.href;
      } catch {
        return null;
      }
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const target = externalTarget(input);
      if (target !== null) {
        state.__budgetRendererNetworkBlockedAttempts?.push(target);
        return Promise.reject(new TypeError("External renderer requests are blocked in this test."));
      }
      return originalFetch(input, init);
    };

    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      isAsync?: boolean,
      username?: string | null,
      password?: string | null
    ): void {
      const target = externalTarget(url);
      if (target !== null) {
        state.__budgetRendererNetworkBlockedAttempts?.push(target);
        throw new DOMException("External renderer requests are blocked in this test.", "NetworkError");
      }
      originalXhrOpen.call(this, method, url, isAsync ?? true, username, password);
    };

    const NativeWebSocket = window.WebSocket;
    const blockedWebSocket = function (
      url: string | URL,
      protocols?: string | string[]
    ): WebSocket {
      const target = externalTarget(url);
      if (target !== null) {
        state.__budgetRendererNetworkBlockedAttempts?.push(target);
        throw new DOMException("External renderer requests are blocked in this test.", "NetworkError");
      }
      return protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
    };
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: blockedWebSocket,
      writable: true,
    });
  });
}

export async function installRendererNetworkAttemptObserver(
  page: Page
): Promise<RendererNetworkAttemptObservation> {
  const httpRequests: string[] = [];
  const webSocketRequests: string[] = [];

  page.on("request", (request) => {
    if (/^https?:\/\//i.test(request.url())) {
      httpRequests.push(request.url());
    }
  });
  page.on("websocket", (webSocket) => {
    if (/^wss?:\/\//i.test(webSocket.url())) {
      webSocketRequests.push(webSocket.url());
    }
  });

  await page.evaluate(() => {
    const state = window as Window & RendererNetworkState;
    state.__budgetRendererNetworkAttempts = [];

    function externalTarget(value: string | URL | Request): string | null {
      try {
        const rawTarget = value instanceof Request
          ? value.url
          : value instanceof URL
            ? value.href
            : value;
        const target = new URL(rawTarget, window.location.href);
        if (
          target.origin === window.location.origin ||
          !["http:", "https:", "ws:", "wss:"].includes(target.protocol)
        ) {
          return null;
        }
        return target.href;
      } catch {
        return null;
      }
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const target = externalTarget(input);
      if (target !== null) {
        state.__budgetRendererNetworkAttempts?.push(target);
      }
      return originalFetch(input, init);
    };

    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      isAsync?: boolean,
      username?: string | null,
      password?: string | null
    ): void {
      const target = externalTarget(url);
      if (target !== null) {
        state.__budgetRendererNetworkAttempts?.push(target);
      }
      originalXhrOpen.call(this, method, url, isAsync ?? true, username, password);
    };

    const NativeWebSocket = window.WebSocket;
    const observedWebSocket = function (
      url: string | URL,
      protocols?: string | string[]
    ): WebSocket {
      const target = externalTarget(url);
      if (target !== null) {
        state.__budgetRendererNetworkAttempts?.push(target);
      }
      return protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
    };
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: observedWebSocket,
      writable: true,
    });
  });

  return { httpRequests, webSocketRequests };
}

export async function rendererNetworkBlockedAttempts(page: Page): Promise<string[]> {
  const attempts = await page.evaluate(() =>
    (window as Window & RendererNetworkState).__budgetRendererNetworkBlockedAttempts
  );
  if (attempts === undefined) {
    throw new Error("Renderer network attempt blocker was not installed.");
  }
  return attempts;
}

export async function rendererNetworkAttempts(page: Page): Promise<string[]> {
  const attempts = await page.evaluate(() =>
    (window as Window & RendererNetworkState).__budgetRendererNetworkAttempts
  );
  if (attempts === undefined) {
    throw new Error("Renderer network attempt observer was not installed.");
  }
  return attempts;
}
