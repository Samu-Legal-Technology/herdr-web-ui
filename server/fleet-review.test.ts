import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./index.ts";

test("review route requires token, stays local, and passes typed argv without executing note text", async () => {
  const root = mkdtempSync(join(tmpdir(), "fleet-review-route-"));
  const argsFile = join(root, "args.json");
  const marker = join(root, "NEVER_EXECUTE");
  const fake = join(root, "ff");
  writeFileSync(fake, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "fs.writeFileSync(" + JSON.stringify(argsFile) + ", JSON.stringify(process.argv.slice(2)));",
    "process.stdout.write(JSON.stringify({ok:true,status:'appended',content:'{\\\"cards\\\":[],\\\"errors\\\":[]}'}));",
  ].join("\n") + "\n");
  chmodSync(fake, 0o700);
  const old = process.env["FF_REVIEW_BIN"];
  process.env["FF_REVIEW_BIN"] = fake;
  const open = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: join(root, "open"), tailscaleOwner: null });
  const gated = createServer({ port: 0, hostname: "127.0.0.1", token: "test-review-token", stateDir: join(root, "gated"), tailscaleOwner: null });
  try {
    const url = "http://127.0.0.1:" + gated.port + "/api/fleet/review";
    expect((await fetch("http://127.0.0.1:" + open.port + "/api/fleet/review")).status).toBe(401);
    expect((await fetch(url)).status).toBe(401);
    const auth = { authorization: "Bearer test-review-token" };
    expect((await fetch(url, { headers: { ...auth, "x-forwarded-for": "127.0.0.1" } })).status).toBe(401);
    expect((await fetch(url, { method: "POST", headers: { ...auth, origin: "https://evil.invalid" }, body: "{}" })).status).toBe(403);
    const note = "$(touch " + marker + ")";
    const body = { kind: "awaiting", id: "synthetic", decision: "approve", option: "Approve",
      option_id: "approve", note, card_sha256: "a".repeat(64), snapshot_sha256: "b".repeat(64) };
    const response = await fetch(url, { method: "POST", headers: { ...auth, origin: "http://127.0.0.1:" + gated.port,
      "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(response.status).toBe(200);
    const argv = JSON.parse(readFileSync(argsFile, "utf8")) as string[];
    expect(argv).toContain(note);
    expect(argv.slice(0, 3)).toEqual(["fleet", "review", "answer"]);
    expect(existsSync(marker)).toBe(false);
  } finally {
    open.stop(); gated.stop();
    if (old === undefined) delete process.env["FF_REVIEW_BIN"]; else process.env["FF_REVIEW_BIN"] = old;
    rmSync(root, { recursive: true, force: true });
  }
});
