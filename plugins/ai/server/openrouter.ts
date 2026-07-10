import { InternalError } from "@server/errors";
import Logger from "@server/logging/Logger";
import env from "./env";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_CONTEXT_CHARS = 50_000;

interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenRouterChoice {
  message?: {
    content?: string | null;
  };
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  error?: {
    message?: string;
  };
}

/**
 * Calls OpenRouter with the user prompt and optional document context.
 *
 * @param prompt the user's Ask AI prompt.
 * @param documentMarkdown the current document as markdown, used as context.
 * @returns the model response as markdown text.
 */
export async function completeAskAI(
  prompt: string,
  documentMarkdown: string
): Promise<string> {
  if (!env.OPENROUTER_API_KEY) {
    throw InternalError("OPENROUTER_API_KEY is not configured");
  }

  const context =
    documentMarkdown.length > MAX_CONTEXT_CHARS
      ? `${documentMarkdown.slice(0, MAX_CONTEXT_CHARS)}\n\n[Document truncated]`
      : documentMarkdown;

  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content:
        "You are a writing assistant inside a document editor. Answer using the document as context when relevant. Return Markdown only.",
    },
    {
      role: "user",
      content: [
        "## Document context",
        context.trim() || "(empty document)",
        "",
        "## Request",
        prompt,
      ].join("\n"),
    },
  ];

  let response: Response;
  try {
    response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.URL,
        "X-Title": env.APP_NAME,
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL,
        messages,
      }),
    });
  } catch (err) {
    Logger.error("OpenRouter request failed", err as Error);
    throw InternalError("Failed to reach OpenRouter");
  }

  const data = (await response.json()) as OpenRouterResponse;

  if (!response.ok) {
    Logger.error(
      "OpenRouter returned an error",
      new Error(data.error?.message || `HTTP ${response.status}`),
      {
        status: response.status,
      }
    );
    throw InternalError(
      data.error?.message || "OpenRouter request was unsuccessful"
    );
  }

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw InternalError("OpenRouter returned an empty response");
  }

  return content;
}
