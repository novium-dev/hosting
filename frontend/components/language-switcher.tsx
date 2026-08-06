import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supportedLanguages, type SupportedLanguage } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const currentLanguage = (i18n.resolvedLanguage ??
    i18n.language) as SupportedLanguage;

  return (
    <Select
      value={currentLanguage}
      onValueChange={(value) => void i18n.changeLanguage(value)}
    >
      <SelectTrigger
        size="sm"
        className="w-fit"
        aria-label={t("language.label")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {supportedLanguages.map((language) => (
          <SelectItem key={language} value={language}>
            {t(`language.${language}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
