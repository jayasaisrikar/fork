import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  plannerModel: string;
  inboxModel: string;
}

// any OpenAI-compatible endpoint. the key is handed in, this file never reads the environment.
export function createModels(config: LlmConfig) {
  const provider = createOpenAICompatible({
    name: 'fork-llm',
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    headers: { 'user-agent': 'fork-engine/0.1' },
  });
  return { planner: provider(config.plannerModel), inbox: provider(config.inboxModel) };
}
