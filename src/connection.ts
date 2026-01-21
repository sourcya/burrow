import amqp from "amqplib";
import type { Channel, ConfirmChannel, ChannelModel } from "amqplib";
import type {
    ConnectionConfig,
    ReconnectConfig,
    ResilientConnectionOptions,
    ResilientConnection,
    ConnectionState,
    Metrics,
    Unsubscribe,
} from "./types.ts";
import { logger as defaultLogger } from "./logger.ts";
import { createMetricsCollector } from "./metrics.ts";
import type { MetricsCollector } from "./metrics.ts";

/**
 * Default reconnection configuration.
 */
const DEFAULT_RECONNECT: Required<ReconnectConfig> = {
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    multiplier: 2,
    maxRetries: -1,
};

/**
 * Default connection configuration.
 */
const DEFAULT_CONNECTION: Partial<ConnectionConfig> = {
    protocol: "amqp",
    port: 5672,
    username: "guest",
    password: "guest",
    vhost: "/",
};

/**
 * Sleep for a specified duration.
 * @param ms - Duration in milliseconds
 * @returns Promise that resolves after the duration
 */
const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Internal state for the connection manager.
 */
interface ConnectionManagerState {
    connection: ChannelModel | null;
    state: ConnectionState;
    isShuttingDown: boolean;
    reconnectSubscribers: Set<() => void>;
}

/**
 * Creates a resilient connection to RabbitMQ with automatic reconnection.
 * @param options - Connection and reconnection options
 * @returns A resilient connection instance
 * @example
 * ```typescript
 * const conn = await createConnection({
 *   connection: { hostname: "localhost", port: 5672 },
 *   reconnect: { initialDelayMs: 1000, maxDelayMs: 30000 },
 *   onConnect: () => console.log("Connected!"),
 *   onDisconnect: (err) => console.log("Disconnected:", err?.message),
 * });
 *
 * const channel = await conn.createChannel();
 * ```
 */
export const createConnection = async (
    options: ResilientConnectionOptions
): Promise<ResilientConnection> => {
    const log = defaultLogger;
    const metrics: MetricsCollector = createMetricsCollector();

    const connConfig: Required<ConnectionConfig> = {
        ...DEFAULT_CONNECTION,
        ...options.connection,
    } as Required<ConnectionConfig>;

    const reconnectConfig: Required<ReconnectConfig> = {
        ...DEFAULT_RECONNECT,
        ...options.reconnect,
    };

    const state: ConnectionManagerState = {
        connection: null,
        state: "disconnected",
        isShuttingDown: false,
        reconnectSubscribers: new Set(),
    };

    /**
     * Schedule a reconnection attempt.
     */
    const scheduleReconnect = (): void => {
        if (state.isShuttingDown || state.state === "reconnecting") return;

        state.state = "reconnecting";
        metrics.setConnectionState("reconnecting");
        state.connection = null;

        log.info("[burrow] Scheduling reconnection...");

        connectWithRetry().catch((err) => {
            log.error("[burrow] Reconnection failed:", err);
        });
    };

    /**
     * Connect to RabbitMQ with retry logic.
     * @returns Promise that resolves when connected
     */
    const connectWithRetry = async (): Promise<void> => {
        let delay = reconnectConfig.initialDelayMs;
        let attempt = 0;

        while (!state.isShuttingDown) {
            attempt++;
            metrics.setReconnectAttempt(attempt);
            metrics.setConnectionState("connecting");
            state.state = "connecting";

            if (options.onReconnecting) {
                options.onReconnecting(attempt);
            }

            try {
                log.info(`[burrow] Connecting to ${connConfig.hostname}:${connConfig.port} (attempt ${attempt})...`);

                state.connection = await amqp.connect({
                    protocol: connConfig.protocol,
                    hostname: connConfig.hostname,
                    port: connConfig.port,
                    username: connConfig.username,
                    password: connConfig.password,
                    vhost: connConfig.vhost,
                });

                // Attach error handlers immediately
                state.connection.on("error", (err: Error) => {
                    log.error("[burrow] Connection error:", err.message);
                });

                state.connection.on("close", () => {
                    log.warn("[burrow] Connection closed");
                    metrics.recordDisconnect();
                    if (options.onDisconnect) {
                        options.onDisconnect();
                    }
                    if (!state.isShuttingDown) {
                        scheduleReconnect();
                    }
                });

                state.state = "connected";
                metrics.recordConnect();
                log.info("[burrow] Connected successfully");

                if (options.onConnect) {
                    options.onConnect();
                }

                for (const subscriber of state.reconnectSubscribers) {
                    try {
                        subscriber();
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        log.error("[burrow] Reconnect subscriber error:", message);
                    }
                }

                return;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log.error(`[burrow] Connection failed: ${message}`);

                if (state.connection) {
                    try {
                        state.connection.removeAllListeners();
                        await state.connection.close();
                    } catch {
                        // Ignore cleanup errors
                    }
                    state.connection = null;
                }

                if (reconnectConfig.maxRetries !== -1 && attempt >= reconnectConfig.maxRetries) {
                    throw new Error(`Failed to connect after ${attempt} attempts: ${message}`);
                }

                log.info(`[burrow] Retrying in ${delay}ms...`);
                await sleep(delay);
                delay = Math.min(delay * reconnectConfig.multiplier, reconnectConfig.maxDelayMs);
            }
        }
    };

    /**
     * Get the underlying amqplib connection.
     * @returns The connection or null if disconnected
     */
    const getConnection = (): ChannelModel | null => state.connection;

    /**
     * Check if currently connected.
     * @returns True if connected
     */
    const isConnected = (): boolean => state.state === "connected" && state.connection !== null;

    /**
     * Get current connection state.
     * @returns The connection state
     */
    const getState = (): ConnectionState => state.state;

    /**
     * Create a regular channel.
     * @returns A channel or null if not connected
     */
    const createChannel = async (): Promise<Channel | null> => {
        if (!state.connection) return null;

        try {
            const channel = await state.connection.createChannel();

            channel.on("error", (err: Error) => {
                log.error("[burrow] Channel error:", err.message);
            });

            channel.on("close", () => {
                log.warn("[burrow] Channel closed");
            });

            return channel;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.error("[burrow] Failed to create channel:", message);
            return null;
        }
    };

    /**
     * Create a confirm channel for publisher confirms.
     * @returns A confirm channel or null if not connected
     */
    const createConfirmChannel = async (): Promise<ConfirmChannel | null> => {
        if (!state.connection) return null;

        try {
            const channel = await state.connection.createConfirmChannel();

            channel.on("error", (err: Error) => {
                log.error("[burrow] Confirm channel error:", err.message);
            });

            channel.on("close", () => {
                log.warn("[burrow] Confirm channel closed");
            });

            return channel;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.error("[burrow] Failed to create confirm channel:", message);
            return null;
        }
    };

    /**
     * Close the connection gracefully.
     * @returns Promise that resolves when closed
     */
    const close = async (): Promise<void> => {
        state.isShuttingDown = true;

        if (state.connection) {
            try {
                await state.connection.close();
                log.info("[burrow] Connection closed gracefully");
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log.error("[burrow] Error closing connection:", message);
            }
        }

        state.connection = null;
        state.state = "disconnected";
        metrics.setConnectionState("disconnected");
    };

    /**
     * Get current metrics.
     * @returns Metrics snapshot
     */
    const getMetrics = (): Metrics => metrics.getMetrics();

    /**
     * Subscribe to reconnection events.
     * @param callback - Function to call when reconnected
     * @returns Unsubscribe function
     */
    const onReconnect = (callback: () => void): Unsubscribe => {
        state.reconnectSubscribers.add(callback);
        return () => {
            state.reconnectSubscribers.delete(callback);
        };
    };

    // Initial connection
    await connectWithRetry();

    return {
        getConnection,
        isConnected,
        getState,
        createChannel,
        createConfirmChannel,
        close,
        getMetrics,
        onReconnect,
    };
};
