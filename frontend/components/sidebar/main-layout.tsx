import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";
import React from "react";
import { TextEllipsis } from "@/components/ui/text-ellipsis";
// Types
type BreadcrumbItem = {
  label: string;
  href?: string;
};

type TopNavProps = {
  children: React.ReactNode;
  className?: string;
  breadcrumbs?: BreadcrumbItem[];
};

function BreadcrumbHeader({ breadcrumbs }: { breadcrumbs?: BreadcrumbItem[] }) {
  if (!breadcrumbs?.length) return null;

  return (
    <header className="sticky top-14 z-20 flex h-12 shrink-0 items-center border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/70">
      <Breadcrumb>
        <BreadcrumbList className="flex flex-wrap items-center gap-2">
          {breadcrumbs?.map((item, index) => (
            <React.Fragment key={item.label}>
              {index > 0 && <BreadcrumbSeparator className="block" />}
              <BreadcrumbItem className="block">
                {item.href ? (
                  <BreadcrumbLink href={item.href}>
                    <TextEllipsis width={120}>{item.label}</TextEllipsis>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>
                    <TextEllipsis width={120}>{item.label}</TextEllipsis>
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}

function MainArea({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 p-4 pt-2 @container">{children}</div>
  );
}

// Main Component
export function MainLayout({ children, className, breadcrumbs }: TopNavProps) {
  return (
    <div className={cn("flex min-h-[calc(100svh-56px)] flex-col", className)}>
      {/* <BreadcrumbHeader breadcrumbs={breadcrumbs} /> */}
      <MainArea>{children}</MainArea>
    </div>
  );
}
