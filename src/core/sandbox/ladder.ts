// Fetch ladder for ctx_index url. climbShell runs only when the page HTML has no readable text (a JavaScript shell).
import { safeFetch } from "./fetch.ts";

const ACCEPT_MARKDOWN = "text/markdown, text/x-markdown;q=0.9, text/html;q=0.8, application/xhtml+xml;q=0.8, */*;q=0.5";
// llms.txt is an index of links: a 50 MB one would split into millions of lines, and an entry past the first MB is
// not one a page's climb needs.
const LLMS_MAX_CHARS = 1 << 20;

export interface LadderHit {
  body: string;
  url: string;
}

/** '.md' candidates for a page path. The site root has no '.md' of its own, so it gets only index.md. */
export function mdSiblingUrls(pageUrl: string): string[] {
  const page = new URL(pageUrl);
  const path = page.pathname;
  const at = (p: string): string => page.origin + p;
  if (path.endsWith(".html")) return [at(path.slice(0, -".html".length) + ".md")];
  if (path === "/") return [at("/index.md")];
  if (path.endsWith("/")) return [at(path.slice(0, -1) + ".md"), at(path + "index.md")];
  return [at(path + ".md"), at(path + "/index.md")];
}

// A page's markers and leading comments sit in the first few hundred bytes. Reading a bounded prefix keeps a large
// body from being copied whole just to inspect its start.
const PREAMBLE_MAX_CHARS = 4096;

function pageStart(body: string): string {
  let head = body.slice(0, PREAMBLE_MAX_CHARS).trimStart().toLowerCase();
  // A soft 404 often opens with a comment before the shell, so the comments are skipped to reach the marker below.
  // A comment that runs past the prefix leaves nothing to judge: "" keeps the shell from being taken for an article.
  while (head.startsWith("<!--")) {
    const end = head.indexOf("-->");
    if (end < 0) return "";
    head = head.slice(end + 3).trimStart();
  }
  return head;
}

/**
 * A server may answer a missing '.md' with 200 and the HTML shell, so the reply is judged by its content type and
 * by HTML markers in the body, not by its status. The markers are read only where a page puts them (the start): a
 * markdown document about HTML mentions them inside a fence, and such a page is exactly what the climb looks for.
 */
export function isMachineReadable(contentType: string, body: string): boolean {
  if (contentType.toLowerCase().includes("html")) return false;
  const head = pageStart(body);
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) return false;
  return head.trim().length > 0;
}

/**
 * The llms.txt entry for this page, or "". The path match starts at a segment boundary: the page path begins with
 * "/", so a suffix match cannot split a segment. Skipping already-tried urls keeps the climb from refetching one.
 */
export function llmsTargetFor(body: string, pageUrl: string, tried: readonly string[]): string {
  const want = trimSlash(new URL(pageUrl).pathname);
  for (const line of body.slice(0, LLMS_MAX_CHARS).split("\n")) {
    const open = line.indexOf("](");
    if (open < 0) continue;
    const close = line.indexOf(")", open);
    if (close < 0) continue;
    const target = line.slice(open + 2, close).trim();
    if (target === "") continue;
    let abs: URL;
    try {
      abs = new URL(target, pageUrl);
    } catch {
      continue;
    }
    const bare = abs.pathname.endsWith(".md") ? abs.pathname.slice(0, -".md".length) : abs.pathname;
    const have = trimSlash(bare);
    const names = have === want || (want !== "" && have.endsWith(want));
    if (!names || abs.href === pageUrl || tried.includes(abs.href)) continue;
    return abs.href;
  }
  return "";
}

function trimSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

/** A missing or non-article candidate is the expected case, so it is undefined, not an error. */
async function tryMarkdown(url: string, signal: AbortSignal): Promise<LadderHit | undefined> {
  try {
    const res = await safeFetch(url, signal, ACCEPT_MARKDOWN);
    const body = res.body.toString("utf8");
    return isMachineReadable(res.contentType, body) ? { body, url: res.finalUrl } : undefined;
  } catch (err) {
    // An abort is the caller's timeout or cancel, not a missing candidate, so it still ends the call.
    if (signal.aborted) throw err;
    return undefined;
  }
}

export async function climbShell(pageUrl: string, signal: AbortSignal): Promise<LadderHit | undefined> {
  const tried: string[] = [];
  for (const sibling of mdSiblingUrls(pageUrl)) {
    tried.push(sibling);
    const hit = await tryMarkdown(sibling, signal);
    if (hit !== undefined) return hit;
  }
  const llms = new URL("/llms.txt", pageUrl).href;
  tried.push(llms);
  const index = await tryMarkdown(llms, signal);
  if (index === undefined) return undefined;
  const target = llmsTargetFor(index.body, pageUrl, tried);
  if (target === "") return undefined;
  return tryMarkdown(target, signal);
}
