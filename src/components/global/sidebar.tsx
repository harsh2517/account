
import Link from "next/link"
import Image from "next/image"
import { Landmark, ListTodo, LogOut, Settings } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export default function Sidebar(){
    const {signOut} = useAuth();
    const pathName = usePathname();
    
    const handleSignOut = async () => {
        await signOut();
    };
    return   ( 
    <div className="flex flex-col p-4 gap-4 border-r w-fit">
      <div className="flex-none">
        <div>
          {/* <h2 className="font-bold text-lg text-orange-600 bg-orange-100 px-3 py-1 rounded-md w-fit">Logo</h2> */}
          <Link href="/" className="mr-6 flex items-center space-x-2">
              <Image
                src="/my-logo.svg"
                alt="Accountooze.ai Logo"
                width={28}
                height={28}
                className="h-7 w-7"
              />
              <span className="font-bold sm:inline-block font-headline">Accountooze.ai</span>
        </Link>
        </div>
      </div>
      <div className="flex-1 space-y-2">
        <Link href="/select-company" className={cn("p-2 flex gap-2 items-center hover:bg-gray-100 cursor-pointer rounded-md w-full", pathName=== "/select-company"? "bg-orange-500 text-gray-100 hover:bg-orange-600": "")}>
          <div>
            <Landmark size={22} />
          </div>
          <span>Accounting</span>
        </Link>
        <a 
            href="https://task.accountooze.com" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="p-2 flex gap-2 items-center hover:bg-gray-100 cursor-pointer rounded-md w-full"
        >
          <div>
            <ListTodo size={22}  />
          </div>
          <span className="text-nowrap">Task Management</span>
        </a>
      </div>
      <div className="flex-none space-y-2">
        <button onClick={handleSignOut}  className="p-2 flex gap-2 items-center hover:bg-gray-100 cursor-pointer rounded-md w-full" >
          <div>
            <LogOut size={22}  />
          </div>
          <span>Logout</span>
        </button>
        <Link href={"/profile"}  className={cn("p-2 flex gap-2 items-center hover:bg-gray-100 cursor-pointer rounded-md w-full", pathName=== "/profile"? "bg-orange-500 text-gray-100 hover:bg-orange-600": "")}>
          <div>
            <Settings size={22}  />
          </div>
          <span>Settings</span>
        </Link>
      </div>
    </div>
    )
}
