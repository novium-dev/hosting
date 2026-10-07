import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  type FieldValues,
  type Resolver,
  type UseFormProps,
  useForm,
} from "react-hook-form";
import type { SafeActionFn, SafeActionResult } from "./safe-action";

// Client-side replacements for next-safe-action's `useAction` and the
// react-hook-form adapter's `useHookFormAction`, matching the subset of their
// API surface used across the app.

export type ActionCallbacks<I, O> = {
  onSuccess?: (args: { data: O | undefined; input: I }) => void | Promise<void>;
  onError?: (args: {
    error: { serverError?: string; validationErrors?: unknown };
    input: I;
  }) => void;
  onSettled?: (args: { result: SafeActionResult<O>; input: I }) => void;
};

export function useAction<I, O>(
  action: SafeActionFn<I, O>,
  callbacks: ActionCallbacks<I, O> = {},
) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<SafeActionResult<O>>({});
  const callbacksRef = useRef(callbacks);
  useLayoutEffect(() => {
    callbacksRef.current = callbacks;
  });

  const executeAsync = useCallback(
    async (input: I) => {
      setIsExecuting(true);
      const res = await action(input);
      setResult(res);
      setIsExecuting(false);

      const cb = callbacksRef.current;
      if (res.serverError || res.validationErrors) {
        cb.onError?.({
          error: {
            serverError: res.serverError,
            validationErrors: res.validationErrors,
          },
          input,
        });
      } else {
        await cb.onSuccess?.({ data: res.data, input });
      }
      cb.onSettled?.({ result: res, input });
      return res;
    },
    [action],
  );

  const execute = useCallback(
    (input: I) => {
      void executeAsync(input);
    },
    [executeAsync],
  );

  const reset = useCallback(() => {
    setResult({});
    setIsExecuting(false);
  }, []);

  return {
    execute,
    executeAsync,
    isExecuting,
    isPending: isExecuting,
    hasSucceeded: result.data !== undefined,
    hasErrored: Boolean(result.serverError || result.validationErrors),
    result,
    reset,
  };
}

export function useHookFormAction<S extends FieldValues, O>(
  action: SafeActionFn<S, O>,
  resolver: Resolver<S>,
  options?: {
    formProps?: Omit<UseFormProps<S>, "resolver">;
    actionProps?: ActionCallbacks<S, O>;
  },
) {
  const form = useForm<S>({ ...options?.formProps, resolver });
  const actionHook = useAction<S, O>(action, options?.actionProps ?? {});

  const handleSubmitWithAction = form.handleSubmit(async (values) => {
    await actionHook.executeAsync(values as S);
  });

  const resetFormAndAction = useCallback(() => {
    form.reset();
    actionHook.reset();
  }, [form, actionHook]);

  return {
    form,
    action: actionHook,
    handleSubmitWithAction,
    resetFormAndAction,
  };
}
