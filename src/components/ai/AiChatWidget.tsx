"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, Send, X, ChevronDown, Bot, User } from 'lucide-react';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { generalChat, type GeneralChatInput, type GeneralChatOutput } from '@/ai/flows/general-chat-flow';
import { useToast } from '@/hooks/use-toast';

interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: Date;
}

export default function AiChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const scrollToBottom = useCallback(() => {
    if (scrollAreaRef.current) {
      const scrollViewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollViewport) {
        scrollViewport.scrollTop = scrollViewport.scrollHeight;
      }
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      inputRef.current?.focus();
    }
  }, [messages, isOpen, scrollToBottom]);
  
  useEffect(() => { 
    const storedMessages = localStorage.getItem('aiChatMessages');
    if (storedMessages) {
      try {
        const parsedMessages = JSON.parse(storedMessages).map((msg: any) => ({
            ...msg,
            timestamp: new Date(msg.timestamp) 
        }));
        setMessages(parsedMessages);
      } catch (e) {
        console.error("Failed to parse chat messages from localStorage", e);
        localStorage.removeItem('aiChatMessages'); 
      }
    }
  }, []);

  useEffect(() => { 
    if (messages.length > 0) { 
        localStorage.setItem('aiChatMessages', JSON.stringify(messages));
    } else {
        localStorage.removeItem('aiChatMessages');
    }
  }, [messages]);


  const handleSendMessage = async (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    const currentInput = inputValue.trim();
    if (!currentInput) return;

    const newUserMessage: Message = {
      id: crypto.randomUUID(),
      sender: 'user',
      text: currentInput,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, newUserMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const inputForFlow: GeneralChatInput = { prompt: currentInput };
      const result: GeneralChatOutput = await generalChat(inputForFlow);
      
      const aiResponseMessage: Message = {
        id: crypto.randomUUID(),
        sender: 'ai',
        text: result.response,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiResponseMessage]);
    } catch (error) {
      console.error("Error calling AI chat flow:", error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        sender: 'ai',
        text: "Sorry, I encountered an error. Please try again.",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      toast({
        title: "AI Chat Error",
        description: error instanceof Error ? error.message : "Could not get a response from the AI.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleChat = () => {
    setIsOpen(!isOpen);
  };

  return (
    <>
      <Button
        onClick={toggleChat}
        className="fixed bottom-6 right-6 z-50 rounded-full w-14 h-14 shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground"
        aria-label="Toggle AI Chat"
        size="icon"
      >
        {isOpen ? <ChevronDown className="h-6 w-6" /> : <MessageSquare className="h-6 w-6" />}
      </Button>

      {isOpen && (
        <Card className="fixed bottom-24 right-6 z-50 w-full max-w-md h-[70vh] max-h-[500px] shadow-xl flex flex-col animate-fade-in rounded-lg border border-border">
          <CardHeader className="flex flex-row items-center justify-between p-4 border-b">
            <CardTitle className="text-lg font-headline flex items-center">
                <Bot className="mr-2 h-5 w-5 text-primary" /> AI Chat Assistant
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={toggleChat} className="h-8 w-8">
              <X className="h-5 w-5" />
              <span className="sr-only">Close chat</span>
            </Button>
          </CardHeader>
          <CardContent className="flex-grow p-0 overflow-hidden">
            <ScrollArea ref={scrollAreaRef} className="h-full p-4">
              {messages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No messages yet. Ask me anything!
                </p>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className={`flex mb-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`p-3 rounded-lg max-w-[80%] shadow-sm ${
                      msg.sender === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-none'
                        : 'bg-muted text-muted-foreground rounded-bl-none'
                    }`}
                  >
                    <div className="flex items-center mb-1">
                      {msg.sender === 'ai' ? <Bot className="h-4 w-4 mr-2 text-primary" /> : <User className="h-4 w-4 mr-2 text-muted-foreground" />}
                      <span className="text-xs font-medium">{msg.sender === 'user' ? 'You' : 'AI Assistant'}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                     <p className={`text-xs mt-1 text-right ${msg.sender === 'user' ? 'text-primary-foreground/70' : 'text-muted-foreground/70'}`}>
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start mb-3">
                   <div className="p-3 rounded-lg max-w-[80%] shadow-sm bg-muted text-muted-foreground rounded-bl-none">
                    <div className="flex items-center mb-1">
                       <Bot className="h-4 w-4 mr-2 text-primary" /> 
                       <span className="text-xs font-medium">AI Assistant</span>
                    </div>
                    <LoadingSpinner size="sm" />
                  </div>
                </div>
              )}
            </ScrollArea>
          </CardContent>
          <CardFooter className="p-4 border-t">
            <form onSubmit={handleSendMessage} className="flex w-full items-center space-x-2">
              <Input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask me anything..."
                className="flex-grow"
                disabled={isLoading}
                autoFocus
              />
              <Button type="submit" size="icon" disabled={isLoading || !inputValue.trim()} className="bg-primary hover:bg-primary/90">
                <Send className="h-5 w-5" />
                <span className="sr-only">Send message</span>
              </Button>
            </form>
          </CardFooter>
        </Card>
      )}
    </>
  );
}
