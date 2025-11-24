
"use client";

import Header from '@/components/layout/Header';
import { Bot, FileScan, Users, FileSpreadsheet } from 'lucide-react';

const FeatureDetailCard = ({
  icon,
  title,
  description,
  svgContent,
  reverse = false,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  svgContent: React.ReactNode;
  reverse?: boolean;
}) => (
  <div className={`flex flex-col md:flex-row items-center gap-8 md:gap-12 ${reverse ? 'md:flex-row-reverse' : ''}`}>
    <div className="md:w-1/2">
      <div className="flex items-center mb-4">
        <div className="p-2 bg-primary/10 rounded-full mr-3 text-primary">{icon}</div>
        <h3 className="text-2xl font-bold font-headline">{title}</h3>
      </div>
      <p className="text-muted-foreground text-lg">{description}</p>
    </div>
    <div className="md:w-1/2 bg-gray-100/50 dark:bg-gray-800/20 p-8 rounded-lg shadow-inner aspect-video flex items-center justify-center">
      {svgContent}
    </div>
  </div>
);

export default function FeaturesPage() {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Header />
      <main className="flex-1">
        <section className="py-20 bg-muted/30">
          <div className="container mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight font-headline">
              Powerful Features, Effortless Accounting
            </h1>
            <p className="mt-4 max-w-3xl mx-auto text-lg md:text-xl text-muted-foreground">
              Discover how Accountooze.ai leverages cutting-edge technology to simplify your financial management.
            </p>
          </div>
        </section>

        <section className="py-24">
          <div className="container mx-auto space-y-24">
            <FeatureDetailCard
              icon={<Bot size={28} />}
              title="AI-Powered Transaction Categorization"
              description="Say goodbye to manual data entry. Our AI intelligently categorizes your bank transactions, learning from your historical data to achieve over 90% accuracy. Save hours every week and ensure your books are always up-to-date."
              svgContent={
                <svg width="200" height="150" viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">
                  <rect width="200" height="150" fill="transparent"/>
                  <path d="M50 30L20 60L50 90" stroke="#FF621D" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M150 30L180 60L150 90" stroke="#FF621D" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  <rect x="70" y="40" width="60" height="70" rx="5" fill="#FF621D" fillOpacity="0.1" stroke="#FF621D" strokeWidth="2"/>
                  <circle cx="100" cy="75" r="10" fill="#FF621D"/>
                  <path d="M90 75L110 75" stroke="white" strokeWidth="2"/>
                  <path d="M100 65L100 85" stroke="white" strokeWidth="2"/>
                </svg>
              }
            />
            <FeatureDetailCard
              icon={<FileScan size={28} />}
              title="Intelligent Document Reader"
              description="Simply upload your documents—bank statements, vendor bills, or checks—and watch as our AI extracts the relevant data into an editable table. It's OCR, supercharged for accounting."
              svgContent={
                <svg width="200" height="150" viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">
                  <rect width="200" height="150" fill="transparent"/>
                  <path d="M40 20 H 160 V 130 H 40 Z" fill="#FFF" stroke="#CCC" strokeWidth="2"/>
                  <path d="M50 40 H 150 M50 50 H 150 M50 60 H 120" stroke="#CCC" strokeWidth="1.5" />
                  <path d="M130 90 L160 120" stroke="#FF621D" strokeWidth="4" fill="none" strokeLinecap="round"/>
                  <circle cx="145" cy="105" r="15" fill="#FF621D" fillOpacity="0.1" stroke="#FF621D" strokeWidth="2"/>
                </svg>
              }
              reverse={true}
            />
             <FeatureDetailCard
              icon={<FileSpreadsheet size={28} />}
              title="Comprehensive Financial Reports"
              description="Generate essential reports like Profit & Loss and Balance Sheets with a single click. Our AI also provides a high-level management report, complete with an executive summary, key highlights, and actionable recommendations."
              svgContent={
                <svg width="200" height="150" viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">
                  <rect width="200" height="150" fill="transparent"/>
                  <rect x="30" y="100" width="30" height="-60" fill="#FF621D" fillOpacity="0.2"/>
                  <rect x="85" y="100" width="30" height="-80" fill="#FF621D" fillOpacity="0.5"/>
                  <rect x="140" y="100" width="30" height="-40" fill="#FF621D" fillOpacity="0.8"/>
                  <line x1="20" y1="100" x2="180" y2="100" stroke="#CCC" strokeWidth="2"/>
                </svg>
              }
            />
             <FeatureDetailCard
              icon={<Users size={28} />}
              title="Unlimited Companies and Users"
              description="Manage multiple businesses under one account without extra fees. Invite your team members and clients, and set granular permissions to control access to specific pages and features, ensuring seamless and secure collaboration."
              svgContent={
                <svg width="200" height="150" viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">
                  <rect width="200" height="150" fill="transparent"/>
                  <circle cx="100" cy="50" r="20" fill="#FF621D" fillOpacity="0.2" stroke="#FF621D" strokeWidth="2"/>
                  <path d="M80 80 C 80 60, 120 60, 120 80" fill="none" stroke="#FF621D" strokeWidth="2"/>
                  <circle cx="50" cy="70" r="15" fill="#CCC" fillOpacity="0.2" stroke="#CCC" strokeWidth="2"/>
                  <path d="M40 90 C 40 75, 60 75, 60 90" fill="none" stroke="#CCC" strokeWidth="2"/>
                  <circle cx="150" cy="70" r="15" fill="#CCC" fillOpacity="0.2" stroke="#CCC" strokeWidth="2"/>
                  <path d="M140 90 C 140 75, 160 75, 160 90" fill="none" stroke="#CCC" strokeWidth="2"/>
                  <path d="M65 80 L 85 65 M135 80 L 115 65" stroke="#CCC" strokeWidth="1.5" strokeDasharray="3 3"/>
                </svg>
              }
              reverse={true}
            />
          </div>
        </section>
      </main>

       <footer className="container py-8 text-center text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} Accountooze.ai. All rights reserved.</p>
      </footer>
    </div>
  );
}
