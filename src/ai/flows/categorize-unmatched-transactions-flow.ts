
'use server';
/**
 * @fileOverview A Genkit flow for categorizing bank transactions using AI's general understanding,
 * guided by a provided chart of accounts.
 *
 * - categorizeUnmatchedUserTransactions - A function that attempts to categorize transactions using AI.
 * - CategorizeUnmatchedTransactionsInput - The Zod schema for the input.
 * - CategorizeUnmatchedTransactionsOutput - The Zod schema for the output.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// Schema for Firestore Timestamps (consistent with other flows)
const FirebaseTimestampSchema = z.object({
  seconds: z.number(),
  nanoseconds: z.number(),
}).nullable().optional();

// Schema for a single transaction (consistent with other flows)
// This schema is used for BOTH input and output, so confidenceScore is optional
const TransactionSchema = z.object({
  id: z.string(),
  userId: z.string().optional(),
  date: z.string(),
  description: z.string(),
  bankName: z.string().describe("The name of the bank for this transaction. This field should be preserved from the input."), // Added bankName
  vendor: z.string(),
  glAccount: z.string(),
  amountPaid: z.number().nullable(),
  amountReceived: z.number().nullable(),
  createdAt: FirebaseTimestampSchema,
  confidenceScore: z.number().min(0).max(1).optional().describe("The AI's confidence in the categorization, from 0.0 to 1.0. Omit if not applicable."),
});
export type Transaction = z.infer<typeof TransactionSchema>;

const CategorizeUnmatchedTransactionsInputSchema = z.object({
  transactionsToCategorize: z.array(TransactionSchema.omit({ confidenceScore: true })) // Input transactions won't have a confidence score yet
    .describe('An array of bank transactions that need categorization (vendor and/or GL account are missing or placeholders). Each transaction includes a bankName which must be preserved.'),
  availableGlAccounts: z.array(z.string())
    .describe('A list of valid General Ledger (GL) account names that the AI should choose from.'),
});
export type CategorizeUnmatchedTransactionsInput = z.infer<typeof CategorizeUnmatchedTransactionsInputSchema>;

const CategorizeUnmatchedTransactionsOutputSchema = z.object({
  aiCategorizedTransactions: z.array(TransactionSchema) // Output transactions will include the confidence score
    .describe('An array of transactions. For each input transaction, an output transaction is present, with potentially updated vendor and/or GL account and a confidence score. Original transaction fields, including bankName, are preserved.'),
});
export type CategorizeUnmatchedTransactionsOutput = z.infer<typeof CategorizeUnmatchedTransactionsOutputSchema>;


// New Schemas for AI's direct output (suggestions only)
// bankName is NOT needed here, as it will be merged from the original transaction object by the flow.
const AiSuggestionSchema = z.object({
  id: z.string().describe("The ID of the original transaction this suggestion pertains to."),
  suggestedVendor: z.string().describe("The AI's inferred vendor name. Use original value or '-' if no confident suggestion."),
  suggestedGlAccount: z.string().describe("The AI's selected GL account from the provided list. Use original value or '-' if no suitable account."),
  confidenceScore: z.number().min(0).max(1).describe("The AI's confidence in the categorization, from 0.0 to 1.0."),
});
export type AiSuggestion = z.infer<typeof AiSuggestionSchema>;

// This schema is used for type hinting and internal processing, but not for strict output validation by Genkit for this prompt.
const AiCategorizePromptOutputSchema = z.object({
  suggestions: z.array(AiSuggestionSchema).describe("An array of categorization suggestions, one for each input transaction ID.")
});


const aiCategorizePrompt = ai.definePrompt({
  name: 'aiCategorizeUnmatchedTransactionsPrompt',
  input: { schema: CategorizeUnmatchedTransactionsInputSchema }, // Still takes the full input (including bankName in transactionsToCategorize)
  // output: { schema: AiCategorizePromptOutputSchema }, // Output schema validation removed for now
  prompt: `You are an expert AI financial data processor.
You will be given a list of 'transactionsToCategorize' (each with an 'id', 'description', 'bankName', current 'vendor', current 'glAccount', etc.) and a list of 'availableGlAccounts'.
The 'bankName' field from the input transaction MUST be preserved in the final output of the wrapping flow, but you do not need to include it in your direct 'suggestions' output.

Your goal is to provide a 'suggestedVendor', 'suggestedGlAccount', and a 'confidenceScore' for EACH transaction ID in the 'transactionsToCategorize' list.

For every transaction ID provided in the 'transactionsToCategorize' input:
1.  Find the corresponding transaction object in the input by its 'id' to access its 'description', current 'vendor', and current 'glAccount'. The 'bankName' is also available on the input transaction object for your reference if needed, but do not output it in your suggestion.
2.  Analyze its 'description' carefully.
3.  Infer a plausible 'suggestedVendor' name based on the description. If you cannot confidently infer a specific vendor, use the original 'vendor' value from the input transaction for that ID, otherwise use "-".
4.  CRITICAL: Select the most appropriate 'suggestedGlAccount' for this transaction ONLY from the provided 'availableGlAccounts' list. Do not invent new GL accounts or choose accounts not in this list. If no GL account from the 'availableGlAccounts' list seems suitable based on the transaction description, you MUST use the original 'glAccount' value from the input transaction for that ID; if that original 'glAccount' is also unsuitable or empty, use "-".
5.  Determine a 'confidenceScore' (a numerical value between 0.0 for no confidence and 1.0 for full confidence) for your vendor and GL account assignments. If you used placeholders or original values because no better categorization could be made, the confidenceScore should be very low (e.g., 0.0 to 0.2).
6.  Construct an object containing ONLY these four fields:
    - 'id': The original transaction 'id' from the input. This MUST be copied exactly.
    - 'suggestedVendor': Your inferred vendor name.
    - 'suggestedGlAccount': Your selected GL account (must be from 'availableGlAccounts' list or the original/placeholder).
    - 'confidenceScore': Your determined confidence score.
7.  Add this object (with ONLY the four fields above) to your output array 'suggestions'.

Your output MUST be an object containing a single key 'suggestions'. The value of 'suggestions' MUST be an array.
This array MUST contain exactly one suggestion object for EACH AND EVERY transaction 'id' that was present in the input 'transactionsToCategorize' array.
Do not omit any transaction ID from your 'suggestions' array.
Ensure every suggestion object in the 'suggestions' array contains the original transaction 'id', 'suggestedVendor', 'suggestedGlAccount', and 'confidenceScore'.

Input Transactions for your reference (you will receive an array of objects structured like this, access them by their 'id'):
{{{json transactionsToCategorize}}}

Available GL Accounts (choose from this list only for 'suggestedGlAccount'):
{{{json availableGlAccounts}}}

Example of ONE item in your 'suggestions' output array:
{
  "id": "some_original_tx_id_from_input",
  "suggestedVendor": "Inferred Vendor Name",
  "suggestedGlAccount": "Chosen GL Account From List",
  "confidenceScore": 0.85
}
Do NOT include any other fields from the original transaction (like bankName, date, amounts etc.) in your suggestion objects. The wrapping flow will handle merging.
`,
  config: {
    temperature: 0.2,
  },
});

const categorizeUnmatchedTransactionsFlow = ai.defineFlow(
  {
    name: 'categorizeUnmatchedTransactionsFlow',
    inputSchema: CategorizeUnmatchedTransactionsInputSchema,
    outputSchema: CategorizeUnmatchedTransactionsOutputSchema, // The flow itself still adheres to the original output for the client
  },
  async (input: CategorizeUnmatchedTransactionsInput): Promise<CategorizeUnmatchedTransactionsOutput> => {
    if (input.transactionsToCategorize.length === 0 || input.availableGlAccounts.length === 0) {
      // If no transactions or no GL accounts, return the input transactions as they are, but typed correctly for output
      const emptyCategorized: Transaction[] = input.transactionsToCategorize.map(originalTx => ({
          ...originalTx,
          confidenceScore: 0.0, // Default confidence if no categorization attempted
          userId: originalTx.userId || undefined,
      }));
      return { aiCategorizedTransactions: emptyCategorized };
    }

    const llmResponse = await aiCategorizePrompt(input);

    let processedSuggestions: AiSuggestion[] = [];
    const rawSuggestionsFromAI = llmResponse.output?.suggestions; 

    if (rawSuggestionsFromAI && Array.isArray(rawSuggestionsFromAI)) {
      const aiSuggestionsMap = new Map<string, Partial<AiSuggestion>>();
      
      rawSuggestionsFromAI.forEach((s: any) => {
        if (s && typeof s === 'object' && s.id && typeof s.id === 'string') {
          aiSuggestionsMap.set(s.id, {
            id: s.id,
            suggestedVendor: typeof s.suggestedVendor === 'string' ? s.suggestedVendor : undefined,
            suggestedGlAccount: typeof s.suggestedGlAccount === 'string' ? s.suggestedGlAccount : undefined,
            confidenceScore: typeof s.confidenceScore === 'number' ? s.confidenceScore : undefined,
          });
        }
      });
      
      input.transactionsToCategorize.forEach(originalTx => {
        const suggestionFromAI = aiSuggestionsMap.get(originalTx.id);
        
        if (
          suggestionFromAI && 
          suggestionFromAI.id && 
          suggestionFromAI.suggestedVendor !== undefined && 
          suggestionFromAI.suggestedGlAccount !== undefined && 
          suggestionFromAI.confidenceScore !== undefined 
        ) {
          // Validate AI's suggested GL account
          const normalizedAISuggestedGL = suggestionFromAI.suggestedGlAccount.trim().toLowerCase();
          const isValidGLAccount = input.availableGlAccounts.some(
            validAcc => validAcc.trim().toLowerCase() === normalizedAISuggestedGL
          );

          processedSuggestions.push({
            id: suggestionFromAI.id,
            suggestedVendor: suggestionFromAI.suggestedVendor,
            suggestedGlAccount: isValidGLAccount ? suggestionFromAI.suggestedGlAccount : (originalTx.glAccount || '-'),
            confidenceScore: isValidGLAccount ? suggestionFromAI.confidenceScore : 0.0, 
          });
        } else { // AI didn't provide a full suggestion or a GL account
          processedSuggestions.push({
            id: originalTx.id,
            suggestedVendor: originalTx.vendor || '-', 
            suggestedGlAccount: originalTx.glAccount || '-', 
            confidenceScore: 0.0, 
          });
        }
      });
    } else { // Fallback if AI response is not in the expected format
      processedSuggestions = input.transactionsToCategorize.map(originalTx => ({
        id: originalTx.id,
        suggestedVendor: originalTx.vendor || '-',
        suggestedGlAccount: originalTx.glAccount || '-',
        confidenceScore: 0.0,
      }));
    }
    
    const suggestionsMap = new Map(processedSuggestions.map(s => [s.id, s]));
      
    const aiCategorizedTransactions: Transaction[] = input.transactionsToCategorize.map(originalTx => {
      const suggestion = suggestionsMap.get(originalTx.id);
      
      if (suggestion) {
        return {
          ...originalTx, // This spread ensures bankName and other original fields are preserved
          vendor: suggestion.suggestedVendor,
          glAccount: suggestion.suggestedGlAccount,
          confidenceScore: suggestion.confidenceScore,
          userId: originalTx.userId || undefined, 
        };
      }
      // This case should ideally not be hit if processedSuggestions covers all originalTx.id
      return {
        ...originalTx,
        vendor: originalTx.vendor || '-', 
        glAccount: originalTx.glAccount || '-',
        confidenceScore: 0.0,
        userId: originalTx.userId || undefined,
      };
    });
    return { aiCategorizedTransactions };
  }
);

export async function categorizeUnmatchedUserTransactions(input: CategorizeUnmatchedTransactionsInput): Promise<CategorizeUnmatchedTransactionsOutput> {
  return categorizeUnmatchedTransactionsFlow(input);
}

