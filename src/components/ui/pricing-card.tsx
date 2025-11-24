"use client"

import { Button } from "@/components/ui/button"
import {
  Building,
  Users,
  FileText,
  CreditCard,
  Zap,
  Receipt,
  ShoppingCart,
  UserCheck,
  BookOpen,
  BarChart3,
  ScanLine,
  Database,
  Eye,
  FileBarChart,
  Check,
  FileDown,
  X,
  Key,
} from "lucide-react"
import { useState } from "react"
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";

export const plans = [
  {
    name: "Free",
    price: 0,
    duration: "forever",
    link: "/free",
    features: [
      { icon: FileText, text: "AI Powered Document Reader", available: true },
      { icon: Receipt, text: "AI Transaction Categorization (no history saved)", available: true },
      { icon: FileDown, text: "Easy Data Import & Export", available: true },
      { icon: Database, text: "No historical data or auto-save", available: false },
      { icon: Building, text: "No multiple companies", available: false },
    ]
  },
  {
    link: process.env.NEXT_PUBLIC_MONTHLY_PAYMENT_LINK,
    priceId: process.env.NEXT_PUBLIC_STRIPE_SUBSCRIPTION_PRICE_ID,
    price: 33,
    duration: "/month",
    name: "Pro",
    features: [
      { icon: Zap, text: "AI Powered Transaction Categorization", available: true },
      { icon: ScanLine, text: "AI document reader (Bank Statement, Vendor Bill, Check)", available: true },
      { icon: FileBarChart, text: "AI Powered Management reports", available: true },
      { icon: Database, text: "Historical references data for missing categorization", available: true },
      { icon: FileDown, text: "Easy Data Import & Export", available: true },
      { icon: Building, text: "Create unlimited companies", available: true },
    ]
  },
];

export default function PricingCard() {
  const [isHovered, setIsHovered] = useState(false);
  const { user } = useAuth();
  const router = useRouter();

  const handleGetStarted = (plan) => {
    if (plan.name === "Free") {
      router.push('/free');
      return;
    }

    const planLink = plan.link;
    
    if (!user) {
      router.push('/login');
      return;
    }

    if (!planLink) {
      return;
    }

    const url = `${planLink}?prefilled_email=${encodeURIComponent(user.email)}`;
    window.open(url, "_blank");
  };

  return (
    <div id="pricing" className="min-h-screen bg-gradient-to-br from-slate-50 via-orange-50/30 to-slate-100 flex items-center justify-center p-4 pt-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full max-w-6xl items-stretch">
        
        {/* Free Plan Card */}
        <div className="relative h-full flex flex-col">
          <div className="absolute -top-5 left-1/2 transform -translate-x-1/2 z-30">
            <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white px-8 py-3 rounded-full text-sm font-bold shadow-xl border-2 border-white backdrop-blur-sm">
              <span className="flex items-center gap-2">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                Free Plan
              </span>
            </div>
          </div>

          <div
            className="relative p-[3px] rounded-3xl overflow-hidden transition-all duration-500 hover:scale-[1.02] h-full flex flex-col"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <div className="absolute inset-0 bg-gradient-conic from-orange-400 via-orange-500 via-orange-600 to-orange-400 animate-spin-slow rounded-3xl opacity-80"></div>

            <div
              className={`absolute inset-0 bg-gradient-conic from-orange-400 via-orange-500 via-orange-600 to-orange-400 rounded-3xl blur-md transition-opacity duration-500 ${isHovered ? "opacity-40" : "opacity-0"}`}
            ></div>

            <div className="relative bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 overflow-hidden flex flex-col h-full">
              <div className="absolute inset-0 bg-gradient-to-br from-white via-orange-50/20 to-white opacity-60"></div>

              <div className="relative z-10 flex flex-col flex-grow">
                <div className="text-center pt-8 pb-4 px-4 md:pt-12 md:pb-8 md:px-8">
                  <div className="mb-6">
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-6xl font-black text-gray-900 tracking-tight">${plans[0].price}</span>
                      <div className="flex flex-col">
                        <span className="text-lg text-gray-600 font-medium">{plans[0].duration}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-gray-700 text-lg leading-relaxed font-medium max-w-xs mx-auto">
                  Perfect for trying out premium features and getting started.
                  </div>

                  <div className="mt-4 inline-flex items-center gap-2 bg-orange-100 text-orange-800 px-4 py-2 rounded-full text-sm font-semibold">
                  <Key className="w-4 h-4" />
                    Use your own Gemini Key
                  </div>
                </div>

                <div className="px-4 pb-4 md:px-8 md:pb-8 flex-grow">
                  <div className="grid grid-cols-1 gap-1 md:gap-3 h-full">
                    {plans[0].features.map((feature, index) => {
                      const IconComponent = feature.icon;
                      return (
                        <div
                          key={index}
                          className="flex items-start gap-4 group hover:bg-orange-50/50 p-3 rounded-xl transition-all duration-300 hover:scale-[1.02]"
                          style={{
                            animationDelay: `${index * 50}ms`,
                          }}
                        >
                          <div className="flex-shrink-0 w-6 h-6 mt-0.5">
                            <div className="w-6 h-6 bg-gradient-to-br from-orange-400 to-orange-600 rounded-lg flex items-center justify-center shadow-lg group-hover:shadow-xl transition-all duration-300 group-hover:scale-110">
                              <IconComponent className="w-4 h-4 text-white" />
                            </div>
                          </div>
                          <span className="text-nowrap text-gray-700 leading-relaxed font-medium group-hover:text-gray-900 transition-colors duration-300">
                            {feature.text}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="px-8 pb-8 mt-auto">
                  <Button 
                    className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-bold py-4 rounded-2xl transition-all duration-300 shadow-xl hover:shadow-2xl hover:scale-[1.02] text-lg group relative overflow-hidden" 
                    onClick={() => handleGetStarted(plans[0])}
                  >
                    <span className="relative z-10 flex items-center justify-center gap-2">
                    Use It Right Away
                      <div className="w-5 h-5 bg-white/20 rounded-full flex items-center justify-center group-hover:rotate-12 transition-transform duration-300">
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                      </div>
                    </span>
                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Pro Plan Card */}
        <div className="relative h-full flex flex-col">
          <div className="absolute -top-5 left-1/2 transform -translate-x-1/2 z-30">
            <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white px-8 py-3 rounded-full text-sm font-bold shadow-xl border-2 border-white backdrop-blur-sm">
              <span className="flex items-center gap-2">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                Pro Plan
              </span>
            </div>
          </div>

          <div
            className="relative p-[3px] rounded-3xl overflow-hidden transition-all duration-500 hover:scale-[1.02] h-full flex flex-col"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <div className="absolute inset-0 bg-gradient-conic from-orange-400 via-orange-500 via-orange-600 to-orange-400 animate-spin-slow rounded-3xl opacity-80"></div>

            <div
              className={`absolute inset-0 bg-gradient-conic from-orange-400 via-orange-500 via-orange-600 to-orange-400 rounded-3xl blur-md transition-opacity duration-500 ${isHovered ? "opacity-40" : "opacity-0"}`}
            ></div>

            <div className="relative bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 overflow-hidden flex flex-col h-full">
              <div className="absolute inset-0 bg-gradient-to-br from-white via-orange-50/20 to-white opacity-60"></div>

              <div className="relative z-10 flex flex-col flex-grow">
                <div className="text-center pt-8 pb-4 px-4 md:pt-12 md:pb-8 md:px-8">
                  <div className="mb-6">
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-6xl font-black text-gray-900 tracking-tight">${plans[1].price}</span>
                      <div className="flex flex-col">
                        <span className="text-lg text-gray-600 font-medium">{plans[1].duration}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-gray-700 text-lg leading-relaxed font-medium max-w-xs mx-auto">
                    Perfect for accountants to automate their complete manual workflow.
                  </div>

                  <div className="mt-4 inline-flex items-center gap-2 bg-orange-100 text-orange-800 px-4 py-2 rounded-full text-sm font-semibold">
                    <Zap className="w-4 h-4" />
                    Save 20+ hours per week
                  </div>
                </div>

                <div className="px-4 pb-4 md:px-8 md:pb-8 flex-grow">
                  <div className="grid grid-cols-1 gap-1 md:gap-3 h-full">
                    {plans[1].features.map((feature, index) => {
                      const IconComponent = feature.icon;
                      return (
                        <div
                          key={index}
                          className="flex items-start gap-4 group hover:bg-orange-50/50 p-3 rounded-xl transition-all duration-300 hover:scale-[1.02]"
                          style={{
                            animationDelay: `${index * 50}ms`,
                          }}
                        >
                          <div className="flex-shrink-0 w-6 h-6 mt-0.5">
                            <div className="w-6 h-6 bg-gradient-to-br from-orange-400 to-orange-600 rounded-lg flex items-center justify-center shadow-lg group-hover:shadow-xl transition-all duration-300 group-hover:scale-110">
                              <IconComponent className="w-4 h-4 text-white" />
                            </div>
                          </div>
                          <span className="text-nowrap text-gray-700 leading-relaxed font-medium group-hover:text-gray-900 transition-colors duration-300">
                            {feature.text}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="px-8 pb-8 mt-auto">
                  <Button 
                    className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-bold py-4 rounded-2xl transition-all duration-300 shadow-xl hover:shadow-2xl hover:scale-[1.02] text-lg group relative overflow-hidden" 
                    onClick={() => handleGetStarted(plans[1])}
                  >
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      Get Started Now
                      <div className="w-5 h-5 bg-white/20 rounded-full flex items-center justify-center group-hover:rotate-12 transition-transform duration-300">
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                      </div>
                    </span>
                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}