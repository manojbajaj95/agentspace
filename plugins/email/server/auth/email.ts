import Router from "koa-router";
import { errToString } from "@shared/utils/error";
import { Client, NotificationEventType, UserRole } from "@shared/types";
import { parseDomain } from "@shared/utils/domains";
import slugify from "@shared/utils/slugify";
import { provisionFirstCollection } from "@server/commands/accountProvisioner";
import teamCreator from "@server/commands/teamCreator";
import { createContext } from "@server/context";
import InviteAcceptedEmail from "@server/emails/templates/InviteAcceptedEmail";
import SigninEmail from "@server/emails/templates/SigninEmail";
import WelcomeEmail from "@server/emails/templates/WelcomeEmail";
import env from "@server/env";
import { AuthorizationError } from "@server/errors";
import Logger from "@server/logging/Logger";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { User, Team } from "@server/models";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { VerificationCode } from "@server/utils/VerificationCode";
import { signIn } from "@server/utils/authentication";
import {
  getEmailForSignupToken,
  getJWTPayload,
  getUserForEmailSigninToken,
  signEmailSignupToken,
} from "@server/utils/jwt";
import { getTeamFromContext } from "@server/utils/passport";
import * as T from "./schema";
import { CSRF } from "@shared/constants";

const router = new Router();

/**
 * Returns whether this self-hosted install can bootstrap the first workspace
 * via email magic link (no teams exist yet and email is available).
 *
 * @returns true when email signup bootstrap is allowed.
 */
async function canBootstrapWithEmail(): Promise<boolean> {
  if (env.isCloudHosted || !env.EMAIL_ENABLED) {
    return false;
  }

  const teamCount = await Team.count();
  return teamCount === 0;
}

router.post(
  "email",
  rateLimiter(RateLimiterStrategy.TenPerHour),
  validate(T.EmailSchema),
  async (ctx: APIContext<T.EmailReq>) => {
    const { email, client, preferOTP } = ctx.input.body;
    const normalizedEmail = email.toLowerCase();

    const domain = parseDomain(ctx.request.hostname);

    let team: Team | null | undefined;
    if (!env.isCloudHosted) {
      team = await Team.scope("withAuthenticationProviders").findOne();
    } else if (domain.custom) {
      team = await Team.scope("withAuthenticationProviders").findOne({
        where: { domain: domain.host.toLowerCase() },
      });
    } else if (domain.teamSubdomain) {
      team = await Team.scope("withAuthenticationProviders").findOne({
        where: { subdomain: domain.teamSubdomain },
      });
    }

    // Self-hosted first-run: send a signup magic link that creates the workspace.
    // OTP is not supported for bootstrap signup; always send a magic link.
    if (!team && (await canBootstrapWithEmail())) {
      const token = signEmailSignupToken(ctx, normalizedEmail);

      await new SigninEmail({
        to: normalizedEmail,
        token,
        teamUrl: env.URL,
        client,
      }).schedule();

      ctx.body = {
        success: true,
      };
      return;
    }

    if (!team?.emailSigninEnabled) {
      throw AuthorizationError();
    }

    const user = await User.scope("withAuthentications").findOne({
      where: {
        teamId: team.id,
        email: normalizedEmail,
      },
    });

    if (!user) {
      ctx.body = {
        success: true,
      };
      return;
    }

    // If the user matches an email address associated with an SSO
    // provider then just forward them directly to that sign-in page
    if (user.authentications.length) {
      const authenticationProvider =
        user.authentications[0].authenticationProvider;
      ctx.body = {
        redirect: `${team.url}/auth/${authenticationProvider?.name}`,
      };
      return;
    }

    // Generate both a link token and a 6-digit verification code
    const token = preferOTP ? undefined : user.getEmailSigninToken(ctx);
    const verificationCode = preferOTP
      ? await user.getEmailVerificationCode()
      : undefined;

    // send email to users email address with a short-lived token and code
    await new SigninEmail({
      to: user.email,
      language: user.language,
      token,
      teamUrl: team.url,
      client,
      verificationCode,
    }).schedule();

    user.lastSigninEmailSentAt = new Date();
    await user.save();

    // respond with success regardless of whether an email was sent
    ctx.body = {
      success: true,
    };
  }
);

const emailCallback = async (ctx: APIContext<T.EmailCallbackReq>) => {
  const { query, body } = ctx.input;
  const token = query?.token || body?.token;
  const client = query?.client || body?.client || Client.Web;
  const follow = query?.follow || body?.follow;
  const code = query?.code || body?.code;
  const email = query?.email || body?.email;

  // The link in the email does not include the follow query param, this
  // is to help prevent anti-virus, and email clients from pre-fetching the link
  // and spending the token before the user clicks on it. Instead we redirect
  // to the same URL with the follow query param added from the client side.
  if (!follow) {
    const csrfToken = ctx.cookies.get(CSRF.cookieName);

    // Parse the current URL to extract existing query parameters
    const url = new URL(ctx.request.href);
    const searchParams = url.searchParams;

    // Add new parameters
    searchParams.set("follow", "true");
    if (csrfToken) {
      searchParams.set(CSRF.fieldName, csrfToken);
    }

    // Reconstruct the URL with merged parameters
    url.search = searchParams.toString();

    return ctx.redirectOnClient(url.toString(), "POST");
  }

  let user: User | null = null;

  try {
    if (token) {
      let payloadType: string | undefined;
      try {
        payloadType = getJWTPayload(token as string).type;
      } catch {
        payloadType = undefined;
      }

      if (payloadType === "email-signup") {
        await completeEmailSignup(ctx, token as string, client);
        return;
      }

      user = await getUserForEmailSigninToken(ctx, token as string);
    } else if (code && email) {
      const team = await getTeamFromContext(ctx);

      if (!team) {
        ctx.redirect("/?notice=auth-error&description=Unknown%20team");
        return;
      }

      user = await User.scope("withTeam").findOne({
        where: {
          teamId: team.id,
          email: email.trim().toLowerCase(),
        },
      });

      if (!user || !(await VerificationCode.verify(team.id, email, code))) {
        ctx.redirect(`/?notice=invalid-code`);
        return;
      }

      // Delete the code after successful verification
      await VerificationCode.delete(team.id, email);
    } else {
      ctx.redirect("/?notice=auth-error&description=Missing%20token");
      return;
    }
  } catch (err) {
    const message = errToString(err);
    Logger.debug("authentication", message);
    return ctx.redirect(
      `/?notice=auth-error&description=${encodeURIComponent(message)}`
    );
  }

  if (!user) {
    return ctx.redirect(`/?notice=invalid-code`);
  }

  if (!user.team.emailSigninEnabled) {
    return ctx.redirect(
      "/?notice=auth-error&description=Disabled%20signin%20method"
    );
  }

  if (user.isSuspended) {
    return ctx.redirect("/?notice=user-suspended");
  }

  if (user.isInvited) {
    await new WelcomeEmail({
      to: user.email,
      language: user.language,
      role: user.role,
      teamUrl: user.team.url,
    }).schedule();

    const inviter = await user.$get("invitedBy");
    if (inviter?.subscribedToEventType(NotificationEventType.InviteAccepted)) {
      await new InviteAcceptedEmail({
        to: inviter.email,
        language: inviter.language,
        inviterId: inviter.id,
        invitedName: user.name,
        teamUrl: user.team.url,
      }).schedule();
    }
  }

  // set cookies on response and redirect to team subdomain
  await signIn(ctx, "email", {
    user,
    team: user.team,
    isNewTeam: false,
    isNewUser: false,
    client,
  });
};

/**
 * Completes first-run workspace bootstrap from an email signup magic link.
 *
 * @param ctx the API context for the callback request.
 * @param token the email-signup JWT.
 * @param client the client initiating sign-in.
 */
async function completeEmailSignup(
  ctx: APIContext,
  token: string,
  client: Client
) {
  if (!(await canBootstrapWithEmail())) {
    ctx.redirect(
      "/?notice=auth-error&description=Installation%20already%20configured"
    );
    return;
  }

  const email = await getEmailForSignupToken(ctx, token);
  const localPart = email.split("@")[0] || "admin";
  const teamName = env.APP_NAME || "Wiki";

  const team = await teamCreator(ctx, {
    name: teamName,
    subdomain: slugify(localPart),
    authenticationProviders: [],
  });

  // Ensure email magic link remains available after bootstrap.
  if (!team.guestSignin) {
    await team.update({ guestSignin: true });
  }

  const user = await User.createWithCtx(ctx, {
    name: localPart,
    email,
    teamId: team.id,
    role: UserRole.Admin,
  });

  const provisionCtx = createContext({
    user,
    ip: ctx.request.ip,
    transaction: ctx.state.transaction,
  });
  await provisionFirstCollection(provisionCtx, team, user);

  await new WelcomeEmail({
    to: user.email,
    language: user.language,
    role: user.role,
    teamUrl: team.url,
  }).schedule();

  await signIn(ctx, "email", {
    user,
    team,
    isNewTeam: true,
    isNewUser: true,
    client,
  });
}

router.get(
  "email.callback",
  rateLimiter(RateLimiterStrategy.FivePerMinute),
  validate(T.EmailCallbackSchema),
  emailCallback
);
router.post(
  "email.callback",
  rateLimiter(RateLimiterStrategy.FivePerMinute),
  validate(T.EmailCallbackSchema),
  transaction(),
  emailCallback
);

export default router;
