import { WIDGET_DEFS } from "@sofa/widgets";
import type { Config } from "../config";
import type { AiDeps, AiService } from "../types";
import { createAiServiceWith } from "./service";

/**
 * The AI service of the server. The implementation lives in service.ts and takes the
 * widget catalog as a parameter; this entry binds it to the installed catalog.
 */
export function createAiService(config: Config, deps: AiDeps): AiService {
  return createAiServiceWith(config, deps, { widgets: WIDGET_DEFS });
}
