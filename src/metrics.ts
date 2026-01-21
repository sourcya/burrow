import type { Metrics, ConnectionState } from "./types.ts";

/**
 * Internal mutable metrics state.
 */
interface MutableMetrics {
    connectionState: ConnectionState;
    connectionsEstablished: number;
    connectionsLost: number;
    messagesPublished: number;
    messagesPublishFailed: number;
    messagesConsumed: number;
    messagesConsumeFailed: number;
    lastPublishAt: Date | null;
    lastConsumeAt: Date | null;
    reconnectAttempt: number;
}

/**
 * Metrics collector interface.
 */
export interface MetricsCollector {
    /** Get a readonly snapshot of current metrics */
    readonly getMetrics: () => Metrics;
    /** Record a successful connection */
    readonly recordConnect: () => void;
    /** Record a connection loss */
    readonly recordDisconnect: () => void;
    /** Record a successful publish */
    readonly recordPublish: () => void;
    /** Record a failed publish */
    readonly recordPublishFailed: () => void;
    /** Record a successful consume */
    readonly recordConsume: () => void;
    /** Record a failed consume */
    readonly recordConsumeFailed: () => void;
    /** Set connection state */
    readonly setConnectionState: (state: ConnectionState) => void;
    /** Set reconnect attempt number */
    readonly setReconnectAttempt: (attempt: number) => void;
    /** Reset all metrics */
    readonly reset: () => void;
}

/**
 * Creates a metrics collector instance.
 * @returns A metrics collector for tracking connection and message statistics
 * @example
 * ```typescript
 * const metrics = createMetricsCollector();
 * metrics.recordConnect();
 * metrics.recordPublish();
 * console.log(metrics.getMetrics());
 * ```
 */
export const createMetricsCollector = (): MetricsCollector => {
    const state: MutableMetrics = {
        connectionState: "disconnected",
        connectionsEstablished: 0,
        connectionsLost: 0,
        messagesPublished: 0,
        messagesPublishFailed: 0,
        messagesConsumed: 0,
        messagesConsumeFailed: 0,
        lastPublishAt: null,
        lastConsumeAt: null,
        reconnectAttempt: 0,
    };

    /**
     * Get a readonly snapshot of current metrics.
     * @returns Immutable copy of current metrics
     */
    const getMetrics = (): Metrics => ({ ...state });

    /**
     * Record a successful connection.
     */
    const recordConnect = (): void => {
        state.connectionsEstablished++;
        state.connectionState = "connected";
        state.reconnectAttempt = 0;
    };

    /**
     * Record a connection loss.
     */
    const recordDisconnect = (): void => {
        state.connectionsLost++;
        state.connectionState = "disconnected";
    };

    /**
     * Record a successful publish.
     */
    const recordPublish = (): void => {
        state.messagesPublished++;
        state.lastPublishAt = new Date();
    };

    /**
     * Record a failed publish.
     */
    const recordPublishFailed = (): void => {
        state.messagesPublishFailed++;
    };

    /**
     * Record a successful consume.
     */
    const recordConsume = (): void => {
        state.messagesConsumed++;
        state.lastConsumeAt = new Date();
    };

    /**
     * Record a failed consume.
     */
    const recordConsumeFailed = (): void => {
        state.messagesConsumeFailed++;
    };

    /**
     * Set current connection state.
     * @param newState - The new connection state
     */
    const setConnectionState = (newState: ConnectionState): void => {
        state.connectionState = newState;
    };

    /**
     * Set current reconnect attempt number.
     * @param attempt - The attempt number (0 if not reconnecting)
     */
    const setReconnectAttempt = (attempt: number): void => {
        state.reconnectAttempt = attempt;
    };

    /**
     * Reset all metrics to initial values.
     */
    const reset = (): void => {
        state.connectionState = "disconnected";
        state.connectionsEstablished = 0;
        state.connectionsLost = 0;
        state.messagesPublished = 0;
        state.messagesPublishFailed = 0;
        state.messagesConsumed = 0;
        state.messagesConsumeFailed = 0;
        state.lastPublishAt = null;
        state.lastConsumeAt = null;
        state.reconnectAttempt = 0;
    };

    return {
        getMetrics,
        recordConnect,
        recordDisconnect,
        recordPublish,
        recordPublishFailed,
        recordConsume,
        recordConsumeFailed,
        setConnectionState,
        setReconnectAttempt,
        reset,
    };
};
