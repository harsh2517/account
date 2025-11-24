import Link from "next/link"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Briefcase, Rocket, Star } from "lucide-react"
import { cn } from "@/lib/utils"

type Props = {
  className?: string
}

export default function AdCard({ className }: Props) {
  return (
    <Card className={cn("w-full border rounded-2xl shadow-sm bg-gradient-to-br from-white to-gray-50", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-gray-800">
          Unlock More with Accountooze Pro
        </CardTitle>
        <CardDescription className="text-sm text-gray-500">
          Take your accounting to the next level.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-2">
        <Link
          href="https://accountooze.com"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-primary/2 hover:border-primary hover:shadow-md hover:text-gray-800"
        >
          <Briefcase className="h-4 w-4" />
          Hire a Full-Time Accountant
        </Link>

        <Link
          href="/pricing"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-white hover:opacity-90   bg-gradient-to-r from-orange-600 to-primary px-4 py-3 text-sm font-medium text-white hover:from-orange-700 hover:to-primary transition-all shadow-md hover:shadow-lg"
        >
          <Rocket className="h-4 w-4" />
          Explore Full Suite
          <Star className="h-4 w-4 ml-1" fill="currentColor" />
        </Link>
      </CardContent>

      <CardFooter className="pt-2">
        <p className="text-xs text-gray-400">
          Free plan limited to basic tools.  <span className="text-orange-600 font-semibold"> Upgrade anytime.</span>
        </p>
      </CardFooter>
    </Card>
  )
}
