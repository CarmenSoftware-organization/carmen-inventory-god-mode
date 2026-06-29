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

    const splitter = (stream: "out" | "err") => {
      let buf = "";
      return {
        push(chunk: string) {
          buf += chunk;
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            opts.onLine(buf.slice(0, nl).replace(/\r$/, ""), stream);
            buf = buf.slice(nl + 1);
          }
        },
        flush() {
          if (buf.length) { opts.onLine(buf.replace(/\r$/, ""), stream); buf = ""; }
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
    child.on("close", (code) => { out.flush(); err.flush(); resolve({ code: code ?? 0 }); });
  });
}
