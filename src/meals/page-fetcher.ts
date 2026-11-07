import { lookup, type LookupAddress } from "node:dns";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";

// Reads a public web page for the recipe import. The link comes from a person, so the server must never be
// talked into fetching something on its own network: only https on the standard port, and every address the
// name resolves to is checked right before connecting, also after a redirect.

export class PageFetchError extends Error {
  constructor(
    readonly reason: "invalid-link" | "unreachable",
    message: string,
  ) {
    super(message);
    this.name = "PageFetchError";
  }
}

export type FetchPage = (link: string) => Promise<string>;

// What the fetcher may reach and how. The app only ever uses PUBLIC_WEB; tests point it at a server on this machine.
export interface PagePolicy {
  protocol: "https:" | "http:";
  request: (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
  isAllowedAddress: (address: string) => boolean;
  isAllowedPort: (port: string) => boolean;
  maxPageBytes: number;
}

const DEFAULT_PORT = "";
const MAX_REDIRECTS = 3;
const TIMEOUT_MILLISECONDS = 8000;
// Recipe pages are large; the recipe data usually sits in the head, and more than this is never needed.
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_LINK_LENGTH = 2000;
const FIRST_REDIRECT_STATUS = 300;
const FIRST_ERROR_STATUS = 400;
const OK_STATUS = 200;
const USER_AGENT = "Collabitat recipe import (+https://github.com/fly-die/collabitat-api)";

const PRIVATE_RANGES: [string, number, "ipv4" | "ipv6"][] = [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.0.2.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["64:ff9b::", 96, "ipv6"],
  ["100::", 64, "ipv6"],
  ["2001:db8::", 32, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
];
const privateAddresses = new BlockList();
for (const [network, prefix, family] of PRIVATE_RANGES) {
  privateAddresses.addSubnet(network, prefix, family);
}
const IPV4_MAPPED_PREFIX = "::ffff:";

export function isPublicAddress(address: string) {
  const unmapped = address.toLowerCase().startsWith(IPV4_MAPPED_PREFIX) ? address.slice(IPV4_MAPPED_PREFIX.length) : address;
  const family = isIP(unmapped);
  if (family === 0) {
    return false;
  }
  return !privateAddresses.check(unmapped, family === 4 ? "ipv4" : "ipv6");
}

export const PUBLIC_WEB: PagePolicy = {
  protocol: "https:",
  request: httpsRequest,
  isAllowedAddress: isPublicAddress,
  isAllowedPort: (port) => port === DEFAULT_PORT,
  maxPageBytes: MAX_PAGE_BYTES,
};

const notOpenable = () => new PageFetchError("invalid-link", "That link can't be opened. Paste the link to a recipe page.");
const unreachable = () => new PageFetchError("unreachable", "Couldn't open that page. Check the link, or type the recipe in.");

// Resolves the name and refuses to connect if any of its addresses is not allowed.
const allowedOnlyLookup =
  (policy: PagePolicy): LookupFunction =>
  (hostname, options, callback) => {
    lookup(hostname, { all: true }, (error, addresses: LookupAddress[]) => {
      if (error) {
        callback(error, "", 0);
        return;
      }
      if (addresses.length === 0 || !addresses.every(({ address }) => policy.isAllowedAddress(address))) {
        callback(notOpenable(), "", 0);
        return;
      }
      if (options.all) {
        (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, addresses);
        return;
      }
      callback(null, addresses[0].address, addresses[0].family);
    });
  };

export function checkLink(link: string, policy: PagePolicy = PUBLIC_WEB, base?: URL) {
  let url: URL;
  try {
    url = new URL(link, base);
  } catch {
    throw notOpenable();
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    link.length > MAX_LINK_LENGTH ||
    url.protocol !== policy.protocol ||
    !policy.isAllowedPort(url.port) ||
    url.username !== "" ||
    url.password !== "" ||
    (isIP(hostname) !== 0 && !policy.isAllowedAddress(hostname))
  ) {
    throw notOpenable();
  }
  return url;
}

function decoded(response: IncomingMessage): Readable {
  switch (response.headers["content-encoding"]) {
    case "gzip":
      return response.pipe(createGunzip());
    case "deflate":
      return response.pipe(createInflate());
    case "br":
      return response.pipe(createBrotliDecompress());
    default:
      return response;
  }
}

// Reads up to the size limit; a longer page is cut off rather than refused.
function readBody(response: IncomingMessage, maxPageBytes: number) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const body = decoded(response);
    body.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= maxPageBytes) {
        response.destroy();
        body.destroy();
        resolve(Buffer.concat(chunks).subarray(0, maxPageBytes).toString("utf8"));
      }
    });
    body.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    body.on("error", () => reject(unreachable()));
  });
}

function get(url: URL, policy: PagePolicy) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const options: RequestOptions = {
      lookup: allowedOnlyLookup(policy),
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml", "accept-encoding": "gzip, deflate, br" },
      timeout: TIMEOUT_MILLISECONDS,
    };
    const outgoing = policy.request(url, options, resolve);
    outgoing.on("timeout", () => outgoing.destroy(unreachable()));
    outgoing.on("error", (error) => reject(error instanceof PageFetchError ? error : unreachable()));
    outgoing.end();
  });
}

export function createPageFetcher(policy: PagePolicy = PUBLIC_WEB): FetchPage {
  return async (link) => {
    let url = checkLink(link, policy);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await get(url, policy);
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= FIRST_REDIRECT_STATUS && status < FIRST_ERROR_STATUS && location) {
        response.resume();
        url = checkLink(location, policy, url);
        continue;
      }
      if (status < OK_STATUS || status >= FIRST_REDIRECT_STATUS) {
        response.resume();
        throw unreachable();
      }
      return readBody(response, policy.maxPageBytes);
    }
    throw unreachable();
  };
}

export const fetchPublicPage = createPageFetcher();
