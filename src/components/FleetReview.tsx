import { useCallback, useEffect, useState } from "react";
import "./FleetReview.css";

type Card = { record: Record<string, unknown>; sha256: string; snapshot_sha256: string | null; warnings: { code: string }[] };
type Board = { cards: Card[]; errors: { line: number; error: string }[] };
const choices = ["approve", "approve_with_edits", "hold", "decline"] as const;
const words = (value: unknown) => typeof value === "string" && value !== "" ? value : "Not stated";
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "choice";

export function FleetReview() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Record<string, { decision: string; option: string; note: string }>>({});
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/fleet/review", { credentials: "same-origin" });
      const payload = await response.json() as { content?: string; error?: { message: string } };
      if (!response.ok || !payload.content) throw new Error(payload.error?.message ?? "Review unavailable");
      setBoard(JSON.parse(payload.content) as Board);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Review unavailable"); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const answer = async (card: Card) => {
    const row = card.record;
    const id = String(row["id"]);
    const options = Array.isArray(row["options"]) ? row["options"].filter((item): item is string => typeof item === "string") : [];
    const choice = selected[id] ?? { decision: "hold", option: options[0] ?? "", note: "" };
    if (!choice || !card.snapshot_sha256 || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/fleet/review", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: row["kind"], id, decision: choice.decision, option: choice.option,
          option_id: slug(choice.option), note: choice.note, card_sha256: card.sha256,
          snapshot_sha256: card.snapshot_sha256 }),
      });
      const result = await response.json() as { error?: { message: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Answer refused");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Answer refused"); }
    finally { setBusy(false); }
  };
  const open = board?.cards.filter(card => card.record["decision"] === "open") ?? [];
  return <section className="fleet-review" aria-label="Decision review">
    <header><h2>Decision review</h2><button type="button" onClick={() => void refresh()}>Refresh</button></header>
    <p>Answers are recorded as UI decisions. Approval here does not run a command or attest Touch ID.</p>
    {error && <p role="alert">{error}</p>}
    {board?.errors.map(problem => <p role="alert" key={problem.line}>Ledger line {problem.line}: {problem.error}</p>)}
    {open.length === 0 && !error && <p>No open decisions.</p>}
    {open.map(card => {
      const row = card.record;
      const id = String(row["id"]);
      const options = Array.isArray(row["options"]) ? row["options"].filter((item): item is string => typeof item === "string") : [];
      const state = selected[id] ?? { decision: "hold", option: options[0] ?? "", note: "" };
      return <article key={String(row["kind"]) + ":" + id} className="fleet-review-card">
        <h3>{id} · {String(row["case"] ?? "")}</h3>
        <p><strong>Issue</strong><br />{words(row["issue"] ?? row["item"])}</p>
        <p><strong>Goal</strong><br />{words(row["goal"])}</p>
        <p><strong>Command (description only)</strong><br />{words(row["command"])}</p>
        <p><strong>Deadline</strong> {words(row["deadline"])}</p>
        {card.warnings.length > 0 && <p role="alert">Unrecognized card fields; review before answering.</p>}
        <label>Option <select value={state.option} onChange={event => setSelected({ ...selected, [id]: { ...state, option: event.target.value } })}>
          {options.map(option => <option key={option} value={option}>{option}{option === row["rec"] ? " (recommended)" : ""}</option>)}
        </select></label>
        <label>Decision <select value={state.decision} onChange={event => setSelected({ ...selected, [id]: { ...state, decision: event.target.value } })}>
          {choices.map(choice => <option key={choice} value={choice}>{choice.replaceAll("_", " ")}</option>)}
        </select></label>
        <label>Note <textarea value={state.note} onChange={event => setSelected({ ...selected, [id]: { ...state, note: event.target.value } })} /></label>
        <button type="button" disabled={busy || !state.option || card.warnings.length > 0}
          onClick={() => void answer(card)}>Record answer</button>
      </article>;
    })}
  </section>;
}
