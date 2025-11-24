import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

import { getAuth, getIdTokenResult } from 'firebase/auth';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const getCompanyId = (): string => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('selectedCompanyId') || '';
  }
  return '';
};

export async function validateGeminiApiKey(apiKey: string): Promise<{ isValid: boolean; error?: string }> {
  try {
    const testResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents: [{ parts: [{ text: "Hello" }] }] 
        })
      }
    );
    
    if (!testResponse.ok) {
      const errorData = await testResponse.json();
      return { 
        isValid: false, 
        error: errorData.error?.message || `API error: ${testResponse.status}` 
      };
    }
    
    return { isValid: true };
  } catch (error) {
    return { 
      isValid: false, 
      error: error instanceof Error ? error.message : 'Network error' 
    };
  }
}