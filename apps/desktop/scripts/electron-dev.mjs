import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const PORT = 1420;
const HOST = "127.0.0.1";

function waitForPort(ms = 90_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = createConnection({ port: PORT, host: HOST }, () => {
        socket.end();
        resolve(undefined);
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > ms) {
          reject(new Error(`Timed out waiting for Vite on ${HOST}:${PORT}`));
          return;
        }
        setTimeout(tryConnect, 250);
      });
    };
    tryConnect();
  });
}

function run(command, args, env = process.env) {
  return spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env,
    shell: true,
  });
}

const vite = run("npx", ["vite"]);

let electronProc = null;
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (electronProc && !electronProc.killed) {
    try {
      electronProc.kill();
    } catch {
      /* ignore */
    }
  }
  if (vite && !vite.killed) {
    try {
      vite.kill();
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

vite.on("exit", (code) => {
  if (!shuttingDown) shutdown(code ?? 1);
});

try {
  await waitForPort();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  shutdown(1);
}

electronProc = run(
  "npx",
  ["electron", "."],
  {
    ...process.env,
    VITE_DEV_SERVER_URL: `http://${HOST}:${PORT}`,
  },
);

electronProc.on("exit", (code) => {
  shutdown(code ?? 0);
});
