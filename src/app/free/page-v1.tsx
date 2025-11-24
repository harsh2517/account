"use client";
import { toast } from "@/hooks/use-toast";
import { validateGeminiApiKey } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function FreeHomePage() {
    const [apiKey, setApiKey] = useState("");
    const [email, setEmail] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const router = useRouter();
  

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSubmitting(true);
      
      if (email && apiKey) {
        // Validate the API key first
        const validationResult = await validateGeminiApiKey(apiKey);
        
        if (validationResult.isValid) {
          // Save to localStorage if valid
          localStorage.setItem('accountooze_free_email', email);
          localStorage.setItem('accountooze_free_gemini_key', apiKey);
          
          toast({
            title: "API Key Validated",
            description: "Your Gemini API key is working correctly!",
            variant: "default",
          });
          
          // Redirect to document reader
          setTimeout(() => {
            router.push('/free/document-reader');
            setIsSubmitting(false);
          }, 500);
          
        } else {
          // Show error toast
          toast({
            title: "Invalid API Key",
            description: validationResult.error || "Please check your Gemini API key",
            variant: "destructive",
          });
          
          setIsSubmitting(false);
        }
      } else {
        toast({
          title: "Missing Information",
          description: "Please provide both email and API key",
          variant: "destructive",
        });
        setIsSubmitting(false);
      }
    };
  
    return (
      <div className="flex flex-col items-center justify-center w-full h-full">
      <div className="max-w-4xl mx-auto ">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome to Accountooze Free Tools</h1>
          <p className="text-gray-600">Use Document Reader & Transaction Categorization with your own Gemini API Key.</p>
        </div>
  
  
        <div className="grid md:grid-cols-2 gap-8">
          {/* Instructions Card */}
          <div className="bg-gray-50 rounded-lg border border-gray-200 shadow-sm p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Step 1: Get Your Gemini API Key</h2>
            <ol className="list-decimal list-inside space-y-3 text-gray-700">
              <li>Visit <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:underline">Google AI Studio</a></li>
              <li>Generate your free Gemini API key</li>
              <li>Copy & paste below to start using the tools</li>
            </ol>
            <div className="mt-6 p-3 bg-white rounded-lg border border-gray-200">
              <div className="text-xs text-gray-500 mb-1">Quick tip:</div>
              <div className="text-sm text-gray-700">Google AI Studio provides a free tier with generous limits for testing and development.</div>
            </div>
          </div>
  
          {/* Input Form Card */}
          <div className="bg-gray-50 rounded-lg border border-gray-200 shadow-sm p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Enter Your Details</h2>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="your.email@example.com"
                  />
                </div>
                <div>
                  <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-1">
                    Gemini API Key
                  </label>
                  <input
                    type="text"
                    id="apiKey"
                    required
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="Paste your Gemini API key here"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-orange-400 text-white font-medium py-2 px-4 rounded-md transition-colors flex items-center justify-center"
                >
                  {isSubmitting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Processing...
                    </>
                  ) : (
                    "Start Using Free Tools"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
      </div>
    );
  }