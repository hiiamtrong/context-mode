/**
 * page-store — the lossless side of fetch extraction.
 *
 * Holds, per project, the COMPLETE converted document for every page ever
 * fetched, plus every block of it with its `content` / `template` label. The
 * FTS index receives only `content` blocks; this store is what makes that
 * safe, because nothing has been thrown away — the whole document and every
 * template block remain here, verbatim and retrievable.
 *
 * It is also the comparison set. Classification asks one question — "was this
 * exact block already seen on a DIFFERENT page of this host?" — and that
 * question is answered by `page_blocks` joined to `pages`.
 *
 * Nothing in this file truncates. Full documents are stored whole; there is no
 * size cap, no prefix, no summary. (The fetch path upstream already refuses
 * responses above 50 MB before conversion.)
 *
 * No regular expressions (repo-wide ban).
 */
import type { BlockKind, ClassifiedBlock } from "./blocks.js";
export interface StoredPage {
    pageKey: string;
    host: string;
    url: string;
    sourceLabel: string;
    route: string;
    provisional: boolean;
    fullText: string;
}
export interface StoredBlock {
    ordinal: number;
    hash: string;
    kind: BlockKind;
    raw: string;
    text: string;
}
/**
 * Canonical identity of a fetched page. The URL minus its fragment: two
 * fetches of the same page must be the same row, or a page compared against
 * an older copy of itself marks its own article as template.
 */
export declare function pageKeyFor(url: string): string;
/** Host of a URL, lower-cased. Empty string when the URL will not parse. */
export declare function hostFor(url: string): string;
export declare class PageStore {
    #private;
    constructor(dbPath: string);
    /** Distinct pages already recorded for a host, excluding `exceptPageKey`. */
    hostPageCount(host: string, exceptPageKey: string): number;
    /**
     * How many DISTINCT other pages of this host carry this exact block. The
     * `page_key <> ?` clause is what keeps a page from classifying itself.
     */
    otherPageCounts(host: string, exceptPageKey: string, hashes: string[]): Map<string, number>;
    /** Store one page whole: the complete document plus every labelled block. */
    recordPage(page: StoredPage, blocks: ClassifiedBlock[]): void;
    /** Update the stored labels after a re-run, and clear the provisional flag. */
    relabelPage(pageKey: string, blocks: ClassifiedBlock[], provisional: boolean): void;
    /** Every page of a host still carrying a cold-start (provisional) labelling. */
    provisionalPages(host: string, exceptPageKey: string): StoredPage[];
    /** Every stored block of a page, in document order — content and template alike. */
    blocksOf(pageKey: string): StoredBlock[];
    /** The complete converted document as it was stored, or null. */
    fullTextOf(pageKey: string): string | null;
    close(): void;
}
