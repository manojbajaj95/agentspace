import { PluginManager, Hook } from "@server/utils/PluginManager";
import config from "../plugin.json";
import router from "./api/ai";
import env from "./env";

const enabled = !!env.OPENROUTER_API_KEY;

if (enabled) {
  PluginManager.add([
    {
      ...config,
      type: Hook.API,
      value: router,
    },
  ]);
}
