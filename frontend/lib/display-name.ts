import { z } from "zod";

/** Mirrors DISPLAY_NAME_MAX_LENGTH in the backend. */
export const DISPLAY_NAME_MAX_LENGTH = 64;

const BLANK_CATEGORY = /^[\s\p{Cc}\p{Cf}]$/u;

const INVISIBLE = new Set([
  0x034f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x2800, 0x3164, 0xffa0,
]);

function isBlank(character: string) {
  const code = character.codePointAt(0) ?? 0;
  return (
    BLANK_CATEGORY.test(character) ||
    INVISIBLE.has(code) ||
    (code >= 0xfe00 && code <= 0xfe0f)
  );
}

/** The name as the backend stores it: blank and invisible characters trimmed from both ends. */
export function normalizeDisplayName(value: string) {
  const characters = [...value];
  let start = 0;
  let end = characters.length;
  while (start < end && isBlank(characters[start] ?? "")) start += 1;
  while (end > start && isBlank(characters[end - 1] ?? "")) end -= 1;
  return characters.slice(start, end).join("");
}

/** Whether the backend would accept the value as a display name. */
export function isValidDisplayName(value: string) {
  const normalized = normalizeDisplayName(value);
  return (
    normalized.length > 0 && [...normalized].length <= DISPLAY_NAME_MAX_LENGTH
  );
}

export function displayNameSchema(requiredMessage: string) {
  return z
    .string()
    .transform(normalizeDisplayName)
    .pipe(
      z
        .string()
        .min(1, requiredMessage)
        .refine(
          (value) => [...value].length <= DISPLAY_NAME_MAX_LENGTH,
          "Name is too long",
        ),
    );
}
