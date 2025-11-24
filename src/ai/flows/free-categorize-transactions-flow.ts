'use server';
/**
 * @fileOverview A FREE version flow for categorizing bank transactions using user's Gemini API key
 * This maintains the exact same structure and prompting as the premium version
 * but uses the user's API key from localStorage instead of the .env file
 */

import { z } from 'zod';

// Schema for Firestore Timestamps (consistent with other flows)
const FirebaseTimestampSchema = z.object({
  seconds: z.number(),
  nanoseconds: z.number(),
}).nullable().optional();

// Schema for a single transaction (consistent with other flows)
const TransactionSchema = z.object({
  id: z.string(),
  userId: z.string().optional(),
  date: z.string(),
  description: z.string(),
  bankName: z.string().describe("The name of the bank for this transaction. This field should be preserved from the input."),
  vendor: z.string(),
  glAccount: z.string(),
  amountPaid: z.number().nullable(),
  amountReceived: z.number().nullable(),
  createdAt: FirebaseTimestampSchema,
  confidenceScore: z.number().min(0).max(1).optional().describe("The AI's confidence in the categorization, from 0.0 to 1.0. Omit if not applicable."),
});
export type Transaction = z.infer<typeof TransactionSchema>;

const CategorizeUnmatchedTransactionsInputSchema = z.object({
  transactionsToCategorize: z.array(TransactionSchema.omit({ confidenceScore: true }))
    .describe('An array of bank transactions that need categorization (vendor and/or GL account are missing or placeholders). Each transaction includes a bankName which must be preserved.'),
  availableGlAccounts: z.array(z.string())
    .describe('A list of valid General Ledger (GL) account names that the AI should choose from.'),
  geminiApiKey: z.string().describe("The user's Gemini API key from localStorage")
});
export type CategorizeUnmatchedTransactionsInput = z.infer<typeof CategorizeUnmatchedTransactionsInputSchema>;

const CategorizeUnmatchedTransactionsOutputSchema = z.object({
  aiCategorizedTransactions: z.array(TransactionSchema)
    .describe('An array of transactions. For each input transaction, an output transaction is present, with potentially updated vendor and/or GL account and a confidence score. Original transaction fields, including bankName, are preserved.'),
});
export type CategorizeUnmatchedTransactionsOutput = z.infer<typeof CategorizeUnmatchedTransactionsOutputSchema>;

// Function to call Gemini API directly with user's API key
async function callGeminiAPIWithUserKey(apiKey: string, prompt: string): Promise<any> {
  const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
  
  const requestBody = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.2
    }
  };

  try {
    const response = await fetch(`${apiUrl}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorData.error?.message || ''}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    throw error;
  }
}

// Function to parse Gemini response
function parseGeminiResponse(response: any): CategorizeUnmatchedTransactionsOutput {
  try {
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    if (!text) {
      return { aiCategorizedTransactions: [] };
    }

    // Try to find JSON in the response text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      try {
        const parsedData = JSON.parse(jsonMatch[0]);
        
        if (parsedData.aiCategorizedTransactions && Array.isArray(parsedData.aiCategorizedTransactions)) {
          // Ensure all inner elements are strings, as AI might occasionally return numbers
          const validatedTable = parsedData.aiCategorizedTransactions.map((transaction: any) => ({
            id: String(transaction.id || ''),
            date: String(transaction.date || ''),
            description: String(transaction.description || ''),
            bankName: String(transaction.bankName || ''),
            vendor: String(transaction.vendor || ''),
            glAccount: String(transaction.glAccount || ''),
            amountPaid: transaction.amountPaid !== null && transaction.amountPaid !== undefined ? 
              Number(transaction.amountPaid) : null,
            amountReceived: transaction.amountReceived !== null && transaction.amountReceived !== undefined ? 
              Number(transaction.amountReceived) : null,
            confidenceScore: transaction.confidenceScore !== undefined ? 
              Number(transaction.confidenceScore) : undefined,
            userId: transaction.userId ? String(transaction.userId) : undefined,
            createdAt: transaction.createdAt || undefined
          }));
          
          return {
            aiCategorizedTransactions: validatedTable
          };
        }
      } catch (e) {
        console.error("Error parsing JSON from Gemini response:", e);
      }
    }

    return { aiCategorizedTransactions: [] };
    
  } catch (error) {
    console.error("Error parsing Gemini response:", error);
    return { 
      aiCategorizedTransactions: [],
    };
  }
}

// Main categorization function
export async function categorizeUnmatchedUserTransactions(
  input: CategorizeUnmatchedTransactionsInput
): Promise<CategorizeUnmatchedTransactionsOutput> {
  try {
    // Use the exact same prompt as the premium version
    const prompt = `You are an expert AI financial data processor.
You will be given a list of 'transactionsToCategorize' (each with an 'id', 'description', 'bankName', current 'vendor', current 'glAccount', etc.) and a list of 'availableGlAccounts'.
The 'bankName' field from the input transaction MUST be preserved in the final output.

Your goal is to provide categorization for EACH transaction ID in the 'transactionsToCategorize' list.

For every transaction ID provided in the 'transactionsToCategorize' input:
1.  Find the corresponding transaction object in the input by its 'id' to access its 'description', current 'vendor', and current 'glAccount'. The 'bankName' is also available on the input transaction object for your reference.
2.  Analyze its 'description' carefully.
3.  Infer a plausible vendor name based on the description. If you cannot confidently infer a specific vendor, use the original 'vendor' value from the input transaction for that ID, otherwise use "-".
4.  CRITICAL: Select the most appropriate GL account for this transaction ONLY from the provided 'availableGlAccounts' list. Do not invent new GL accounts or choose accounts not in this list. If no GL account from the 'availableGlAccounts' list seems suitable based on the transaction description, you MUST use the original 'glAccount' value from the input transaction for that ID; if that original 'glAccount' is also unsuitable or empty, use "-".
5.  Determine a 'confidenceScore' (a numerical value between 0.0 for no confidence and 1.0 for full confidence) for your vendor and GL account assignments. If you used placeholders or original values because no better categorization could be made, the confidenceScore should be very low (e.g., 0.0 to 0.2).
6.  Return the complete transaction object with updated vendor, GL account, and confidence score.

Your output MUST be an object containing a single key 'aiCategorizedTransactions'. The value of 'aiCategorizedTransactions' MUST be an array of transaction objects.
This array MUST contain exactly one transaction object for EACH AND EVERY transaction 'id' that was present in the input 'transactionsToCategorize' array.
Do not omit any transaction ID from your output array.

Input Transactions for your reference:
${JSON.stringify(input.transactionsToCategorize, null, 2)}

Available GL Accounts (choose from this list only):
${JSON.stringify(input.availableGlAccounts, null, 2)}

Example output format:
{
  "aiCategorizedTransactions": [
    {
      "id": "some_original_tx_id_from_input",
      "date": "2023-08-03",
      "description": "CHV43124 HIGHWA",
      "bankName": "Original Bank Name",
      "vendor": "Inferred Vendor Name",
      "glAccount": "Chosen GL Account From List",
      "amountPaid": 100.00,
      "amountReceived": null,
      "confidenceScore": 0.85
    }
  ]
}
`;

    // Call Gemini API with user's API key
    const response = await callGeminiAPIWithUserKey(input.geminiApiKey, prompt);
    
    // Parse the response
    return parseGeminiResponse(response);
    
  } catch (error) {
    console.error("Error in categorizeUnmatchedUserTransactions: ", error);
    let errorMessage = "An unexpected error occurred during transaction categorization.";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    
    // Return empty result on error
    return {
      aiCategorizedTransactions: []
    };
  }
}