import { AsyncLocalStorage } from "node:async_hooks";

export interface ModelUsageContext {
  authorization?: string;
  tenantId?: string;
  userId?: string;
  projectId?: string;
  slideId?: string;
  outputSummary?: string;
}

const storage = new AsyncLocalStorage<ModelUsageContext>();

export function currentModelUsageContext() {
  return storage.getStore();
}

export function runWithModelUsageContext<T>(
  context: ModelUsageContext,
  callback: () => T
): T {
  return storage.run(context, callback);
}

export function enterModelUsageContext(context: ModelUsageContext) {
  storage.enterWith(context);
}

export function runWithModelUsageResource<T>(
  resource: Pick<ModelUsageContext, "slideId" | "outputSummary">,
  callback: () => T
): T {
  return storage.run({ ...(storage.getStore() ?? {}), ...resource }, callback);
}

