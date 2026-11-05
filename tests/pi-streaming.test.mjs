// Fork patch: a Pi host that passes onUpdate sees ctx_execute output while the command still runs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { buildChildEnv } from "../src/core/sandbox/env.ts";
import { runProcess } from "../src/core/sandbox/spawn.ts";
import piExtension from "../src/entries/pi.ts";

describe("live output", () => {
  test("runProcess hands each stdout and stderr chunk to onChunk before it settles", async () => {
    const chunks = [];
    const r = await runProcess(["/bin/sh", "-c", "echo out; echo err >&2"], {
      cwd: process.cwd(), env: buildChildEnv(process.env), signal: new AbortController().signal, timeoutMs: 5000,
      onChunk: (c) => chunks.push(c.toString("utf8")),
    });
    assert.equal(r.exitCode, 0);
    const seen = chunks.join("");
    assert.ok(seen.includes("out") && seen.includes("err"), seen);
  });

  describe("pi ctx_execute", () => {
    let root, repo, oldHome;
    before(() => {
      root = realpathSync(mkdtempSync(join(tmpdir(), "cm-pi-stream-")));
      repo = join(root, "repo");
      mkdirSync(repo);
      execFileSync("git", ["init", "-q", repo]);
      oldHome = process.env.HOME;
      process.env.HOME = root; process.env.USERPROFILE = root;
    });
    after(() => {
      process.env.HOME = oldHome;
      rmSync(root, { recursive: true, force: true });
    });

    async function ctxExecute() {
      const tools = new Map();
      const handlers = new Map();
      piExtension({ on: (n, f) => handlers.set(n, f), registerTool: (t) => tools.set(t.name, t) });
      await handlers.get("before_agent_start")({ systemPrompt: "" }, { cwd: repo, sessionManager: { getSessionId: () => "s-stream" } });
      return tools.get("ctx_execute");
    }
    const params = { language: "shell", code: "echo first; sleep 0.4; echo second" };

    test("onUpdate receives the growing partial output while the command runs, and the final result still holds it all", async () => {
      const tool = await ctxExecute();
      const partials = [];
      const out = await tool.execute("t1", params, undefined, (p) => partials.push(p.content[0].text));
      assert.ok(partials.length >= 1, "at least one partial before the final result");
      assert.ok(partials[0].includes("first") && !partials[0].includes("second"), partials[0]);
      assert.ok(partials.at(-1).includes("second"));
      assert.ok(out.content[0].text.includes("first") && out.content[0].text.includes("second"));
    });

    test("without onUpdate the call behaves as before", async () => {
      const tool = await ctxExecute();
      const out = await tool.execute("t2", params);
      assert.ok(out.content[0].text.includes("first") && out.content[0].text.includes("second"));
    });
  });
});
