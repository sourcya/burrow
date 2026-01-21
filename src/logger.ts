import type { Logger } from "./types.ts";

/**
 * Creates a timestamped logger instance.
 * @returns A logger with info, warn, and error methods that prefix messages with ISO timestamps
 * @example
 * ```typescript
 * const log = createLogger();
 * log.info("Connected to broker"); // [2024-01-01T12:00:00.000Z] Connected to broker
 * ```
 */
export const createLogger = (): Logger => {
    const log = console.log.bind(console);
    const warn = console.warn.bind(console);
    const error = console.error.bind(console);

    /**
     * Get current ISO timestamp.
     * @returns ISO formatted timestamp string
     */
    const ts = (): string => new Date().toISOString();

    return {
        info: (...args: unknown[]) => log(`[${ts()}]`, ...args),
        warn: (...args: unknown[]) => warn(`[${ts()}]`, ...args),
        error: (...args: unknown[]) => error(`[${ts()}]`, ...args),
    };
};

/**
 * Default logger instance.
 */
export const logger: Logger = createLogger();
