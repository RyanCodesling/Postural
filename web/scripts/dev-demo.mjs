// `npm run dev:demo`: the development server with the demo clock on
// (DEMO_CLOCK=on), for showing the app on another date. A plain
// `npm run dev` leaves it off, and the app then uses the real time and
// ignores any demo date left in the database.
import { spawn } from "node:child_process";

const env = { ...process.env, DEMO_CLOCK: "on" };
const args = ["run", "dev", ...(process.argv.length > 2 ? ["--", ...process.argv.slice(2)] : [])];
// npm sets npm_execpath when it runs this script; calling it through node
// avoids a shell on Windows.
const npmCli = process.env.npm_execpath;
const child = npmCli
  ? spawn(process.execPath, [npmCli, ...args], { stdio: "inherit", env })
  : spawn(process.platform === "win32" ? "npm.cmd" : "npm", args, {
      stdio: "inherit",
      env,
      shell: process.platform === "win32",
    });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
