import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkLink, createPageFetcher, fetchPublicPage, isPublicAddress, type PagePolicy } from "../../src/meals/page-fetcher.js";

const PAGE = "<html><body>Rezept</body></html>";
const SMALL_LIMIT = 1000;

// A page server on this machine, reached by name so the address check runs on every connection.
const pages: Record<string, (send: (status: number, headers: Record<string, string>, body?: Buffer | string) => void) => void> = {
  "/page": (send) => send(200, { "content-type": "text/html" }, PAGE),
  "/moved": (send) => send(301, { location: "/page" }),
  "/gzip": (send) => send(200, { "content-encoding": "gzip" }, gzipSync(PAGE)),
  "/deflate": (send) => send(200, { "content-encoding": "deflate" }, deflateSync(PAGE)),
  "/br": (send) => send(200, { "content-encoding": "br" }, brotliCompressSync(PAGE)),
  "/broken-gzip": (send) => send(200, { "content-encoding": "gzip" }, "not gzip at all"),
  "/huge": (send) => send(200, {}, "x".repeat(SMALL_LIMIT * 5)),
  "/missing": (send) => send(404, {}, "Not found"),
  "/loop": (send) => send(302, { location: "/loop" }),
  "/to-https": (send) => send(302, { location: "https://localhost/page" }),
};

describe("page fetcher", () => {
  let server: Server;
  let base: string;
  const onThisMachine: PagePolicy = {
    protocol: "http:",
    request: httpRequest,
    isAllowedAddress: () => true,
    isAllowedPort: () => true,
    maxPageBytes: SMALL_LIMIT,
  };
  const fetchLocal = createPageFetcher(onThisMachine);

  beforeAll(async () => {
    server = createServer((request, response) => {
      const page = pages[request.url ?? ""] ?? pages["/missing"];
      page((status, headers, body) => response.writeHead(status, headers).end(body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it.each([
    ["8.8.8.8", true],
    ["2a00:1450:400a:800::200e", true],
    ["127.0.0.1", false],
    ["10.1.2.3", false],
    ["172.20.0.5", false],
    ["192.168.1.1", false],
    ["169.254.169.254", false],
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["::1", false],
    ["fd00::1", false],
    ["fe80::1", false],
    ["::ffff:127.0.0.1", false],
    ["not an address", false],
  ])("treats %s as public: %s", (address, isPublic) => {
    expect(isPublicAddress(address)).toBe(isPublic);
  });

  it.each([
    "http://example.com/recipe",
    "https://example.com:8443/recipe",
    "https://user:secret@example.com/recipe",
    "https://127.0.0.1/recipe",
    "https://[::1]/recipe",
    "ftp://example.com/recipe",
    "not a link",
  ])("refuses %s before connecting", (link) => {
    expect(() => checkLink(link)).toThrow(expect.objectContaining({ reason: "invalid-link" }));
  });

  it("refuses a name that resolves to this machine", async () => {
    await expect(fetchPublicPage("https://localhost/recipe")).rejects.toMatchObject({ reason: "invalid-link" });
    const nothingAllowed = createPageFetcher({ ...onThisMachine, isAllowedAddress: () => false });
    await expect(nothingAllowed(`${base}/page`)).rejects.toMatchObject({ reason: "invalid-link" });
  });

  it("follows redirects and reads compressed pages", async () => {
    expect(await fetchLocal(`${base}/moved`)).toBe(PAGE);
    expect(await fetchLocal(`${base}/gzip`)).toBe(PAGE);
    expect(await fetchLocal(`${base}/deflate`)).toBe(PAGE);
    expect(await fetchLocal(`${base}/br`)).toBe(PAGE);
  });

  it("cuts a long page off at the limit", async () => {
    expect(await fetchLocal(`${base}/huge`)).toHaveLength(SMALL_LIMIT);
  });

  it("gives up on missing pages, endless redirects, broken bodies and names that don't exist", async () => {
    await expect(fetchLocal(`${base}/missing`)).rejects.toMatchObject({ reason: "unreachable" });
    await expect(fetchLocal(`${base}/loop`)).rejects.toMatchObject({ reason: "unreachable" });
    await expect(fetchLocal(`${base}/broken-gzip`)).rejects.toMatchObject({ reason: "unreachable" });
    await expect(fetchLocal("http://no-such-host.invalid/page")).rejects.toMatchObject({ reason: "unreachable" });
  });

  it("checks where a redirect leads, too", async () => {
    await expect(fetchLocal(`${base}/to-https`)).rejects.toMatchObject({ reason: "invalid-link" });
  });
});
