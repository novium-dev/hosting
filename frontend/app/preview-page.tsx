import { CreateOrganizationForm } from "@/components/create-organization-form";

export default function PreviewPage() {
  return (
    <div className="min-h-screen bg-background p-10">
      <div className="mx-auto max-w-md rounded-xl border p-6">
        <CreateOrganizationForm onSuccess={() => {}} />
      </div>
    </div>
  );
}
