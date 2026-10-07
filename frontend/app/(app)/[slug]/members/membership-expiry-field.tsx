"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const PRESET_DAYS = [1, 7, 30, 90];
const DEFAULT_PRESET_DAYS = 7;

function inDays(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function MembershipExpiryField({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => toLocalInput(value));
  const [draftValue, setDraftValue] = useState(value);
  const [minDate] = useState(() => toLocalInput(new Date().toISOString()));

  if (value !== draftValue) {
    setDraftValue(value);
    setDraft(toLocalInput(value));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 rounded-md border p-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {t("project:members.expiry.limitTitle")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("project:members.expiry.limitDescription")}
          </p>
        </div>
        <Switch
          checked={value !== null}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange(checked ? inDays(DEFAULT_PRESET_DAYS) : null)
          }
        />
      </div>
      {value !== null && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {PRESET_DAYS.map((days) => (
              <Button
                key={days}
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onChange(inDays(days))}
              >
                {t("project:members.expiry.preset", { count: days })}
              </Button>
            ))}
          </div>
          <Input
            type="datetime-local"
            value={draft}
            disabled={disabled}
            min={minDate}
            onChange={(event) => {
              setDraft(event.target.value);
              const parsed = new Date(event.target.value);
              if (!Number.isNaN(parsed.getTime())) {
                onChange(parsed.toISOString());
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
