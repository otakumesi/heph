export type HephErrorCode =
  | "HEPH1001"
  | "HEPH2001"
  | "HEPH3001"
  | "HEPH3002"
  | "HEPH3003"
  | "HEPH3004"
  | "HEPH3005"
  | "HEPH4001"
  | "HEPH4002"
  | "HEPH4003"
  | "HEPH4004"
  | "HEPH4005"
  | "HEPH4006"
  | "HEPH5001"
  | "HEPH6001"
  | "HEPH6002"
  | "HEPH6003"
  | "HEPH6004"
  | "HEPH6005"
  | "HEPH7001"
  | "HEPH7002"
  | "HEPH8001"
  | "HEPH8002"
  | "HEPH8003"
  | "HEPH8004"
  | "HEPH9001"
  | "HEPH9002"
  | "HEPH9003";

export interface HephErrorOptions {
  code: HephErrorCode;
  title: string;
  message?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
  status?: number;
}

export class HephError extends Error {
  readonly code: HephErrorCode;
  readonly title: string;
  readonly details?: Record<string, unknown>;
  readonly status?: number;

  constructor(options: HephErrorOptions) {
    super(options.message ?? options.title, hasCause(options) ? { cause: options.cause } : undefined);
    this.name = "HephError";
    this.code = options.code;
    this.title = options.title;

    if (options.details !== undefined) {
      this.details = options.details;
    }

    if (options.status !== undefined) {
      this.status = options.status;
    }
  }
}

export function isHephError(error: unknown): error is HephError {
  return error instanceof HephError;
}

export function toErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }

  return {
    message: String(error)
  };
}

function hasCause(options: HephErrorOptions): options is HephErrorOptions & { cause: unknown } {
  return "cause" in options;
}
