/** Local, token-gated Final Fact review adapter. No shell and no pane input. */
import { homedir } from "node:os";
import { join } from "node:path";
import { badRequest, jsonResponse } from "./http.ts";

const HEX = /^[0-9a-f]{64}$/;
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const DECISIONS = new Set(["approve", "approve_with_edits", "hold", "decline"]);

async function run(args: string[]): Promise<Response> {
  try {
    const ff = process.env["FF_REVIEW_BIN"] ?? join(homedir(), "Projects/final_fact/bin/ff");
    const child = Bun.spawn([ff, "fleet", "review", ...args, "--json"], {
      stdout: "pipe", stderr: "pipe", stdin: "ignore",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (exit !== 0) return jsonResponse({ error: { code: "review_refused", message: stderr.slice(0, 300) || stdout.slice(0, 300) } }, 409);
    const data: unknown = JSON.parse(stdout);
    if (typeof data !== "object" || data === null) throw new Error("invalid CLI response");
    return jsonResponse(data);
  } catch {
    return jsonResponse({ error: { code: "review_unavailable", message: "review adapter unavailable" } }, 503);
  }
}

export async function handleFleetReview(request: Request): Promise<Response> {
  if (request.method === "GET") return run(["view", "--format", "json"]);
  if (request.method !== "POST") return badRequest("method_not_allowed", "use GET or POST");
  if (Number(request.headers.get("content-length") ?? "0") > 16_384) return badRequest("too_large", "answer too large");
  let value: unknown;
  try { value = await request.json(); } catch { return badRequest("invalid_json", "JSON answer required"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return badRequest("invalid_answer", "object required");
  const data = value as Record<string, unknown>;
  const keys = ["kind", "id", "decision", "option", "option_id", "note", "card_sha256", "snapshot_sha256"];
  if (Object.keys(data).some(key => !keys.includes(key)) ||
      !keys.every(key => typeof data[key] === "string")) return badRequest("invalid_answer", "typed answer fields required");
  const [kind, id, decision, option, optionId, note, cardSha, snapshotSha] =
    keys.map(key => data[key] as string) as [string, string, string, string, string, string, string, string];
  if (!["awaiting", "draft"].includes(kind) || !id || id.length > 200 ||
      !DECISIONS.has(decision) || !option || option.length > 500 ||
      !ID.test(optionId) || note.length > 8_000 || !HEX.test(cardSha) || !HEX.test(snapshotSha)) {
    return badRequest("invalid_answer", "invalid answer value");
  }
  return run(["answer", "--kind", kind, "--id", id, "--decision", decision,
              "--option", option, "--option-id", optionId, "--note", note,
              "--card-sha256", cardSha, "--snapshot-sha256", snapshotSha, "--confirm"]);
}
