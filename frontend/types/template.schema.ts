import { z } from "zod";

export const resyncTemplateSchema = z.object({
  /** Limit the resync to one template; omit to cover every server. */
  template: z.string().optional(),
  /** Restart the servers that are running, so the new build applies now. */
  restart: z.boolean().optional(),
});

export type ResyncTemplate = z.infer<typeof resyncTemplateSchema>;

export const refreshTemplateCacheSchema = z.object({
  /** Limit the refresh to one template; omit to refresh every template. */
  template: z.string().optional(),
});

export type RefreshTemplateCache = z.infer<typeof refreshTemplateCacheSchema>;
