import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  plannerModel: string;
  inboxModel: string;
  // OpenCode asks every client for a stable session id. other providers ignore it.
  sessionId?: string;
}

// any OpenAI-compatible endpoint. the key is handed in, this file never reads the environment.
export function createModels(config: LlmConfig) {
  const provider = createOpenAICompatible({
    name: 'fork-llm',
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    // say who we are. FORK is not a coding tool and does not pretend to be one.
    headers: {
      'user-agent': 'fork-engine/0.1',
      ...(config.sessionId ? { 'x-opencode-session': config.sessionId } : {}),
    },
  });
  return { planner: provider(config.plannerModel), inbox: provider(config.inboxModel) };
}
