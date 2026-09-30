import { describe, expect, it } from "bun:test";
import { displaysTerminalViewer, mayStreamPane, SELF_STREAM_PLACEHOLDER, streamOrPlaceholder } from "./self-stream.ts";

const processInfo = (...argv: string[][]) => ({
  process_info: { foreground_processes: argv.map((args) => ({ argv: args })) },
});

describe("terminal viewer stream exclusion", () => {
  it("recognizes the viewer by foreground process, regardless of pane ID", () => {
    expect(displaysTerminalViewer(processInfo(["/opt/homebrew/bin/terminal-browser", "open", "file:///fleet.html"]))).toBe(true);
    expect(displaysTerminalViewer(processInfo(["zsh"], ["terminal-browser", "open"]))).toBe(true);
    expect(displaysTerminalViewer(processInfo(["/usr/bin/python3", "terminal-browser.log"]))).toBe(false);
  });

  it("sends only a fixed placeholder for the viewer; never calls the stream", async () => {
    const output: string[] = [];
    await streamOrPlaceholder("fixture:p1", async () => processInfo(["terminal-browser"]),
      () => output.push("SECRET_PANE_FRAME"), () => output.push(SELF_STREAM_PLACEHOLDER));
    expect(output).toEqual([SELF_STREAM_PLACEHOLDER]);
    expect(output.join("")).not.toContain("SECRET_PANE_FRAME");
  });

  it("streams another pane normally", async () => {
    const output: string[] = [];
    await streamOrPlaceholder("fixture:p2", async () => processInfo(["zsh"], ["/usr/bin/claude"]),
      () => output.push("NORMAL_PANE_FRAME"), () => output.push(SELF_STREAM_PLACEHOLDER));
    expect(output).toEqual(["NORMAL_PANE_FRAME"]);
  });

  it("stops forwarding when a pane starts displaying the viewer after attachment", async () => {
    let viewerRunning = false;
    const output: string[] = [];
    const inspect = async () => processInfo([viewerRunning ? "terminal-browser" : "zsh"]);
    const forward = (frame: string) => streamOrPlaceholder("fixture:p4", inspect,
      () => output.push(frame), () => output.push(SELF_STREAM_PLACEHOLDER));
    await forward("BEFORE_VIEWER");
    viewerRunning = true;
    await forward("PRIVATE_VIEWER_FRAME");
    expect(output).toEqual(["BEFORE_VIEWER", SELF_STREAM_PLACEHOLDER]);
  });

  it("fails closed when process inspection fails", async () => {
    expect(await mayStreamPane("fixture:p3", async () => { throw new Error("unavailable"); })).toBe(false);
  });
});
