/** The actual session-check and Log Out routes with fixture sign-in lookups.
 * The check never changes the cookie, so an answer that arrives after a
 * sign-in cannot sign that person out again; Log Out still clears it. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as sessionToken from "./session-token";

const nodeRequire = createRequire(import.meta.url);
const { NextRequest } = nodeRequire("next/server");
const user = { id: "patient_fixture", email: "fixture@example.test", name: "Fixture", role: "patient",
  clinicId: null, mustChangePassword: false };

function load(relative: string, mocks: Record<string, any>) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const context: any = vm.createContext({ exports: {}, console: { error() {} },
    require(name: string) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === "next/server") return nodeRequire("next/server");
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText, context);
  return context.exports;
}

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost${path}`, cookie ? { headers: { cookie } } : undefined);
// The cookie helpers are offered whether or not the route uses them, so a route
// that clears the cookie fails on its response rather than on its imports.
const meRoute = (getAuthenticatedUser: () => Promise<unknown>) => load("../app/api/auth/me/route.ts", {
  "@/lib/auth-server": { getAuthenticatedUser }, "@/lib/session-token": sessionToken,
});

async function main() {
  const signedOut = meRoute(async () => null);
  for (const cookie of [undefined, `${sessionToken.AUTH_COOKIE_NAME}=stale-or-forged`]) {
    const response = await signedOut.GET(request("/api/auth/me", cookie));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null, `a check with ${cookie ? "a stale" : "no"} cookie must not change it`);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  console.log("PASS a signed-out session check answers 401 and leaves the cookie alone");

  const signedIn = meRoute(async () => user);
  const found = await signedIn.GET(request("/api/auth/me", `${sessionToken.AUTH_COOKIE_NAME}=fixture`));
  assert.equal(found.status, 200);
  assert.deepEqual((await found.json()).user, user);
  assert.equal(found.headers.get("set-cookie"), null);
  console.log("PASS a signed-in session check returns the user and leaves the cookie alone");

  let recorded: string | null = null;
  const logout = load("../app/api/auth/logout/route.ts", {
    "@/lib/auth-server": { getAuthenticatedUser: async () => user },
    "@/lib/db": { recordUserSignedOut: async (id: string) => { recorded = id; } },
    "@/lib/session-token": sessionToken,
  });
  const cleared = await logout.POST(request("/api/auth/logout", `${sessionToken.AUTH_COOKIE_NAME}=fixture`));
  const setCookie = cleared.headers.get("set-cookie") ?? "";
  assert(setCookie.startsWith(`${sessionToken.AUTH_COOKIE_NAME}=;`), setCookie);
  assert.match(setCookie, /Max-Age=0/i);
  assert.equal(recorded, user.id);
  console.log("PASS Log Out still clears the cookie and records the sign-out");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
