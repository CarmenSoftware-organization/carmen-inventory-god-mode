import { spawn } from "node:child_process";

export type ProcessResult = { code: number };

export function runProcess(opts: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  onLine: (line: string, stream: "out" | "err") => void;
}): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(opts.command, opts.args, { cwd: opts.cwd, env: opts.env, shell: false });

    // onLine belongs to the caller and can throw — a response stream that the client
    // already abandoned is the common case. Such a throw must not escape a stdout
    // handler or the close handler, where it would leave this promise pending forever
    // and strand whatever the caller releases when it settles.
    const report = (line: string, stream: "out" | "err") => {
      try {
        opts.onLine(line, stream);
      } catch { /* a consumer that cannot listen does not get to wedge the child */ }
    };

    const splitter = (stream: "out" | "err") => {
      let buf = "";
      return {
        push(chunk: string) {
          buf += chunk;
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            report(buf.slice(0, nl).replace(/\r$/, ""), stream);
            buf = buf.slice(nl + 1);
          }
        },
        flush() {
          if (buf.length) { report(buf.replace(/\r$/, ""), stream); buf = ""; }
        },
      };
    };

    const out = splitter("out");
    const err = splitter("err");
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => out.push(c));
    child.stderr.on("data", (c: string) => err.push(c));
    child.on("error", reject);
    child.stdout.on("error", reject);
    child.stderr.on("error", reject);
    child.on("close", (code) => {
      // Flush first, but resolve no matter what: the exit code is the contract.
      try { out.flush(); err.flush(); } finally { resolve({ code: code ?? 0 }); }
    });
  });
}
