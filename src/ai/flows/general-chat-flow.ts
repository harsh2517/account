
'use server';
/**
 * @fileOverview A general purpose chat flow using a Google AI model.
 *
 * - generalChat - A function that takes a user prompt and returns an AI response.
 * - GeneralChatInput - The input type for the generalChat function.
 * - GeneralChatOutput - The return type for the generalChat function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const GeneralChatInputSchema = z.object({
  prompt: z.string().describe("The user's input/question to the AI."),
});
export type GeneralChatInput = z.infer<typeof GeneralChatInputSchema>;

const GeneralChatOutputSchema = z.object({
  response: z.string().describe("The AI's response to the user's prompt."),
});
export type GeneralChatOutput = z.infer<typeof GeneralChatOutputSchema>;

export async function generalChat(input: GeneralChatInput): Promise<GeneralChatOutput> {
  return generalChatFlow(input);
}

const chatPrompt = ai.definePrompt({
  name: 'generalChatPrompt',
  input: { schema: GeneralChatInputSchema },
  output: { schema: GeneralChatOutputSchema },
  prompt: `You are a helpful AI assistant.
User: {{{prompt}}}
AI:`,
  config: {
    temperature: 0.2,
  }
});

const generalChatFlow = ai.defineFlow(
  {
    name: 'generalChatFlow',
    inputSchema: GeneralChatInputSchema,
    outputSchema: GeneralChatOutputSchema,
  },
  async (input) => {
    const llmResponse = await chatPrompt(input);
    if (llmResponse.output) {
      return { response: llmResponse.output.response };
    }
    return { response: "Sorry, I couldn't generate a response at this time." };
  }
);
