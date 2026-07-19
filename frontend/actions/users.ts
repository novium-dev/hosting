import { auth } from "@/lib/auth";
import { authActionClient } from "@/lib/safe-action";

export const getAllUsersAction = authActionClient.action(async () => {
  const allUsers = await auth.api.listUsers();
  return { success: true, users: allUsers };
});
