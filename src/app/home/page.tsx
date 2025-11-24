
// import AuthGuard from '@/components/auth/AuthGuard';
// import Link from "next/link";
// import { Button } from "@/components/ui/button";





// export default function  HomePage() {

//   return (

//     <AuthGuard>

//     <div className="flex h-screen items-center justify-center">
//       <Button asChild size="lg">
//         <Link href="/select-company">Accounting</Link>
//       </Button>
//     </div>
//     </AuthGuard>
//   );
// }



"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import LoadingSpinner from '@/components/ui/loading-spinner';

export default function SignupPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/');
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );
}
