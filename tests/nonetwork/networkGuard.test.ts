import { describe, expect, it } from "vitest";
import { isUrlPermitted } from "../../electron/networkGuard.js";

describe("network guard — isUrlPermitted", () => {
  // -------------------------------------------------------------------------
  // Permitted URLs
  // -------------------------------------------------------------------------

  it("permits local file:// URLs used by the renderer for bundled assets", () => {
    expect(isUrlPermitted("file:///app/out/renderer/index.html")).toBe(true);
    expect(isUrlPermitted("file:///C:/app/out/renderer/index.html")).toBe(true);
    expect(isUrlPermitted("file://localhost/C:/app/out/renderer/index.html")).toBe(true);
  });

  it("blocks file:// URLs that target Windows UNC network shares", () => {
    expect(isUrlPermitted("file://server/share/out/renderer/index.html")).toBe(false);
    expect(isUrlPermitted("file://192.168.1.20/share/out/renderer/index.html")).toBe(false);
  });

  it("permits devtools:// URLs for Chrome DevTools internal frames", () => {
    expect(isUrlPermitted("devtools://devtools/bundled/devtools_app.html")).toBe(true);
  });

  it("permits chrome-extension:// URLs for extension runtime usage", () => {
    expect(isUrlPermitted("chrome-extension://fmkadmapgofadopljbjfkapdkoienihi/index.html")).toBe(true);
  });

  it("permits http://localhost for local development renderer", () => {
    expect(isUrlPermitted("http://localhost/")).toBe(true);
    expect(isUrlPermitted("http://localhost:5173/")).toBe(true);
    expect(isUrlPermitted("http://localhost:3000/src/renderer/index.html")).toBe(true);
  });

  it("permits https://localhost for local development renderer over TLS", () => {
    expect(isUrlPermitted("https://localhost/")).toBe(true);
    expect(isUrlPermitted("https://localhost:8443/")).toBe(true);
  });

  it("permits http://127.0.0.1 loopback URLs", () => {
    expect(isUrlPermitted("http://127.0.0.1/")).toBe(true);
    expect(isUrlPermitted("http://127.0.0.1:5173/")).toBe(true);
  });

  it("permits https://127.0.0.1 loopback URLs over TLS", () => {
    expect(isUrlPermitted("https://127.0.0.1:8443/")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Blocked URLs
  // -------------------------------------------------------------------------

  it("blocks external HTTP URLs", () => {
    expect(isUrlPermitted("http://example.com/")).toBe(false);
    expect(isUrlPermitted("http://api.budget-service.io/transactions")).toBe(false);
    expect(isUrlPermitted("http://telemetry.vendor.com/collect")).toBe(false);
  });

  it("blocks external HTTPS URLs", () => {
    expect(isUrlPermitted("https://example.com/")).toBe(false);
    expect(isUrlPermitted("https://api.budget-service.io/transactions")).toBe(false);
    expect(isUrlPermitted("https://fonts.googleapis.com/css")).toBe(false);
  });

  it("blocks URLs that embed localhost as a subdomain of an external host", () => {
    // 'localhost.example.com' must not match the localhost pattern.
    expect(isUrlPermitted("https://localhost.example.com/")).toBe(false);
  });

  it("blocks URLs that embed 127.0.0.1 in a path fragment", () => {
    // '127.0.0.1.evil.com' must not match the loopback pattern.
    expect(isUrlPermitted("https://127.0.0.1.evil.com/")).toBe(false);
  });

  it("blocks URLs to well-known CDNs and analytics endpoints", () => {
    expect(isUrlPermitted("https://cdn.jsdelivr.net/npm/react/index.js")).toBe(false);
    expect(isUrlPermitted("https://www.google-analytics.com/collect")).toBe(false);
  });
});
