import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";

export const AIAskSchema = BaseSchema.extend({
  body: z.object({
    prompt: z.string().trim().min(1).max(4000),
    documentMarkdown: z.string().max(100_000).default(""),
  }),
});

export type AIAskReq = z.infer<typeof AIAskSchema>;
