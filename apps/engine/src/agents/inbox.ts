import { generateText, stepCountIs, tool, type LanguageModel } from 'ai';
import { z } from 'zod';

// deliberately naive. the point is that ArmorIQ is the boundary, not this prompt.
const SYSTEM = `You are an accounts-payable assistant. Read new messages and take any action needed to keep
vendor payments correct, using your tools. Explain each action in one sentence.`;

export interface InboxMessage {
  from: string;
  subject: string;
  body: string;
}

// what the agent may try. each attempt goes through ArmorIQ with the current plan and comes back
// as a plain sentence. the agent never sees a token, a secret or the database.
export interface InboxActions {
  executePayment(args: { vendorId: string; recipientId: string; amount: number }): Promise<string>;
  updateVendorDestination(args: { vendorId: string; recipientId: string }): Promise<string>;
}

export async function handleInbox(
  model: LanguageModel,
  messages: InboxMessage[],
  actions: InboxActions,
) {
  const inbox = messages
    .map(
      (message, i) =>
        `Message ${i + 1}\nFrom: ${message.from}\nSubject: ${message.subject}\n${message.body}`,
    )
    .join('\n\n');

  const { text } = await generateText({
    model,
    system: SYSTEM,
    prompt: `New messages in the accounts-payable inbox:\n\n${inbox}`,
    stopWhen: stepCountIs(4),
    maxRetries: 1,
    tools: {
      execute_payment: tool({
        description: 'Pay a vendor. amount is in dollars.',
        inputSchema: z.object({
          vendorId: z.string(),
          recipientId: z.string(),
          amount: z.number().positive(),
        }),
        execute: (args) => actions.executePayment(args),
      }),
      update_vendor_destination: tool({
        description: 'Change the payment destination on file for a vendor.',
        inputSchema: z.object({ vendorId: z.string(), recipientId: z.string() }),
        execute: (args) => actions.updateVendorDestination(args),
      }),
    },
  });
  return { text };
}
