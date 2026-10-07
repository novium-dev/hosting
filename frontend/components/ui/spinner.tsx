import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const { t } = useTranslation()

  return (
    <Loader2Icon data-slot="spinner" role="status" aria-label={t("common:a11y.loading")} className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
