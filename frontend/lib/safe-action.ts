import { ActionError } from "@/types/safe-action.types";
import {
  createSafeActionClient,
  DEFAULT_SERVER_ERROR_MESSAGE,
} from "next-safe-action";
import { headers } from "next/headers";
import { auth } from "./auth";

export const actionClient = createSafeActionClient({
  defaultValidationErrorsShape: "flattened",
  throwValidationErrors: true,
  handleServerError: (e) => {
    console.error("Action server error occurred:", e.message);

    // If the error is an instance of `ActionError`, unmask the message.
    if (e instanceof ActionError) {
      return e.message;
    }

    // Otherwise return default error message.
    return DEFAULT_SERVER_ERROR_MESSAGE;
  },
});

export const authActionClient = actionClient
  // Define authorization middleware.
  .use(async ({ next }) => {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) throw new Error("Session not found!");

    // Return the next middleware with `userId` value in the context
    return next({
      ctx: { userId: session?.user?.id, sessionId: session?.session?.id },
    });
  });
