
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { updateProfile, type AuthError } from "firebase/auth";
import { User, Mail, Save, ArrowLeft } from "lucide-react";
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
import { useAuthClaims } from "@/hooks/useAuthClaims";


const profileSchema = z.object({
  displayName: z.string().min(2, { message: "Name must be at least 2 characters." }).max(50, { message: "Name cannot exceed 50 characters."}),
  email: z.string().email({ message: "Invalid email address." }),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export default function ProfilePage() {
  const { user, authStatus } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(true);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: "", email: "" },
  });

  const populateForm = useCallback(() => {
    if (authStatus === 'authenticated' && user) {
        form.reset({
            displayName: user.displayName || "",
            email: user.email || "",
        });
        setIsPageLoading(false);
    }
  }, [authStatus, user, form]);

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


  return (
    <AuthGuard>
      <div className="container mx-auto flex min-h-[calc(100vh-4rem)] items-center justify-center p-4 animate-fade-in">
        <div className="w-full max-w-lg space-y-6">
          <Card className="shadow-xl">
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
    </AuthGuard>
  );
}


