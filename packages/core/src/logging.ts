export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  traceId?: string;
  leadId?: string;
  jobId?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

/** Structured JSON-lines logger. One line per event; greppable and machine-parseable. */
export function createLogger(base: LogFields = {}, sink: (line: string) => void = console.log): Logger {
  const emit = (level: LogLevel, msg: string, fields?: LogFields) => {
    sink(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...base, ...fields }));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (fields) => createLogger({ ...base, ...fields }, sink),
  };
}
