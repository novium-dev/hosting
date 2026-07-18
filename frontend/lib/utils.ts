import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import * as UAParser from "ua-parser-js";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type ErrorTypes = Partial<Record<string, { en: string }>>;

const errorCodes = {
  USER_ALREADY_EXISTS: { en: "user already registered" },
} satisfies ErrorTypes;

export const getErrorMessage = (code: string) => {
  if (code in errorCodes) {
    return errorCodes[code as keyof typeof errorCodes].en;
  }
  return "An error occurred";
};

/**
 * Parses a user agent string and returns device and browser info using ua-parser-js.
 * @param userAgent The user agent string
 * @returns { device: string, browser: string }
 */
export function parseUserAgent(userAgent?: string): {
  device: string;
  browser: string;
} {
  if (!userAgent) return { device: "Unknown", browser: "Unknown" };
  const parser = new UAParser.UAParser(userAgent);
  const os = parser.getOS();
  const browser = parser.getBrowser();
  return {
    device: os.name || "Unknown",
    browser: browser.name || "Unknown",
  };
}

export function titleCase(str: string) {
  return str
    .split(/[\s-_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
