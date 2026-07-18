import { appConfig } from "@/constants/config";
import { auth } from "@/lib/auth";
import { authActionClient } from "@/lib/safe-action";
import { revokeSessionSchema } from "@/types/session.schema";
import { z } from "zod";

export const revokeSessionAction = authActionClient
  .inputSchema(revokeSessionSchema)
  .action(async ({ parsedInput }) => {
    const { token } = parsedInput;
    try {
      await auth.api.revokeSession({
        body: { token },
      });
      return { success: true, message: "Session revoked successfully" };
    } catch (error) {
      console.error(error);
      throw error;
    }
  });

export const revokeOtherSessionsAction = authActionClient
  .inputSchema(z.object({}))
  .action(async () => {
    try {
      await auth.api.revokeOtherSessions({
      });
      return { success: true, message: "All sessions revoked successfully" };
    } catch (error) {
      console.error(error);
      throw error;
    }
  });
