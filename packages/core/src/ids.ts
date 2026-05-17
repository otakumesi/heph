export type IdPrefix =
  | "agent_"
  | "run_"
  | "msg_"
  | "evt_"
  | "mem_"
  | "inbox_"
  | "op_"
  | "mcpbind_"
  | "skillbind_"
  | "approval_";

let fallbackCounter = 0;

export function createId(prefix: IdPrefix): string {
  const randomId = globalThis.crypto?.randomUUID?.();

  if (randomId) {
    return `${prefix}${randomId.replaceAll("-", "")}`;
  }

  fallbackCounter += 1;
  return `${prefix}${Date.now().toString(36)}${fallbackCounter.toString(36)}`;
}

export function createAgentSessionId(): string {
  return createId("agent_");
}

export function createRunId(): string {
  return createId("run_");
}

export function createMessageId(): string {
  return createId("msg_");
}

export function createRunEventId(): string {
  return createId("evt_");
}

export function createMemoryId(): string {
  return createId("mem_");
}

export function createInboxEventId(): string {
  return createId("inbox_");
}

export function createDeferredToolOperationId(): string {
  return createId("op_");
}

export function createMcpBindingId(): string {
  return createId("mcpbind_");
}

export function createSkillBindingId(): string {
  return createId("skillbind_");
}

export function createApprovalRequestId(): string {
  return createId("approval_");
}
