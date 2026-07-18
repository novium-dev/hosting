import { appConfig } from "@/constants/config";
import { redirect } from "next/navigation";

export default function AcceptInvitation() {
  redirect(appConfig.authRoutes.signin);
}
