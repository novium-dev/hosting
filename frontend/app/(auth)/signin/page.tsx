import AuthWrapper from "@/components/auth/auth-wrapper";
import type { AuthProvider } from "@/components/auth/provider-sign-in-button";

const allowedProviders = new Set<AuthProvider>(["user", "team"]);

function getEnabledProviders(): AuthProvider[] {
  const providerConfig = process.env.PROVIDERS ?? process.env.PROVIDERs;
  const providers = providerConfig?.split(",")
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider): provider is AuthProvider =>
      allowedProviders.has(provider as AuthProvider),
    );

  return providers?.length ? providers : ["user"];
}

export default function SigninPage() {
  return (
    <AuthWrapper
      title="Sign in"
      description="Continue with your preferred sign-in method to access your account."
      providers={getEnabledProviders()}
    />
  );
}
