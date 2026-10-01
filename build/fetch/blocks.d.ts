/**
 * blocks — block-level template/content extraction for fetched documents.
 *
 * WHY THIS EXISTS
 * ───────────────
 * A format converter answers "what format". It can never answer "which part of
 * the page". Turndown (and Cloudflare's `toMarkdown`, and every other
 * converter) transliterates the whole document, chrome included: nav lists,
 * sidebars, footers, cookie banners. Bolting a link-density or byte threshold
 * onto the converter is a symptom detector — it guesses from the shape of a
 * single page, and the right threshold differs per host. Measured 2026-08-12 on
 * the shipped converter: link-only lines are 28.3% of the Stripe API reference
 * and 0.3% of the Resend send-email page. No single number separates those.
 *
 * The signal that does work needs no threshold at all:
 *
 *   CHROME IS WHAT REPEATS ACROSS PAGES OF THE SAME HOST.
 *   CONTENT IS WHAT DOES NOT.
 *
 * Every page of docs.stripe.com carries the same nav; only the article differs.
 * So a block is classified `template` only when that exact block was already
 * seen on a DIFFERENT page of the same host. The rule never guesses from the
 * shape of one page, which makes it lossless by construction.
 *
 * NO DATA LOSS MEANS LABEL, NEVER DROP
 * ────────────────────────────────────
 * This module only ever LABELS. It does not delete, trim, summarise or
 * truncate. `splitBlocks` is exactly reversible — see `reassemble`, and the
 * invariant test that asserts `reassemble(splitBlocks(x)) === x` byte for byte.
 * The caller stores every block; only `content` blocks reach the search index.
 *
 * No regular expressions anywhere (repo-wide ban): all scanning is explicit
 * character and prefix work.
 */
export interface Block {
    /** 0-based position in the document. */
    ordinal: number;
    /**
     * The block's source bytes VERBATIM, including the newlines and blank-line
     * separators that followed it. Concatenating `raw` over all blocks in
     * ordinal order reproduces the input document exactly.
     */
    raw: string;
    /** The block's visible text: `raw` with leading/trailing whitespace removed. */
    text: string;
    /** sha256 (full digest, never shortened) of the normalised text. */
    hash: string;
}
export type BlockKind = "content" | "template";
export interface ClassifiedBlock extends Block {
    kind: BlockKind;
}
export interface ClassifyResult {
    blocks: ClassifiedBlock[];
    /**
     * True when this host had no other recorded page at classification time, so
     * every block was admitted as `content` on no evidence. The caller must
     * re-run classification for this page once a second page of the host lands.
     */
    provisional: boolean;
    /**
     * True when every block of this page was already seen on other pages of the
     * host — the fetch returned the site shell, not this page. The caller must
     * refuse rather than index it.
     */
    allTemplate: boolean;
    contentBytes: number;
    templateBytes: number;
}
/**
 * Split converted markdown into blocks.
 *
 * A block boundary is a blank line, or a heading line, outside a fenced code
 * block. Blank lines stay attached to the block they follow, so every input
 * byte belongs to exactly one block and `reassemble` is exact.
 *
 * Fenced code is never split: a nav list and a JSON example must each be a
 * single unit, or a code sample that happens to share one line with another
 * page would be classified independently of its surroundings.
 */
export declare function splitBlocks(markdown: string): Block[];
/**
 * Exact inverse of `splitBlocks`. `reassemble(splitBlocks(x)) === x` for every
 * input — this is the formal statement of "nothing was lost".
 */
export declare function reassemble(blocks: Array<{
    raw: string;
}>): string;
/**
 * Normalise a block for cross-page comparison: lower-cased, with every run of
 * whitespace collapsed to a single space. Two renderings of the same nav that
 * differ only in indentation or line wrapping must hash identically, or the
 * repeat is missed and chrome leaks into the index.
 *
 * Deliberately conservative: no punctuation stripping, no token dropping. A
 * looser normaliser risks collapsing two DIFFERENT blocks to one hash, which
 * would demote real content. Under-matching leaks chrome (recoverable, and
 * visible); over-matching hides content (a silent loss, which is forbidden).
 */
export declare function normalizeBlockText(text: string): string;
/** Full sha256 hex digest of the normalised block. Never shortened. */
export declare function hashBlockText(text: string): string;
export interface ClassifyOptions {
    blocks: Block[];
    /**
     * Number of DISTINCT other pages of this host on which the given block hash
     * has been seen. Must exclude the page being classified, or a page compared
     * against itself marks its own article as template.
     */
    otherPageCount: (hash: string) => number;
    /** Distinct pages already recorded for this host, excluding the current one. */
    hostPageCount: number;
    /**
     * Set when the document came straight from the site's own machine-readable
     * endpoint. Such a document was authored for machines and carries no chrome
     * to classify, so every block is content and the result is never provisional.
     */
    authored?: boolean;
}
/**
 * Classify every block of one page.
 *
 * COLD START — the honest hard case. The first page of a host has no
 * comparison set, so there is no evidence on which to call anything template.
 * The decision here is to admit EVERY block as `content`, mark the page
 * `provisional`, and re-run the moment a second page of that host arrives.
 *
 * The alternative — guessing per-block from link density, position or
 * container on page one — is rejected on the measurements above: the correct
 * threshold is 28.3% on Stripe and 0.3% on Resend, so any fixed value demotes
 * real content on one of them. Over-indexing on page one is fully recoverable
 * (the re-run removes the chrome, and the page's own bytes were never
 * discarded); under-indexing is a silent loss with nothing left to detect it.
 * Never demote on evidence we do not have.
 */
export declare function classifyBlocks(opts: ClassifyOptions): ClassifyResult;
/**
 * The text that goes to the search index: the `content` blocks, in document
 * order, joined by their own separators. Template blocks are NOT deleted —
 * the caller has already stored every block verbatim; they are simply left
 * out of the index.
 */
export declare function contentText(blocks: ClassifiedBlock[]): string;
/** The template stream, in document order. Stored and retrievable, never indexed. */
export declare function templateText(blocks: ClassifiedBlock[]): string;
