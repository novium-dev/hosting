"use client";

import { NoviumLogo } from "@/components/brand/novium-logo";
import { CreateOrganizationForm } from "@/components/create-organization-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";
import { useRouter } from "nextjs-toploader/app";

export default function CreateOrganizationPage() {
  const router = useRouter();

  return (
    <div className="flex h-svh items-center justify-center px-4">
      <Card className="w-full max-w-xs sm:max-w-sm">
        <CardHeader className="flex flex-col items-center gap-2">
          <NoviumLogo className="size-8" />
          <CardTitle>Create Organization</CardTitle>
          <CardDescription>
            Create a new organization to get started
          </CardDescription>
          <Link
            href="/"
            className="text-sm text-muted-foreground underline underline-offset-3 hover:text-primary"
          >
            Back to dashboard
          </Link>
        </CardHeader>
        <CardContent>
          <CreateOrganizationForm
            onSuccess={({ slug }) => {
              router.push(`/${slug}`);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
