import { herdrRpc } from "./herdr/client.ts";

export const SELF_STREAM_PLACEHOLDER = "\r\n[Terminal viewer pane hidden to prevent recursive display]\r\n";

type ProcessInfo = { process_info?: { foreground_processes?: { argv?: string[] }[] } };

/** The terminal-browser TUI is Joe's canonical terminal decision viewer. */
export function displaysTerminalViewer(info: ProcessInfo): boolean {
  return (info.process_info?.foreground_processes ?? []).some(({ argv }) =>
    (argv ?? []).some((arg) => /(^|\/)terminal-browser$/.test(arg)),
  );
}

/** Fail closed if the process cannot be classified; a failed lookup must not expose a viewer. */
export async function mayStreamPane(
  paneId: string,
  inspect: (paneId: string) => Promise<ProcessInfo> = (id) =>
    herdrRpc<ProcessInfo>("pane.process_info", { pane_id: id }),
): Promise<boolean> {
  try {
    return !displaysTerminalViewer(await inspect(paneId));
  } catch {
    return false;
  }
}

export async function streamOrPlaceholder(
  paneId: string,
  inspect: ((paneId: string) => Promise<ProcessInfo>) | undefined,
  stream: () => void,
  placeholder: () => void,
): Promise<void> {
  if (await mayStreamPane(paneId, inspect)) stream();
  else placeholder();
}
