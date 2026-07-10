import type { Context } from "koa";
import {
  getEmailForSignupToken,
  getJWTPayload,
  signEmailSignupToken,
} from "./jwt";

function mockContext(ip = "127.0.0.1"): Context {
  return {
    request: { ip },
  } as Context;
}

describe("email signup tokens", () => {
  it("should sign and verify a signup token for the same IP", async () => {
    const email = "admin@example.com";
    const ctx = mockContext();
    const token = signEmailSignupToken(ctx, email);

    expect(getJWTPayload(token).type).toEqual("email-signup");
    await expect(getEmailForSignupToken(ctx, token)).resolves.toEqual(email);
  });

  it("should reject a signup token from a different IP", async () => {
    const token = signEmailSignupToken(mockContext("1.2.3.4"), "a@example.com");

    await expect(
      getEmailForSignupToken(mockContext("5.6.7.8"), token)
    ).rejects.toThrow("Token mismatch");
  });

  it("should reject a reused signup token", async () => {
    const ctx = mockContext();
    const token = signEmailSignupToken(ctx, "a@example.com");

    await getEmailForSignupToken(ctx, token);
    await expect(getEmailForSignupToken(ctx, token)).rejects.toThrow(
      "Token has already been used"
    );
  });
});
