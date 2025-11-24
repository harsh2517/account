
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type AuthError,
} from "firebase/auth";
import { auth, db } from "@/lib/firebase";   
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
  setDoc,
  doc,
  getDoc,
} from "firebase/firestore";
import { Mail, Lock, User as UserIcon, LogIn, Loader2, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { onAuthStateChanged } from "firebase/auth";

const loginSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email address." }),
  password: z.string().min(1, { message: "Password is required." }),
});

const signupSchema = z.object({
  displayName: z.string().min(2, { message: "Name must be at least 2 characters." }),
  email: z.string().email({ message: "Please enter a valid email address." }),
  password: z.string().min(6, { message: "Password must be at least 6 characters." }),
});

type LoginSchema = z.infer<typeof loginSchema>;
type SignupSchema = z.infer<typeof signupSchema>;


export default function LoginPage() {
  const { authStatus } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [showVerificationMessage, setShowVerificationMessage] = useState(false);

  
  const loginForm = useForm<LoginSchema>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  
  const signupForm = useForm<SignupSchema>({
    resolver: zodResolver(signupSchema),
    defaultValues: { displayName: "", email: "", password: "" },
  });
  
  // //sign in
  // const handleLogin: SubmitHandler<LoginSchema> = async (data) => {
  //   setIsLoading(true);
  //   try {
  //     const userCredential = await signInWithEmailAndPassword(auth, data.email, data.password);
  //     const user = userCredential.user;
  //     //If email not verified
  //     if (!userCredential.user.emailVerified) {
  //       await firebaseSignOut(auth); 
  //       toast({
  //         title: "Email Not Verified",
  //         description: "Please check your inbox and verify your email address before logging in.",
  //         variant: "destructive",
  //       });
  //       setIsLoading(false);
  //       return;
  //     }

  //      // 1️⃣STEP 1: Check if the user already owns a company
  //     const companiesRef = collection(db, "companies");
  //     const q = query(companiesRef, where("createdBy", "==", user.uid));
  //     const querySnapshot = await getDocs(q);

  //     if (querySnapshot.empty) {
  //         try {
  //           const companyDoc = await addDoc(companiesRef, {
  //             name: user.displayName || "My Company",
  //             createdBy: user.uid,
  //             createdAt: serverTimestamp(),
  //           });
        
  //         } catch (err) {
  //           console.error("❌ Failed to create company:", err);
  //         }
        
  //     }

     
  //       toast({
  //         title: "Login Successful",
  //         description: "Welcome back! Redirecting...",
  //       });
  
  //       router.replace("/home");
  //   } catch (error) {
  //     const authError = error as AuthError;
  //     console.error("Login error:", authError);
      
  //     const errorMessage = authError.code === 'auth/invalid-credential' 
  //         ? "Invalid email or password. Please try again."
  //         : "An error occurred. Please try again.";

  //     loginForm.setError("password", { type: "manual", message: "Invalid email or password." });
      
  //     toast({
  //       title: "Login Failed",
  //       description: errorMessage,
  //       variant: "destructive",
  //     });
  //   } finally {
  //       setIsLoading(false);
  //   }
  // };

  const handleLogin: SubmitHandler<LoginSchema> = async (data) => {
    setIsLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, data.email, data.password);
      const user = userCredential.user;
      
      // If email not verified
      if (!userCredential.user.emailVerified) {
        await firebaseSignOut(auth); 
        toast({
          title: "Email Not Verified",
          description: "Please check your inbox and verify your email address before logging in.",
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }
  
      // Create/Update user document in 'users' collection
      const userDocRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userDocRef);
      if (!userDoc.exists()) {
        await setDoc(userDocRef, {
          userId: user.uid,
          email: user.email,
          displayName: user.displayName || null,
          createdAt: serverTimestamp(),
          hasAccess: false,
        });
      }


      // await setDoc(userDocRef, {
      //   userId: user.uid,        
      //   email: user.email,     
      //   displayName: user.displayName || null,
      //   lastLogin: serverTimestamp(),
      //   createdAt: serverTimestamp(),
      // }, { merge: true }); 
  
      // Check if the user already owns a company
      const companiesRef = collection(db, "companies");
      const q = query(companiesRef, where("createdBy", "==", user.uid));
      const querySnapshot = await getDocs(q);
  
      if (querySnapshot.empty) {
        try {
          const companyDoc = await addDoc(companiesRef, {
            // name: user.displayName || "My Company",
            name:"Demo Company",
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            hasAccess: false,

          });
        } catch (err) {
          console.error("❌ Failed to create company:", err);
        }
      }
  
      toast({
        title: "Login Successful",
        description: "Welcome back! Redirecting...",
      });
  
      // router.replace("/home");
      router.replace("/select-company");
    } catch (error) {
      const authError = error as AuthError;
      console.error("Login error:", authError);
      
      const errorMessage = authError.code === 'auth/invalid-credential' 
          ? "Invalid email or password. Please try again."
          : "An error occurred. Please try again.";
  
      loginForm.setError("password", { type: "manual", message: "Invalid email or password." });
      
      toast({
        title: "Login Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };


  //sign up
  const handleSignup: SubmitHandler<SignupSchema> = async (data) => {
    setIsLoading(true);
    setShowVerificationMessage(false);
  
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, data.email, data.password);
      const user = userCredential.user;
  
      await updateProfile(user, { displayName: data.displayName });

      await sendEmailVerification(user);
  
      setShowVerificationMessage(true);
      signupForm.reset();
      await auth.signOut();
  
    } catch (error) {
      const authError = error as AuthError;
      console.error("Signup error:", authError);

      if (authError.code === "auth/email-already-in-use") {
        signupForm.setError("email", { type: "manual", message: "An account with this email already exists." });
      }

      toast({
        title: "Signup Failed",
        description:
          authError.code === "auth/email-already-in-use"
            ? "An account with this email already exists. Please log in."
            : "An error occurred during signup.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  useEffect(() => {
    if (authStatus === 'authenticated') {
      // router.replace('/dashboard');
        // router.replace('/home');
        router.replace('/select-company');
    }
  }, [authStatus, router]);

  if (authStatus === 'loading' || authStatus === 'authenticated') {
    return (
        <div className="flex h-screen items-center justify-center">
            <LoadingSpinner size="lg" />
        </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4 animate-fade-in">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
          <Link href="/" className="mb-4">
            <img src="/my-logo.svg" alt="Accountooze.ai Logo" className="mx-auto h-12 w-12"/>
          </Link>
          <CardTitle className="text-3xl font-bold font-headline">Welcome</CardTitle>
          <CardDescription>Login or create an account to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <Form {...loginForm}>
                <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4 pt-4">
                  <FormField
                    control={loginForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                           <div className="relative">
                            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input type="email" placeholder="you@example.com" {...field} className="pl-10" />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={loginForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                           <div className="relative">
                            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input type="password" placeholder="••••••••" {...field} className="pl-10" />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
                    Login
                  </Button>
                </form>
              </Form>
            </TabsContent>
            <TabsContent value="signup">
                {showVerificationMessage ? (
                    <div className="text-center p-4 border rounded-md bg-green-50 text-green-800">
                        <Send className="mx-auto h-8 w-8 mb-2" />
                        <h3 className="font-bold">Verification Email Sent!</h3>
                        <p className="text-sm">Please check your inbox and click the verification link to activate your account.</p>
                    </div>
                ) : (
                    <Form {...signupForm}>
                        <form onSubmit={signupForm.handleSubmit(handleSignup)} className="space-y-4 pt-4">
                        <FormField
                            control={signupForm.control}
                            name="displayName"
                            render={({ field }) => (
                            <FormItem>
                                <FormLabel>Full Name</FormLabel>
                                <FormControl>
                                <div className="relative">
                                    <UserIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input placeholder="Your Name" {...field} className="pl-10" />
                                </div>
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                            )}
                        />
                        <FormField
                            control={signupForm.control}
                            name="email"
                            render={({ field }) => (
                            <FormItem>
                                <FormLabel>Email</FormLabel>
                                <FormControl>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input type="email" placeholder="you@example.com" {...field} className="pl-10" />
                                </div>
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                            )}
                        />
                        <FormField
                            control={signupForm.control}
                            name="password"
                            render={({ field }) => (
                            <FormItem>
                                <FormLabel>Password</FormLabel>
                                <FormControl>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input type="password" placeholder="Must be at least 6 characters" {...field} className="pl-10" />
                                </div>
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                            )}
                        />
                        <Button type="submit" className="w-full" disabled={isLoading}>
                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserIcon className="mr-2 h-4 w-4" />}
                            Create Account
                        </Button>
                        </form>
                    </Form>
                )}
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="flex justify-center text-sm">
          <Link href="/forgot-password" className="text-primary hover:underline">
            Forgot your password?
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
