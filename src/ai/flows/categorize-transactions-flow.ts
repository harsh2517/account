
'use server';
/**
 * @fileOverview A flow for auto-categorizing bank transactions using an LLM for fuzzy matching against historical reference data.
 *
 * - categorizeUserTransactions - A function that attempts to categorize transactions.
 * - CategorizeTransactionsInput - The Zod schema for the input.
 * - CategorizeTransactionsOutput - The Zod schema for the output.
 * - Transaction - The type for a single transaction.
 * - HistoricalReferenceItem - The type for a single historical reference item.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// Define a more flexible schema for Firestore Timestamps when passed from client/server
const FirebaseTimestampSchema = z.object({
  seconds: z.number(),
  nanoseconds: z.number(),
}).nullable().optional();


// Schemas for flow input/output (mirroring frontend types, but using Zod)
const TransactionSchema = z.object({
  id: z.string(),
  userId: z.string().optional(),
  date: z.string(),
  description: z.string(),
  bankName: z.string().describe("The name of the bank for this transaction."), // Added bankName
  vendor: z.string(),
  glAccount: z.string(),
  amountPaid: z.number().nullable(),
  amountReceived: z.number().nullable(),
  createdAt: FirebaseTimestampSchema, 
});
export type Transaction = z.infer<typeof TransactionSchema>;

const HistoricalReferenceItemSchema = z.object({
  id: z.string(),
  userId: z.string().optional(),
  keyword: z.string(),
  vendorCustomerName: z.string(),
  glAccount: z.string(),
  createdAt: FirebaseTimestampSchema,
});
export type HistoricalReferenceItem = z.infer<typeof HistoricalReferenceItemSchema>;

const CategorizeTransactionsInputSchema = z.object({
  transactionsToCategorize: z.array(TransactionSchema),
  referenceData: z.array(HistoricalReferenceItemSchema),
});
export type CategorizeTransactionsInput = z.infer<typeof CategorizeTransactionsInputSchema>;

const CategorizeTransactionsOutputSchema = z.object({
  effectivelyCategorizedTransactions: z.array(TransactionSchema), // Only transactions that were updated
});
export type CategorizeTransactionsOutput = z.infer<typeof CategorizeTransactionsOutputSchema>;


const fuzzyCategorizeTransactionsPrompt = ai.definePrompt({
  name: 'fuzzyCategorizeTransactionsPrompt',
  input: { schema: CategorizeTransactionsInputSchema },
  output: { schema: CategorizeTransactionsOutputSchema },
  prompt: `You are an expert financial data processor. Your task is to categorize bank transactions based on historical reference data.
You will be given a list of 'transactionsToCategorize' and a list of 'referenceData'.
'referenceData' contains items with a 'keyword', 'vendorCustomerName', and 'glAccount'.

For each transaction in 'transactionsToCategorize':
1. Examine its 'description'.
2. Compare this 'description' to the 'keyword' in each item of 'referenceData'. Use fuzzy matching principles – the match doesn't need to be exact but should be semantically similar and clearly related. For example, "AMZN Mktp US" should match a keyword "Amazon Marketplace".
3. If you find a strong and unambiguous match:
    - Take the original transaction object from the input 'transactionsToCategorize' that corresponds to this description.
    - Update its 'vendor' field with the 'vendorCustomerName' from the matched reference item.
    - Update its 'glAccount' field with the 'glAccount' from the matched reference item.
    - Preserve all other fields of the original transaction object, including 'id', 'userId', 'date', 'bankName', 'amountPaid', 'amountReceived'. The 'bankName' field, in particular, MUST be preserved exactly as it was in the input.
    - For the 'createdAt' field: if the original 'createdAt' was an object with 'seconds' and 'nanoseconds', you MUST include both 'seconds' and 'nanoseconds' in the output. If the original 'createdAt' was null or not present, preserve it as such.
    - Include this fully updated transaction object in your output array 'effectivelyCategorizedTransactions'.
4. If no strong or clear match is found for a transaction, or if the transaction description is too generic to confidently map, do NOT include it in the output.
5. If a transaction already has a non-empty vendor and GL account (that are not placeholders like '-' or empty strings), you can still try to categorize it if the reference data provides a more specific or accurate match, but be cautious and prioritize clear improvements.

Your output MUST be an array of transaction objects, where each object is a transaction from the input that you successfully categorized (or re-categorized more accurately), with its 'vendor' and 'glAccount' fields updated. All other original fields of the transaction, especially 'bankName', must be preserved. If no transactions are categorized, return an empty array for 'effectivelyCategorizedTransactions'.

Transactions to categorize:
{{{json transactionsToCategorize}}}

Reference data:
{{{json referenceData}}}
`,
  config: {
    temperature: 0.2,
  },
});

const categorizeTransactionsFlow = ai.defineFlow(
  {
    name: 'categorizeTransactionsFlow',
    inputSchema: CategorizeTransactionsInputSchema,
    outputSchema: CategorizeTransactionsOutputSchema,
  },
  async (input: CategorizeTransactionsInput): Promise<CategorizeTransactionsOutput> => {
    const transactionsThatNeedCategorizing = input.transactionsToCategorize.filter(tx =>
      (!tx.vendor || tx.vendor === '-') ||
      (!tx.glAccount || tx.glAccount === '-')
    );

    if (transactionsThatNeedCategorizing.length === 0 && input.referenceData.length > 0) {
       // Flow logic handles sending all transactions if none specifically need categorization but ref data exists.
    } else if (transactionsThatNeedCategorizing.length === 0) {
        return { effectivelyCategorizedTransactions: [] };
    }

    const transactionsForLLM = transactionsThatNeedCategorizing.length > 0 
                               ? transactionsThatNeedCategorizing 
                               : input.transactionsToCategorize;

    if (transactionsForLLM.length === 0) {
        return { effectivelyCategorizedTransactions: [] };
    }
    
    const promptInput: CategorizeTransactionsInput = {
        transactionsToCategorize: transactionsForLLM,
        referenceData: input.referenceData,
    };
    
    const llmResponse = await fuzzyCategorizeTransactionsPrompt(promptInput);
    
    if (llmResponse.output && Array.isArray(llmResponse.output.effectivelyCategorizedTransactions)) {
        const originalTxMap = new Map(promptInput.transactionsToCategorize.map(tx => [tx.id, tx]));

        llmResponse.output.effectivelyCategorizedTransactions.forEach(tx => {
            // Ensure bankName is preserved from the original if AI somehow omits it
            const originalTx = originalTxMap.get(tx.id);
            if (originalTx && !tx.bankName && originalTx.bankName) {
                tx.bankName = originalTx.bankName;
            }
            
            if (tx.createdAt && typeof tx.createdAt === 'object') {
                const s = (tx.createdAt as any).seconds;
                const ns = (tx.createdAt as any).nanoseconds;

                if (typeof s === 'number' && typeof ns !== 'number') {
                    (tx.createdAt as any).nanoseconds = 0; // Default nanoseconds if missing
                } else if ((typeof s !== 'number' || typeof ns !== 'number')) {
                    // Malformed or incomplete object, try to restore from original
                    const original = originalTxMap.get(tx.id);
                    if (original) {
                        tx.createdAt = original.createdAt;
                    } else {
                        // This is a fallback if original can't be found
                        tx.createdAt = null; 
                    }
                }
            } else if (tx.createdAt === undefined) {
                // If createdAt is entirely missing from AI output for a transaction, try to restore it
                const original = originalTxMap.get(tx.id);
                if (original) {
                    tx.createdAt = original.createdAt;
                } else {
                    tx.createdAt = null; // Fallback
                }
            }
            // If tx.createdAt is already null, it's fine.
        });
        return llmResponse.output;
    }
    
    return { effectivelyCategorizedTransactions: [] };
  }
);

// Exported wrapper function to be called from the frontend
export async function categorizeUserTransactions(input: CategorizeTransactionsInput): Promise<CategorizeTransactionsOutput> {
  return categorizeTransactionsFlow(input);
}

