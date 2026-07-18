import { auth } from "@/lib/auth";
import { authActionClient } from "@/lib/safe-action";
import { deleteUserSchema } from "@/types/user.schema";

export const deleteUserAction = authActionClient
  .inputSchema(deleteUserSchema)
  .action(async () => {
    try {
      await auth.api.deleteUser({
        body: {},
      });
      return { success: true, message: "Account deleted successfully" };
    } catch (error) {
      console.error(error);
      throw error;
    }
  });

export const getAllUsersAction = authActionClient.action(async () => {
  try {
    const allUsers = await auth.api.listUsers();

    return { success: true, users: allUsers };
  } catch (error) {
    console.error(error);
    throw error;
  }
});
