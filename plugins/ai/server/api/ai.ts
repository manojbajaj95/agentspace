import Router from "koa-router";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import validate from "@server/middlewares/validate";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { completeAskAI } from "../openrouter";
import * as T from "./schema";

const router = new Router();

router.post(
  "ai.ask",
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  auth(),
  validate(T.AIAskSchema),
  async (ctx: APIContext<T.AIAskReq>) => {
    const { prompt, documentMarkdown } = ctx.input.body;
    const markdown = await completeAskAI(prompt, documentMarkdown);

    ctx.body = {
      data: {
        markdown,
      },
    };
  }
);

export default router;
