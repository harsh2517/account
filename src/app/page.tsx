
"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, Bot, Landmark, FileText, BarChart, Sparkles } from "lucide-react";
import Header from "@/components/layout/Header";
import PricingCard from "@/components/ui/pricing-card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useEffect, useState } from "react";

const FeatureCard = ({ icon, title, children }: { icon: React.ReactNode, title: string, children: React.ReactNode }) => (
  <div className="bg-card p-6 rounded-lg shadow-sm hover:shadow-lg transition-shadow border border-border/50">
    <div className="flex items-center justify-center h-12 w-12 rounded-full bg-primary/10 text-primary mb-4">
      {icon}
    </div>
    <h3 className="text-xl font-bold mb-2 font-headline">{title}</h3>
    <p className="text-muted-foreground">{children}</p>
  </div>
);

const punchlines = [
  "No More Data Entry",
  "Save 1000s of Man Hours",
  "AI Powered Document Reader",
];

export default function RootPage() {
    const [currentPunchlineIndex, setCurrentPunchlineIndex] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentPunchlineIndex((prevIndex) => (prevIndex + 1) % punchlines.length);
        }, 3000); // Change punchline every 3 seconds

        return () => clearInterval(interval);
    }, []);

    return (
    <div className="flex flex-col min-h-screen bg-background">
      <Header />
      <main className="flex-1">
        {/* Hero Section */}
        <section className="py-20 md:py-32 bg-background">
          <div className="container mx-auto text-center">
            <div className="mb-4 inline-flex items-center justify-center space-x-2 rounded-full bg-muted px-4 py-2 text-sm font-medium text-primary">
              <Bot className="h-5 w-5" />
              <span>Your AI-Powered Accounting Software</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight font-headline animate-fade-in">
              AI Powered Accounting 
              <span className="relative block h-16 md:h-20 mt-2 overflow-hidden">
                {punchlines.map((text, index) => (
                  <span
                    key={index}
                    className={`absolute inset-0 transition-all duration-700 ease-in-out transform ${
                      index === currentPunchlineIndex
                        ? 'translate-y-0 opacity-100'
                        : index < currentPunchlineIndex
                        ? '-translate-y-full opacity-0'
                        : 'translate-y-full opacity-0'
                    } bg-gradient-to-r from-primary to-orange-400 text-transparent bg-clip-text`}
                  >
                    {text}
                  </span>
                ))}
              </span>
            </h1>
            <p className="mt-6 max-w-2xl mx-auto text-lg md:text-xl text-muted-foreground">
              From PDF Bank statement to Profit and Loss. Accountooze can do everything at one place. Automates the tedious work, so you can focus on growing your business.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Button asChild size="lg">
                <Link href="/login">Get Started <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
               <Button asChild size="lg" variant="outline">
                <Link href="https://calendly.com/accountooze/meeting" target="_blank" rel="noopener noreferrer">Book a Demo</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section className="py-16 md:py-24">
            <div className="container mx-auto">
                <div className="text-center mb-12">
                    <h2 className="text-3xl md:text-4xl font-bold font-headline">Core Features which can save your 100+ hours</h2>
                </div>
                <div className="grid md:grid-cols-3 gap-8 text-center">
                    <div className="flex flex-col items-center">
                        <div className="flex items-center justify-center h-16 w-16 rounded-full bg-primary text-primary-foreground mb-4 text-2xl font-bold">1</div>
                        <h3 className="text-xl font-bold mb-2">Document Reader</h3>
                        <p className="text-muted-foreground">AI Powered, Convert Scanned Bank Statement to Excel. Even Checks, Bills and give accurate data in excel</p>
                    </div>
                     <div className="flex flex-col items-center">
                        <div className="flex items-center justify-center h-16 w-16 rounded-full bg-primary text-primary-foreground mb-4 text-2xl font-bold">2</div>
                        <h3 className="text-xl font-bold mb-2">Transactions Categorization </h3>
                        <p className="text-muted-foreground">Import transactions and AI will auto categorize the transactions.</p>
                    </div>
                     <div className="flex flex-col items-center">
                        <div className="flex items-center justify-center h-16 w-16 rounded-full bg-primary text-primary-foreground mb-4 text-2xl font-bold">3</div>
                        <h3 className="text-xl font-bold mb-2">Easy Export & Import</h3>
                        <p className="text-muted-foreground">Easily Export & Import the data using Excel.</p>
                    </div>
                </div>
            </div>
        </section>
            
        {/* FAQ Section */}
        <section className="py-16 md:py-24 bg-background">
          <div className="container mx-auto max-w-3xl">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold font-headline">Frequently Asked Questions</h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Have questions? We've got answers. If you can't find what you're looking for, feel free to reach out.
              </p>
            </div>
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="item-1">
                <AccordionTrigger>Is there a free trial available?</AccordionTrigger>
                <AccordionContent>
                  Yes! You can sign up and use all of our features for free. Our Pro plan unlocks unlimited usage and advanced capabilities.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2">
                <AccordionTrigger>Can I manage multiple businesses?</AccordionTrigger>
                <AccordionContent>
                  Absolutely. Our platform is designed to handle unlimited companies under a single account, making it perfect for accountants, bookkeepers, and entrepreneurs with multiple ventures.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-3">
                <AccordionTrigger>How secure is my financial data?</AccordionTrigger>
                <AccordionContent>
                  We take security very seriously. All your data is encrypted both in transit and at rest. We leverage industry-standard security practices and secure cloud infrastructure to keep your financial information safe.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-4">
                <AccordionTrigger>What kind of documents can the AI read?</AccordionTrigger>
                <AccordionContent>
                  Our AI Document Reader can intelligently extract data from various financial documents, including bank statements (PDFs), vendor bills, and checks. Just upload the file, and we'll do the heavy lifting.
                </AccordionContent>
              </AccordionItem>
               <AccordionItem value="item-5">
                <AccordionTrigger>Can I collaborate with my team or accountant?</AccordionTrigger>
                <AccordionContent>
                    Yes, collaboration is a core feature. You can invite unlimited users to your company and assign them granular permissions, controlling which pages and features they can access.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </section>

        {/* Final CTA Section */}
        <section className="py-16 md:py-24 bg-muted/50">
          <div className="container mx-auto text-center">
            <Sparkles className="mx-auto h-12 w-12 text-primary" />
            <h2 className="mt-4 text-3xl md:text-4xl font-bold font-headline">Ready to Transform Your Finances?</h2>
            <p className="mt-4 max-w-2xl mx-auto text-lg text-muted-foreground">
              Join today and experience the power of an AI co-pilot for your business accounting.
            </p>
            <div className="mt-8">
              <Button asChild size="lg">
                <Link href="/login">Sign Up Now <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </div>
          </div>
        </section>

        {/* AI + Human Section */}
        <section className="py-16 md:py-24 bg-muted/30">
          <div className="container mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold font-headline">
              AI isn't perfect, neither are humans, but together they are unstoppable.
            </h2>
            <p className="mt-4 text-2xl md:text-3xl font-bold bg-gradient-to-r from-primary to-orange-400 text-transparent bg-clip-text">
              AI + Human = Magic
            </p>
            <p className="mt-6 max-w-2xl mx-auto text-lg text-muted-foreground">
              While our AI provides powerful automation, the nuanced expertise of a human accountant is irreplaceable for strategic financial guidance.
            </p>
            <div className="mt-8">
              <Button asChild size="lg">
                <Link href="https://www.accountooze.com" target="_blank" rel="noopener noreferrer">Hire a Human Accountant <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="container py-8 text-center text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} Accountooze.ai. All rights reserved.</p>
      </footer>
    </div>
  );
}
