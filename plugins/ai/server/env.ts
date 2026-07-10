import { IsOptional } from "class-validator";
import { Environment } from "@server/env";
import environment from "@server/utils/environment";

class AIPluginEnvironment extends Environment {
  /**
   * OpenRouter API key used for Ask AI completions.
   */
  @IsOptional()
  public OPENROUTER_API_KEY = this.toOptionalString(
    environment.OPENROUTER_API_KEY
  );

  /**
   * OpenRouter model id used for Ask AI completions.
   */
  @IsOptional()
  public OPENROUTER_MODEL =
    this.toOptionalString(environment.OPENROUTER_MODEL) ?? "openrouter/free";
}

export default new AIPluginEnvironment();
