"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

interface WorkspaceAvatarProps {
  workspaceId: string;
  className?: string;
  fallbackClassName?: string;
  size?: "sm" | "md" | "lg";
  shape?: "square" | "circle";
  border?: boolean;
}

// Improved hash function for better distribution
function hashString(str: string): number[] {
  const seed1 = 0x47c6a7e6;
  const seed2 = 0x8ae3d18a;
  let h1 = seed1;
  let h2 = seed2;
  
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  
  return [Math.abs(h1), Math.abs(h2)];
}

function generateColor(workspaceId: string) {
  const [hash1, hash2] = hashString(workspaceId);

  // Generate HSL values for better color control
  const hue = hash1 % 360; // Full color spectrum
  const saturation = 60 + (hash2 % 15); // 60-75% saturation for softer colors

  // Lighter values for both modes
  const lightModeBase = 75; // Increased from 55
  const darkModeBase = 60; // Increased from 45

  return {
    light: `hsl(${hue}, ${saturation}%, ${lightModeBase}%)`,
    dark: `hsl(${hue}, ${saturation}%, ${darkModeBase}%)`,
  };
}

export function WorkspaceAvatar({
  workspaceId,
  className,
  fallbackClassName,
  size = "sm",
  shape = "square",
  border = false,
}: WorkspaceAvatarProps) {
  const color = useMemo(() => generateColor(workspaceId), [workspaceId]);

  const sizeClasses = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-9 w-9",
  };

  return (
    <Avatar
      className={cn(
        sizeClasses[size],
        shape === "square" && "rounded-lg",
        border && "ring-1 ring-border border",
        "select-none",
        className
      )}
    >
      <AvatarFallback
        className={cn(
          "transition-colors duration-200",
          shape === "square" && "rounded-lg",
          fallbackClassName
        )}
        style={{
          backgroundColor: color.light,
          ["--tw-bg-opacity" as string]: "1",
          ["@media (prefersColorScheme: dark)" as string]: {
            backgroundColor: color.dark,
          },
        }}
      >
        <span className="sr-only">Workspace Avatar</span>
      </AvatarFallback>
    </Avatar>
  );
} 