import type { z } from "zod";

// Minimal client-side replacement for next-safe-action. Actions are plain async
// functions that run in the browser and hit the backend API (cookie auth). The
// builder keeps the `authActionClient.inputSchema(schema).action(handler)`
// surface so existing action definitions need almost no changes.

export type SafeActionResult<O> = {
  data?: O;
  serverError?: string;
  validationErrors?: {
    formErrors: string[];
    fieldErrors: Record<string, string[]>;
  };
};

export type SafeActionFn<I, O> = (input: I) => Promise<SafeActionResult<O>>;

type Handler<I, O> = (args: {
  parsedInput: I;
  ctx: Record<string, never>;
}) => Promise<O>;

class ActionBuilder<I> {
  constructor(private readonly schema?: z.ZodType<I>) {}

  inputSchema<S extends z.ZodType>(schema: S): ActionBuilder<z.infer<S>> {
    return new ActionBuilder(schema);
  }

  action<O>(handler: Handler<I, O>): SafeActionFn<I, O> {
    const schema = this.schema;
    return async (input: I): Promise<SafeActionResult<O>> => {
      let parsedInput = input;
      if (schema) {
        const parsed = schema.safeParse(input);
        if (!parsed.success) {
          return { validationErrors: parsed.error.flatten() };
        }
        parsedInput = parsed.data;
      }
      try {
        const data = await handler({ parsedInput, ctx: {} });
        return { data };
      } catch (error) {
        return {
          serverError:
            error instanceof Error ? error.message : "Something went wrong",
        };
      }
    };
  }
}

export const actionClient = new ActionBuilder<undefined>();
// Auth is enforced by the backend via the session cookie, so there is no
// separate client-side auth middleware anymore.
export const authActionClient = actionClient;
