import { Navigate, useParams } from "react-router-dom";

import { settingsHash } from "@/lib/settings";

export default function ProfilePage() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <Navigate
      to={{ pathname: slug ? `/${slug}` : "/", hash: settingsHash("profile") }}
      replace
    />
  );
}
