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
import { splitBlocks, classifyBlocks, contentText, templateText, } from "./blocks.js";
import { pageKeyFor, hostFor } from "./page-store.js";
/**
 * JSON and plain-text responses are not web pages and have no chrome; they are
 * passed through untouched so the existing JSON/text indexing strategies keep
 * their exact behaviour.
 */
export function routeSkipsExtraction(route) {
    return route === "json" || route === "text";
}
export function extractAndStore(input) {
    const { url, sourceLabel, document, route, store } = input;
    const pageKey = pageKeyFor(url);
    const host = hostFor(url);
    const storedBytes = Buffer.byteLength(document, "utf-8");
    const blocks = splitBlocks(document);
    const authored = route === "markdown";
    const hostPageCount = store.hostPageCount(host, pageKey);
    const counts = authored
        ? new Map()
        : store.otherPageCounts(host, pageKey, blocks.map((b) => b.hash));
    const result = classifyBlocks({
        blocks,
        otherPageCount: (h) => counts.get(h) ?? 0,
        hostPageCount,
        authored,
    });
    // Store the page WHOLE regardless of the verdict — including when we are
    // about to refuse. Refusing to index is not a licence to discard bytes.
    store.recordPage({
        pageKey, host, url, sourceLabel, route,
        provisional: result.provisional,
        fullText: document,
    }, result.blocks);
    if (result.allTemplate) {
        return {
            kind: "refuse",
            storedBytes,
            route,
            reason: `every block of this page is byte-identical to blocks already seen on other pages of ${host}, ` +
                `so the response carried the site shell rather than this page — its content is rendered ` +
                `client-side by JavaScript and an HTTP fetch cannot see it. Nothing was indexed (the response ` +
                `is stored whole and unaltered). Retrying this URL returns the same shell; look for this site's ` +
                `llms.txt, a raw .md source, an OpenAPI spec, or a repository README instead.`,
        };
    }
    // A second page of this host resolves every cold-start page that came
    // before it. Re-run those now — a first page that is wrongly labelled and
    // never revisited is exactly the silent loss this design forbids.
    const relabelled = [];
    if (!result.provisional) {
        for (const prev of store.provisionalPages(host, pageKey)) {
            const prevBlocks = store.blocksOf(prev.pageKey);
            const prevCounts = store.otherPageCounts(host, prev.pageKey, prevBlocks.map((b) => b.hash));
            const rerun = classifyBlocks({
                blocks: prevBlocks.map((b) => ({
                    ordinal: b.ordinal, raw: b.raw, text: b.text, hash: b.hash,
                })),
                otherPageCount: (h) => prevCounts.get(h) ?? 0,
                hostPageCount: store.hostPageCount(prev.host, prev.pageKey),
                authored: prev.route === "markdown",
            });
            // An all-template re-run means the earlier page was a shell too. Leave
            // its stored bytes alone and leave its index rows alone rather than
            // emptying a source the user may already be searching.
            if (rerun.allTemplate)
                continue;
            store.relabelPage(prev.pageKey, rerun.blocks, rerun.provisional);
            if (rerun.templateBytes > 0) {
                relabelled.push({
                    sourceLabel: prev.sourceLabel,
                    url: prev.url,
                    indexText: contentText(rerun.blocks),
                    templateBytes: rerun.templateBytes,
                });
            }
        }
    }
    return {
        kind: "index",
        indexText: contentText(result.blocks),
        storedBytes,
        contentBytes: result.contentBytes,
        templateBytes: result.templateBytes,
        templateBlocks: countTemplate(result.blocks),
        totalBlocks: result.blocks.length,
        provisional: result.provisional,
        route,
        relabelled,
    };
}
function countTemplate(blocks) {
    let n = 0;
    for (const b of blocks)
        if (b.kind === "template")
            n++;
    return n;
}
/** The chrome that was labelled out of a stored page, for retrieval. */
export function storedTemplateText(store, url) {
    const blocks = store.blocksOf(pageKeyFor(url));
    return templateText(blocks.map((b) => ({ ordinal: b.ordinal, raw: b.raw, text: b.text, hash: b.hash, kind: b.kind })));
}
