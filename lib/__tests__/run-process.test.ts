import { expect, test } from "vitest";
import { runProcess } from "@/lib/run-process";

test("streams stdout and stderr lines and resolves with exit code 0", async () => {
  const lines: { line: string; stream: string }[] = [];
  const res = await runProcess({
    command: process.execPath, // node
    args: ["-e", "process.stdout.write('a\\nb\\n'); process.stderr.write('e1\\n')"],
    cwd: process.cwd(),
    env: process.env,
    onLine: (line, stream) => lines.push({ line, stream }),
  });
  expect(res.code).toBe(0);
  expect(lines).toContainEqual({ line: "a", stream: "out" });
  expect(lines).toContainEqual({ line: "b", stream: "out" });
  expect(lines).toContainEqual({ line: "e1", stream: "err" });
});

test("captures a non-zero exit code", async () => {
  const res = await runProcess({
    command: process.execPath,
    args: ["-e", "process.exit(3)"],
    cwd: process.cwd(),
    env: process.env,
    onLine: () => {},
  });
  expect(res.code).toBe(3);
});

test("flushes a trailing line with no newline", async () => {
  const lines: string[] = [];
  await runProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('no-newline')"],
    cwd: process.cwd(),
    env: process.env,
    onLine: (line) => lines.push(line),
  });
  expect(lines).toContain("no-newline");
});

test("strips carriage returns from lines", async () => {
  const lines: string[] = [];
  await runProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('line1\\r\\nline2\\r\\n')"],
    cwd: process.cwd(),
    env: process.env,
    onLine: (line) => lines.push(line),
  });
  expect(lines).toEqual(["line1", "line2"]);
});

test("resolves even when onLine throws on a streamed line", async () => {
  // A consumer that writes to a closed response stream throws from onLine. If that
  // escapes, the promise never settles and the caller's finally never releases.
  const res = await runProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('a\\nb\\n')"],
    cwd: process.cwd(),
    env: process.env,
    onLine: () => { throw new Error("consumer is gone"); },
  });
  expect(res.code).toBe(0);
});

test("resolves even when onLine throws during the final flush", async () => {
  // The close handler flushes before resolving; a throw there skipped resolve entirely.
  const res = await runProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('no-newline')"],
    cwd: process.cwd(),
    env: process.env,
    onLine: () => { throw new Error("consumer is gone"); },
  });
  expect(res.code).toBe(0);
});
