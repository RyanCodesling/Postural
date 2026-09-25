import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const web = dirname(dirname(fileURLToPath(import.meta.url)));
const walk = (dir: string): string[] => readdirSync(join(web, dir), { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(join(dir, e.name)) : /\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);
const suites = walk("src").sort();
let failures = 0;
for (const suite of suites) {
  const result = spawnSync(process.execPath, ["--import", "tsx", suite], { cwd: web, encoding: "utf8" });
  console.log(`${result.status === 0 ? "PASS" : "FAIL"} ${suite}`);
  if (result.status !== 0) {
    failures++;
    console.error(result.stdout, result.stderr, result.error ?? "");
  }
}
console.log(`${suites.length - failures}/${suites.length} TypeScript suites passed. Browser/DB transports in integration tests are fixtures; signed-in acceptance is separate.`);
process.exitCode = failures ? 1 : 0;
