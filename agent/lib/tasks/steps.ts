import type * as operations from "./operations";

export async function beginTask(...args: Parameters<typeof operations.beginTask>) {
  "use step";
  const operations = await import("./operations");
  return operations.beginTask(...args);
}

export async function taskContext(...args: Parameters<typeof operations.taskContext>) {
  "use step";
  const operations = await import("./operations");
  return operations.taskContext(...args);
}

export async function workerState(...args: Parameters<typeof operations.workerState>) {
  "use step";
  const operations = await import("./operations");
  return operations.workerState(...args);
}

export async function advance(...args: Parameters<typeof operations.advance>) {
  "use step";
  const operations = await import("./operations");
  return operations.advance(...args);
}

export async function saveProposal(...args: Parameters<typeof operations.saveProposal>) {
  "use step";
  const operations = await import("./operations");
  return operations.saveProposal(...args);
}

export async function uploadTaskPolicy(...args: Parameters<typeof operations.uploadTaskPolicy>) {
  "use step";
  const operations = await import("./operations");
  return operations.uploadTaskPolicy(...args);
}

export async function requestTaskGame(...args: Parameters<typeof operations.requestTaskGame>) {
  "use step";
  const operations = await import("./operations");
  return operations.requestTaskGame(...args);
}

export async function evaluationContext(...args: Parameters<typeof operations.evaluationContext>) {
  "use step";
  const operations = await import("./operations");
  return operations.evaluationContext(...args);
}

export async function taskFailure(...args: Parameters<typeof operations.taskFailure>) {
  "use step";
  const operations = await import("./operations");
  return operations.taskFailure(...args);
}

export async function routeTask(...args: Parameters<typeof operations.routeTask>) {
 "use step";
 const operations=await import("./operations");
 return operations.routeTask(...args);
}
