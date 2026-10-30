// Compatibility aliases: permit dashboard control even if the parent sets an
// environment lock. An admin must still enable the stored mode in the dashboard.
import { spawn } from "node:child_process";

const command = process.argv[2];
if (command !== "dev" && command !== "start") {
  console.error("Usage: node scripts/demo-server.mjs <dev|start> [server options]");
  process.exit(1);
}
const env = { ...process.env, DEMO_CLOCK: "on" };
const args = ["run", command, ...(process.argv.length > 3 ? ["--", ...process.argv.slice(3)] : [])];
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
child.on("error", (error) => {
  console.error(`Could not start the demo server: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
