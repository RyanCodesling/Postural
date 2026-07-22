/**
 * Security regression checks for signed auth sessions.
 *
 * Run from web/:
 *   npx tsx src/lib/session-token.test.ts
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import {
  SESSION_ALGORITHM,
  SESSION_AUDIENCE,
  SESSION_COOKIE_OPTIONS,
  SESSION_ISSUER,
  SessionConfigurationError,
  signSessionToken,
  verifySessionToken,
  type SessionTokenPayload,
} from "./session-token";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function assertRejectsConfiguration(
  fn: () => Promise<unknown>,
  message: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof SessionConfigurationError, `${message}: wrong error type`);
    return;
  }
  throw new Error(`${message}: expected SessionConfigurationError`);
}

const TEST_SECRET = "session-test-secret-with-at-least-thirty-two-bytes-2026";
const BASE_TIME = new Date("2026-07-10T00:00:00.000Z");
const PATIENT: SessionTokenPayload = {
  sub: "patient_001",
  role: "patient",
  mustChangePassword: false,
};

function secretBytes(): Uint8Array {
  return new TextEncoder().encode(TEST_SECRET);
}

async function directlySignedToken(
  claims: Record<string, unknown>,
  options: { issuer?: string; audience?: string; algorithm?: string } = {},
): Promise<string> {
  const issuedAt = Math.floor(BASE_TIME.getTime() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: options.algorithm ?? SESSION_ALGORITHM, typ: "JWT" })
    .setSubject(typeof claims.sub === "string" ? claims.sub : "patient_001")
    .setIssuer(options.issuer ?? SESSION_ISSUER)
    .setAudience(options.audience ?? SESSION_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 300)
    .sign(secretBytes());
}

function findRouteFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findRouteFiles(absolute));
    if (entry.isFile() && entry.name === "route.ts") files.push(absolute);
  }
  return files;
}

async function main(): Promise<void> {
  console.log("\nsigned auth session security\n");

  await test("valid patient token round-trips", async () => {
    const token = await signSessionToken(PATIENT, { secret: TEST_SECRET, now: BASE_TIME });
    const verified = await verifySessionToken(token, {
      secret: TEST_SECRET,
      now: new Date(BASE_TIME.getTime() + 1_000),
    });
    assert(verified !== null, "valid token rejected");
    assertEqual(verified.sub, PATIENT.sub, "subject");
    assertEqual(verified.role, PATIENT.role, "role");
    assertEqual(verified.mustChangePassword, false, "password-change flag");
  });

  await test("all valid roles and Unicode subject data survive signing", async () => {
    for (const role of ["patient", "therapist", "admin"] as const) {
      const payload: SessionTokenPayload = {
        sub: `${role}_José_測試`,
        role,
        mustChangePassword: role === "therapist",
      };
      const token = await signSessionToken(payload, { secret: TEST_SECRET, now: BASE_TIME });
      const verified = await verifySessionToken(token, { secret: TEST_SECRET, now: BASE_TIME });
      assertEqual(verified?.sub, payload.sub, `${role} subject`);
      assertEqual(verified?.role, role, `${role} role`);
      assertEqual(verified?.mustChangePassword, payload.mustChangePassword, `${role} flag`);
    }
  });

  await test("payload or signature tampering is rejected", async () => {
    const token = await signSessionToken(PATIENT, { secret: TEST_SECRET, now: BASE_TIME });
    const parts = token.split(".");
    assertEqual(parts.length, 3, "JWT segment count");
    const tamperedPayload = `${parts[0]}.${parts[1].slice(0, -1)}${parts[1].endsWith("a") ? "b" : "a"}.${parts[2]}`;
    const tamperedSignature = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}${parts[2].endsWith("a") ? "b" : "a"}`;
    assertEqual(await verifySessionToken(tamperedPayload, { secret: TEST_SECRET, now: BASE_TIME }), null, "payload tamper");
    assertEqual(await verifySessionToken(tamperedSignature, { secret: TEST_SECRET, now: BASE_TIME }), null, "signature tamper");
  });

  await test("legacy JSON and malformed tokens are rejected without throwing", async () => {
    const invalidTokens = [
      JSON.stringify({ id: "admin_001", role: "admin" }),
      "",
      "not-a-token",
      "a.b",
      "a.b.c.d",
      "@@@.@@@.@@@",
    ];
    for (const token of invalidTokens) {
      assertEqual(
        await verifySessionToken(token, { secret: TEST_SECRET, now: BASE_TIME }),
        null,
        `invalid token ${token}`,
      );
    }
  });

  await test("expiry is enforced at the exact exp boundary", async () => {
    const token = await signSessionToken(PATIENT, {
      secret: TEST_SECRET,
      now: BASE_TIME,
      maxAgeSeconds: 60,
    });
    const before = await verifySessionToken(token, {
      secret: TEST_SECRET,
      now: new Date(BASE_TIME.getTime() + 59_000),
      maxAgeSeconds: 60,
    });
    const atExpiry = await verifySessionToken(token, {
      secret: TEST_SECRET,
      now: new Date(BASE_TIME.getTime() + 60_000),
      maxAgeSeconds: 60,
    });
    assert(before !== null, "token expired too early");
    assertEqual(atExpiry, null, "token accepted at exp");
  });

  await test("wrong issuer, audience, algorithm, and semantic role are rejected", async () => {
    const baseClaims = { sub: "patient_001", role: "patient", mustChangePassword: false };
    const wrongIssuer = await directlySignedToken(baseClaims, { issuer: "other-app" });
    const wrongAudience = await directlySignedToken(baseClaims, { audience: "other-audience" });
    const wrongAlgorithm = await directlySignedToken(baseClaims, { algorithm: "HS512" });
    const wrongRole = await directlySignedToken({ ...baseClaims, role: "superadmin" });
    for (const token of [wrongIssuer, wrongAudience, wrongAlgorithm, wrongRole]) {
      assertEqual(await verifySessionToken(token, { secret: TEST_SECRET, now: BASE_TIME }), null, "invalid signed token");
    }
  });

  await test("missing, whitespace-only, and weak secrets fail closed", async () => {
    await assertRejectsConfiguration(
      () => signSessionToken(PATIENT, { secret: "" }),
      "empty secret",
    );
    await assertRejectsConfiguration(
      () => signSessionToken(PATIENT, { secret: "                                " }),
      "whitespace secret",
    );
    await assertRejectsConfiguration(
      () => signSessionToken(PATIENT, { secret: "too-short" }),
      "short secret",
    );

    const previous = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      await assertRejectsConfiguration(
        () => verifySessionToken("not-a-token"),
        "missing environment secret",
      );
    } finally {
      if (previous === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previous;
    }
  });

  await test("cookie flags retain the hardened seven-day configuration", () => {
    assertEqual(SESSION_COOKIE_OPTIONS.httpOnly, true, "HttpOnly");
    assertEqual(SESSION_COOKIE_OPTIONS.sameSite, "lax", "SameSite");
    assertEqual(SESSION_COOKIE_OPTIONS.path, "/", "Path");
    assertEqual(SESSION_COOKIE_OPTIONS.maxAge, 60 * 60 * 24 * 7, "Max-Age");
  });

  await test("proxy rejects invalid sessions and enforces first-login password change", async () => {
    const previous = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = TEST_SECRET;
    try {
      const freshNormal = await signSessionToken(PATIENT, { secret: TEST_SECRET });
      const freshPasswordChange = await signSessionToken(
        { ...PATIENT, mustChangePassword: true },
        { secret: TEST_SECRET },
      );

      const missing = await proxy(new NextRequest("http://localhost/dashboard"));
      assertEqual(missing.status, 307, "missing-cookie status");
      assertEqual(missing.headers.get("location"), "http://localhost/login", "missing-cookie redirect");

      const invalid = await proxy(
        new NextRequest("http://localhost/camera", {
          headers: { cookie: "auth_token=forged-value" },
        }),
      );
      assertEqual(invalid.status, 307, "invalid-cookie status");
      assert(
        invalid.headers.get("set-cookie")?.includes("auth_token=") === true,
        "invalid cookie was not cleared",
      );

      const valid = await proxy(
        new NextRequest("http://localhost/dashboard", {
          headers: { cookie: `auth_token=${freshNormal}` },
        }),
      );
      assertEqual(valid.headers.get("x-middleware-next"), "1", "valid session pass-through");

      const forcedChange = await proxy(
        new NextRequest("http://localhost/dashboard", {
          headers: { cookie: `auth_token=${freshPasswordChange}` },
        }),
      );
      assertEqual(
        forcedChange.headers.get("location"),
        "http://localhost/change-password",
        "password-change redirect",
      );

      const changePage = await proxy(
        new NextRequest("http://localhost/change-password", {
          headers: { cookie: `auth_token=${freshPasswordChange}` },
        }),
      );
      assertEqual(changePage.headers.get("x-middleware-next"), "1", "change page pass-through");
    } finally {
      if (previous === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previous;
    }
  });

  await test("all protected API routes use the centralized database-backed auth helper", () => {
    const cwd = process.cwd();
    const webRoot = existsSync(path.join(cwd, "src", "app", "api")) ? cwd : path.join(cwd, "web");
    const apiRoot = path.join(webRoot, "src", "app", "api");
    const publicRoutes = new Set([
      path.join(apiRoot, "auth", "login", "route.ts"),
      path.join(apiRoot, "auth", "forgot-password", "route.ts"),
      path.join(apiRoot, "auth", "verify-otp", "route.ts"),
      path.join(apiRoot, "auth", "reset-password", "route.ts"),
    ]);

    for (const routeFile of findRouteFiles(apiRoot)) {
      const source = readFileSync(routeFile, "utf8");
      assert(!source.includes("JSON.parse(authToken.value)"), `${routeFile} still parses cookie JSON`);
      assert(!source.includes('cookies.get("auth_token")'), `${routeFile} reads the raw cookie name`);
      assert(
        publicRoutes.has(routeFile) || source.includes("getAuthenticatedUser"),
        `${routeFile} lacks centralized authentication`,
      );
    }

    const proxySource = readFileSync(path.join(webRoot, "src", "proxy.ts"), "utf8");
    assert(proxySource.includes("verifySessionToken"), "proxy does not verify signatures");
    assert(!proxySource.includes('cookies.get("auth_token")'), "proxy reads raw cookie name");
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
