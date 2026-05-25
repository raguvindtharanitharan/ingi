import type Anthropic from '@anthropic-ai/sdk';

export type AnthropicClient = Anthropic;

export async function createAnthropicClient(apiKey: string): Promise<AnthropicClient> {
  const { default: AnthropicSDK } = await import('@anthropic-ai/sdk');
  return new AnthropicSDK({ apiKey });
}

export interface ClaudeResult {
  result: string | null;
  inputTokens: number;
  outputTokens: number;
}

export async function callClaude(
  client: AnthropicClient,
  model: string,
  prompt: string
): Promise<ClaudeResult> {
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = response.content.find((b) => b.type === 'text');
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    if (!block || block.type !== 'text') return { result: null, inputTokens, outputTokens };

    const parsed = JSON.parse(stripCodeFence(block.text)) as { result?: string };
    const result = parsed.result?.trim() || null;
    return { result, inputTokens, outputTokens };
  } catch {
    return { result: null, inputTokens: 0, outputTokens: 0 };
  }
}

function stripCodeFence(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  return match ? match[1].trim() : text.trim();
}
