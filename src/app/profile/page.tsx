"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { updateProfile, type AuthError } from "firebase/auth";
import { User, Mail, Save, ArrowLeft, Calendar, CircleDollarSign, BadgeCheck } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { z } from "zod";

import AuthGuard from "@/components/auth/AuthGuard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/global/sidebar"

const profileSchema = z.object({
  displayName: z.string().min(2, { message: "Name must be at least 2 characters." }).max(50, { message: "Name cannot exceed 50 characters."}),
  email: z.string().email({ message: "Invalid email address." }),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

type SubscriptionData = {
  planName?: string;
  status?: string;
  nextBillingDate?: string;
  lastUpdated?: string;
};

export default function ProfilePage() {
  const { user, authStatus } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null);
  const [isSubscriptionLoading, setIsSubscriptionLoading] = useState(true);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: "", email: "" },
  });

  const fetchSubscriptionData = useCallback(async (userId: string) => {
    try {
      const userDocRef = doc(db, "users", userId);
      const userDoc = await getDoc(userDocRef);

      
      if (userDoc.exists()) {
        const data = userDoc.data();
        setSubscriptionData({
          planName: data.planName,
          status: data.status,
          nextBillingDate: data.nextBillingDate,
          lastUpdated: data.lastUpdated
        });
      }
    } catch (error) {
      console.error("Error fetching subscription data:", error);
      toast({
        title: "Error",
        description: "Could not load subscription information.",
        variant: "destructive",
      });
    } finally {
      setIsSubscriptionLoading(false);
    }
  }, [toast]);

  const populateForm = useCallback(() => {
    if (authStatus === 'authenticated' && user) {
      form.reset({
        displayName: user.displayName || "",
        email: user.email || "",
      });
      fetchSubscriptionData(user.uid);
      setIsPageLoading(false);
    }
  }, [authStatus, user, form, fetchSubscriptionData]);

  useEffect(() => {
    populateForm();
  }, [populateForm]);

  const handleProfileUpdate: SubmitHandler<ProfileFormValues> = async (data) => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    setIsSubmitting(true);

    try {
      if (data.displayName !== currentUser.displayName) {
        await updateProfile(currentUser, { displayName: data.displayName });
        toast({
          title: "Profile Updated",
          description: "Your display name has been successfully updated.",
        });
      } else {
         toast({
          title: "No Changes",
          description: "Your display name was not changed.",
        });
      }
    } catch (error) {
      const authError = error as AuthError;
      toast({
        title: "Update Failed",
        description: authError.message || "Could not update profile.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  if (authStatus === 'loading' || isPageLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const handleBillingCancellation= () => {
    
    if (!user) {
      router.push('/login');
      return;
    }

    const url = `${process.env.NEXT_PUBLIC_STRIPE_BILLING_LINK}?prefilled_email=${encodeURIComponent(user.email)}`;
    window.open(url, "_blank");
  };

  return (
    <AuthGuard>
      <div className="w-dvw h-dvh">
      <div className="flex h-full">
      <Sidebar/>
      {/* <div className="container mx-auto flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center p-4 animate-fade-in gap-6"> */}
      <div className="p-4 w-full overflow-auto flex flex-col items-center gap-6">

        {/* Subscription Card */}
        <Card className="w-full max-w-lg shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-center font-headline">
              Subscription Details
            </CardTitle>
            <CardDescription className="text-center">
              Your current plan information
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isSubscriptionLoading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner size="md" />
              </div>
            ) : subscriptionData ? (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <CircleDollarSign className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">Plan</p>
                    <p className="font-medium">{subscriptionData.planName || "N/A"}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <BadgeCheck className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <p className="font-medium capitalize">{subscriptionData.status || "N/A"}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <Calendar className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">Next Billing Date</p>
                    <p className="font-medium">{formatDate(subscriptionData.nextBillingDate)}</p>
                  </div>
                </div>
                
                <div className="pt-4 text-xs text-muted-foreground">
                  Last updated: {formatDate(subscriptionData.lastUpdated)}
                </div>

                <div className="w-full flex justify-center">
                <Button onClick={handleBillingCancellation}>
                  Billing & Cancellation
                </Button>
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                No subscription information available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Profile Card (existing) */}
        <Card className="w-full max-w-lg shadow-lg">
          <CardHeader>
            <CardTitle className="text-3xl font-bold text-center font-headline">Profile Settings</CardTitle>
            <CardDescription className="text-center">
              Manage your personal information.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleProfileUpdate)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="displayName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                          <Input placeholder="Your Name" {...field} className="pl-10" />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                          <Input type="email" placeholder="you@example.com" {...field} className="pl-10" disabled />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? <LoadingSpinner className="mr-2" /> : <Save className="mr-2 h-5 w-5" />}
                  Save Changes
                </Button>
              </form>
            </Form>
          </CardContent>
          <CardFooter className="flex justify-center">
            <Button variant="ghost" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
      </div>
      </div>
    </AuthGuard>
  );
}