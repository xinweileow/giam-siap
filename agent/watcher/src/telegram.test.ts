import { describe, expect, it, vi, beforeEach } from "vitest";

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: unknown, result: { stdout: string; stderr: string }) => void;
    const result = execFileMock(...args.slice(0, -1));
    cb(null, result ?? { stdout: "", stderr: "" });
  },
}));

const { sendTelegramMessage } = await import("./telegram.js");

describe("sendTelegramMessage", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("shells out to `hermes send` with the configured profile/target when enabled", async () => {
    await sendTelegramMessage(
      { enabled: true, hermesBin: "hermes", hermesProfile: "giam-siap", target: "telegram" },
      "hello owner",
    );

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [bin, args, opts] = execFileMock.mock.calls[0];
    expect(bin).toBe("hermes");
    expect(args).toEqual(["send", "--to", "telegram", "--quiet", "hello owner"]);
    expect((opts as { env: Record<string, string> }).env.HERMES_PROFILE).toBe("giam-siap");
  });

  it("does nothing when disabled — never shells out", async () => {
    await sendTelegramMessage(
      { enabled: false, hermesBin: "hermes", hermesProfile: "giam-siap", target: "telegram" },
      "should not send",
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
