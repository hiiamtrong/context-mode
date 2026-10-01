/**
 * extract — orchestrates the lossless template/content pass for one fetch.
 *
 * Order of operations, cheapest correct answer first:
 *
 *   1. If the site publishes a machine-readable version of the page, take it.
 *      The fetch subprocess now sends `Accept: text/markdown` on the SAME
 *      request it was already making, so this costs zero extra round trips.
 *      Measured 2026-08-12: Stripe 1,846,885 B of HTML → 11,744 B of pure
 *      article; GitBook, Mintlify, Resend and Polygon likewise. Such a
 *      document was authored for machines and carries no chrome, so it skips
 *      extraction entirely (`authored`).
 *   2. Otherwise convert the HTML, then classify each block against the other
 *      pages already seen from that host.
 *   3. Index only `content`. Store everything.
 *   4. If the page turns out to carry no page-specific content at all, refuse
 *      and say what to try instead.
 *
 * No regular expressions (repo-wide ban). Nothing here truncates.
 */
import { PageStore } from "./page-store.js";
/** How the document reached us. `markdown` = the site served it; `html` = we converted it. */
export type FetchRoute = "markdown" | "html" | "json" | "text";
export interface ExtractInput {
    url: string;
    /** The storage label the caller will index under. */
    sourceLabel: string;
    /** The COMPLETE converted document. Stored verbatim; never trimmed here. */
    document: string;
    route: FetchRoute;
    store: PageStore;
}
export interface Relabelled {
    sourceLabel: string;
    url: string;
    /** Text to re-index for that page under the same label (replaces the old rows). */
    indexText: string;
    templateBytes: number;
}
export type ExtractOutcome = {
    kind: "index";
    /** The text that should reach the FTS index — `content` blocks only. */
    indexText: string;
    /** Complete document as stored. Retained for the caller's byte accounting. */
    storedBytes: number;
    contentBytes: number;
    templateBytes: number;
    templateBlocks: number;
    totalBlocks: number;
    provisional: boolean;
    route: FetchRoute;
    /** Cold-start pages of this host that a second page has now resolved. */
    relabelled: Relabelled[];
} | {
    kind: "refuse";
    reason: string;
    storedBytes: number;
    route: FetchRoute;
};
/**
 * JSON and plain-text responses are not web pages and have no chrome; they are
 * passed through untouched so the existing JSON/text indexing strategies keep
 * their exact behaviour.
 */
export declare function routeSkipsExtraction(route: FetchRoute): boolean;
export declare function extractAndStore(input: ExtractInput): ExtractOutcome;
/** The chrome that was labelled out of a stored page, for retrieval. */
export declare function storedTemplateText(store: PageStore, url: string): string;
