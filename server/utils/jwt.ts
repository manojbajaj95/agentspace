import crypto from "node:crypto";
import { subMinutes } from "date-fns";
import JWT from "jsonwebtoken";
import type { FindOptions } from "sequelize";
import env from "@server/env";
import { Team, User } from "@server/models";
import { AuthenticationError, UserSuspendedError } from "../errors";
import type { Context } from "koa";
import Redis from "@server/storage/redis";

/**
 * Decodes a JWT token and returns its payload without verifying the
 * signature.
 *
 * @param token the JWT token to decode.
 * @returns the decoded token payload.
 * @throws AuthenticationError if the token is missing or cannot be decoded.
 */
export function getJWTPayload(token: string) {
  let payload;
  if (!token) {
    throw AuthenticationError("Missing token");
  }

  try {
    payload = JWT.decode(token);

    if (!payload) {
      throw AuthenticationError("Invalid token");
    }

    return payload as JWT.JwtPayload;
  } catch (_err) {
    throw AuthenticationError("Unable to decode token");
  }
}

/**
 * Retrieves the user associated with a JWT token, validating the token's type and expiration.
 *
 * @param token The JWT token to validate and extract the user from.
 * @param allowedTypes An array of allowed token types (default: ["session", "transfer"]). The token's type must be included in this array to be considered valid.
 * @returns An object containing the user associated with the token and an optional service string if included in the token's payload.
 * @throws AuthenticationError if the token is missing, invalid, expired, or if the token's type is not allowed.
 * @throws UserSuspendedError if the user associated with the token is suspended.
 */
export async function getUserForJWT(
  token: string,
  allowedTypes = ["session", "transfer"]
): Promise<{ user: User; service?: string }> {
  const payload = getJWTPayload(token);

  if (!allowedTypes.includes(payload.type)) {
    throw AuthenticationError("Invalid token");
  }

  // check the token is within it's expiration time
  if (payload.expiresAt) {
    if (new Date(payload.expiresAt) < new Date()) {
      throw AuthenticationError("Expired token");
    }
  }

  const user = await User.findByPk(payload.id, {
    include: [
      {
        model: Team,
        as: "team",
        required: true,
      },
    ],
  });
  if (!user) {
    throw AuthenticationError("Invalid token");
  }

  if (user.isSuspended) {
    const suspendingAdmin = user.suspendedById
      ? await User.findByPk(user.suspendedById)
      : undefined;
    throw UserSuspendedError({
      adminEmail: suspendingAdmin?.email || undefined,
    });
  }

  if (payload.type === "transfer") {
    // If the user has made a single API request since the transfer token was
    // created then it's no longer valid, they'll need to sign in again.
    if (
      user.lastActiveAt &&
      payload.createdAt &&
      user.lastActiveAt > new Date(payload.createdAt)
    ) {
      throw AuthenticationError("Token has already been used");
    }
  }

  try {
    JWT.verify(token, user.jwtSecret);
  } catch (_err) {
    throw AuthenticationError("Invalid token");
  }

  return {
    user,
    service: payload.service as string | undefined,
  };
}

/**
 * Retrieves the user associated with an email sign-in token, validating the
 * token's type, expiration, and originating IP address.
 *
 * @param ctx the Koa context of the current request.
 * @param token the email sign-in token to validate.
 * @returns the user associated with the token.
 * @throws AuthenticationError if the token is invalid, expired, or from a different IP.
 */
export async function getUserForEmailSigninToken(
  ctx: Context,
  token: string
): Promise<User> {
  const payload = getJWTPayload(token);

  if (payload.type !== "email-signin") {
    throw AuthenticationError("Invalid token");
  }

  // check the token is within it's expiration time
  if (payload.createdAt) {
    if (new Date(payload.createdAt) < subMinutes(new Date(), 10)) {
      throw AuthenticationError("Expired token");
    }
  }

  if (payload.ip !== ctx.request.ip) {
    throw AuthenticationError("Token mismatch");
  }

  const user = await User.scope("withTeam").findByPk(payload.id, {
    rejectOnEmpty: true,
  });

  try {
    JWT.verify(token, user.jwtSecret);
  } catch (_err) {
    throw AuthenticationError("Invalid token");
  }

  return user;
}

/**
 * Creates a short-lived token used to bootstrap the first workspace via email
 * magic link on a self-hosted installation with no teams yet.
 *
 * @param ctx the Koa context of the current request.
 * @param email the email address requesting signup.
 * @returns a signed email signup token.
 */
export function signEmailSignupToken(ctx: Context, email: string): string {
  const jti = crypto.randomBytes(16).toString("hex");

  return JWT.sign(
    {
      email: email.toLowerCase(),
      ip: ctx.request.ip,
      createdAt: new Date().toISOString(),
      type: "email-signup",
      jti,
    },
    env.SECRET_KEY
  );
}

/**
 * Validates an email signup token and returns the email address to provision.
 * Tokens are single-use and bound to the requesting IP address.
 *
 * @param ctx the Koa context of the current request.
 * @param token the email signup token to validate.
 * @returns the email address associated with the token.
 * @throws AuthenticationError if the token is invalid, expired, reused, or from a different IP.
 */
export async function getEmailForSignupToken(
  ctx: Context,
  token: string
): Promise<string> {
  const payload = getJWTPayload(token);

  if (payload.type !== "email-signup") {
    throw AuthenticationError("Invalid token");
  }

  if (payload.createdAt) {
    if (new Date(payload.createdAt) < subMinutes(new Date(), 10)) {
      throw AuthenticationError("Expired token");
    }
  }

  if (payload.ip !== ctx.request.ip) {
    throw AuthenticationError("Token mismatch");
  }

  if (typeof payload.email !== "string" || !payload.email) {
    throw AuthenticationError("Invalid token");
  }

  if (typeof payload.jti !== "string" || !payload.jti) {
    throw AuthenticationError("Invalid token");
  }

  try {
    JWT.verify(token, env.SECRET_KEY);
  } catch (_err) {
    throw AuthenticationError("Invalid token");
  }

  const redisKey = `email_signup_token:${payload.jti}`;
  // Atomically claim the token so concurrent callbacks cannot both succeed.
  const claimed = await Redis.defaultClient.set(
    redisKey,
    "1",
    "EX",
    15 * 60,
    "NX"
  );
  if (claimed !== "OK") {
    throw AuthenticationError("Token has already been used");
  }

  return payload.email.toLowerCase();
}

/**
 * Retrieves the user and new email address associated with an email update
 * token, validating the token's type and expiration.
 *
 * @param token the email update token to validate.
 * @param options find options passed when loading the user.
 * @returns the user and the new email address.
 * @throws AuthenticationError if the token is invalid or expired.
 */
export async function getDetailsForEmailUpdateToken(
  token: string,
  options: FindOptions<User> = {}
): Promise<{ user: User; email: string }> {
  const payload = getJWTPayload(token);

  if (payload.type !== "email-update") {
    throw AuthenticationError("Invalid token");
  }

  // check the token is within it's expiration time
  if (payload.createdAt) {
    if (new Date(payload.createdAt) < subMinutes(new Date(), 10)) {
      throw AuthenticationError("Expired token");
    }
  }

  const email = payload.email;
  const user = await User.findByPk(payload.id, {
    rejectOnEmpty: true,
    ...options,
  });

  try {
    JWT.verify(token, user.jwtSecret);
  } catch (_err) {
    throw AuthenticationError("Invalid token");
  }

  return { user, email };
}
