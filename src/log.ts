export type LogLevel = "log" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface LogSink {
 log(...args: unknown[]): void;
 warn(...args: unknown[]): void;
 error(...args: unknown[]): void;
}

export interface StructuredLogger {
 log(message: string, fields?: LogFields): void;
 warn(message: string, fields?: LogFields): void;
 error(message: string, fields?: LogFields): void;
}

export interface TickLogger extends StructuredLogger {
 tickId: string;
 logger: StructuredLogger;
}

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(?:password|passwd|secret|token|authorization|accessjwt|refreshjwt|app.?password|api.?key|private.?key)/i;

/**
 * Serialize arbitrary log data without allowing circular values, BigInts, or
 * Error objects to break the Worker. Sensitive-looking fields are redacted.
 */
export function safeJson(value: unknown): string {
 const ancestors: unknown[] = [];
 try {
  const serialized = JSON.stringify(value, function replacer(key, current) {
   if (key && SENSITIVE_KEY.test(key)) return REDACTED;
   if (typeof current === "bigint") return `${current}n`;
   if (current instanceof Error) {
    return { name: current.name, message: current.message, stack: current.stack };
   }
   if (current && typeof current === "object") {
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop();
    if (ancestors.includes(current)) return "[Circular]";
    ancestors.push(current);
   }
   return current;
  });
  return serialized === undefined ? "null" : serialized;
 } catch {
  return JSON.stringify({ value: "[Unserializable]" });
 }
}

/** Build a logger that emits one structured JSON object per console call. */
export function createLogger(baseFields: LogFields = {}, sink: LogSink = console): StructuredLogger {
 const emit = (level: LogLevel, message: string, fields: LogFields = {}): void => {
  const payload = {
   ...baseFields,
   ...fields,
   level,
   message,
   timestamp: new Date().toISOString(),
  };
  sink[level](safeJson(payload));
 };

 return {
  log: (message, fields) => emit("log", message, fields),
  warn: (message, fields) => emit("warn", message, fields),
  error: (message, fields) => emit("error", message, fields),
 };
}

/** Create a logger/context pair for one cron tick or request invocation. */
export function createTickLogger(
 tickId = newTickId(),
 sink: LogSink = console,
): TickLogger {
 const logger = createLogger({ tickId }, sink);
 return { tickId, logger, log: logger.log, warn: logger.warn, error: logger.error };
}

const defaultLogger = createLogger();

export function log(message: string, fields?: LogFields): void {
 defaultLogger.log(message, fields);
}

export function warn(message: string, fields?: LogFields): void {
 defaultLogger.warn(message, fields);
}

export function error(message: string, fields?: LogFields): void {
 defaultLogger.error(message, fields);
}

export function newTickId(): string {
 try {
  return crypto.randomUUID();
 } catch {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
 }
}

/** Alias useful when callers want to make the per-tick context explicit. */
export const createTickContext = createTickLogger;
