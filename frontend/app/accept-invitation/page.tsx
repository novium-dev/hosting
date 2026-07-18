import { Navigate } from "react-router-dom";
import { appConfig } from "@/constants/config";

export default function AcceptInvitation() {
  return <Navigate to={appConfig.authRoutes.signin} replace />;
}
