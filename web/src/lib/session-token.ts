import { SignJWT, jwtVerify } from "jose";

export type UserRole = "patient" | "therapist" | "admin";

export type SessionTokenPayload = {
  sub: string;
  role: UserRole;
  mustChangePassword: boolean;
};

export type SessionTokenOptions = {
  secret?: string;
  now?: Date;
  maxAgeSeconds?: number;
};

export const AUTH_COOKIE_NAME = "auth_token";
export const SESSION_ALGORITHM = "HS256";
export const SESSION_ISSUER = "postural-web";
export const SESSION_AUDIENCE = "postural-session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export const SESSION_COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: SESSION_MAX_AGE_SECONDS,
  path: "/",
});

export const SESSION_COOKIE_CLEAR_OPTIONS = Object.freeze({
  ...SESSION_COOKIE_OPTIONS,
  expires: new Date(0),
  maxAge: 0,
});

export class SessionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionConfigurationError";
  }
}

const textEncoder = new TextEncoder();

function isUserRole(value: unknown): value is UserRole {
  return value === "patient" || value === "therapist" || value === "admin";
}

function getSessionSettings(options: SessionTokenOptions = {}) {
  const secret = options.secret ?? process.env.SESSION_SECRET;
  if (typeof secret !== "string" || secret.trim().length === 0) {
    throw new SessionConfigurationError("SESSION_SECRET is required");
  }

  const key = textEncoder.encode(secret);
  if (key.byteLength < 32) {
    throw new SessionConfigurationError(
      "SESSION_SECRET must contain at least 32 UTF-8 bytes",
    );
  }

  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new SessionConfigurationError("Session clock must be a valid Date");
  }

  const maxAgeSeconds = options.maxAgeSeconds ?? SESSION_MAX_AGE_SECONDS;
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new SessionConfigurationError(
      "Session maxAgeSeconds must be a positive integer",
    );
  }

  return { key, now, maxAgeSeconds };
}

export async function signSessionToken(
  payload: SessionTokenPayload,
  options: SessionTokenOptions = {},
): Promise<string> {
  const { key, now, maxAgeSeconds } = getSessionSettings(options);

  if (
    typeof payload.sub !== "string" ||
    payload.sub.trim().length === 0 ||
    !isUserRole(payload.role) ||
    typeof payload.mustChangePassword !== "boolean"
  ) {
    throw new TypeError("Invalid session token payload");
  }

  const issuedAt = Math.floor(now.getTime() / 1000);

  return new SignJWT({
    role: payload.role,
    mustChangePassword: payload.mustChangePassword,
  })
    .setProtectedHeader({ alg: SESSION_ALGORITHM, typ: "JWT" })
    .setSubject(payload.sub)
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + maxAgeSeconds)
    .sign(key);
}

export async function verifySessionToken(
  token: string | null | undefined,
  options: SessionTokenOptions = {},
): Promise<SessionTokenPayload | null> {
  // Resolve configuration before inspecting the token so deployment mistakes
  // fail closed instead of looking like an ordinary unauthenticated request.
  const { key, now, maxAgeSeconds } = getSessionSettings(options);

  if (typeof token !== "string" || token.length === 0) return null;

  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: [SESSION_ALGORITHM],
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
      currentDate: now,
      maxTokenAge: maxAgeSeconds,
    });

    if (
      typeof payload.sub !== "string" ||
      payload.sub.trim().length === 0 ||
      !isUserRole(payload.role) ||
      typeof payload.mustChangePassword !== "boolean" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }

    return {
      sub: payload.sub,
      role: payload.role,
      mustChangePassword: payload.mustChangePassword,
    };
  } catch {
    return null;
  }
}
