import type { Channel, ConfirmChannel, ConsumeMessage } from "amqplib";
import type {
    BridgeOptions,
    BridgeMetrics,
    BridgeState,
    Bridge,
} from "./types.ts";
import { logger as log } from "./logger.ts";

/**
 * Default bridge configuration.
 */
const DEFAULT_OPTIONS = {
    prefetch: 50,
    queuePrefix: "bridge_",
    deliveryMode: 2 as const,
    logEveryNMessages: 100,
};

/**
 * Internal state for the bridge.
 */
interface BridgeInternalState {
    consumerChannel: Channel | null;
    producerChannel: ConfirmChannel | null;
    isRunning: boolean;
    consumerTags: string[];
    metrics: {
        messagesForwarded: number;
        messagesFailed: number;
        lastMessageAt: Date | null;
    };
    errorLogCount: number;
    lastErrorLogReset: number;
}

const ERROR_LOG_LIMIT = 10;
const ERROR_LOG_WINDOW_MS = 5000;

/**
 * Creates a bridge that forwards messages from a source broker to a target broker.
 * @param options - Bridge configuration options
 * @returns A bridge instance
 * @example
 * ```typescript
 * const bridge = createBridge({
 *   source: sourceConnection,
 *   target: targetConnection,
 *   exchanges: ["events", "notifications"],
 *   prefetch: 50,
 * });
 *
 * await bridge.start();
 * console.log(bridge.getMetrics());
 * ```
 */
export const createBridge = (options: BridgeOptions): Bridge => {
    const opts = {
        prefetch: options.prefetch ?? DEFAULT_OPTIONS.prefetch,
        queuePrefix: options.queuePrefix ?? DEFAULT_OPTIONS.queuePrefix,
        deliveryMode: options.deliveryMode ?? DEFAULT_OPTIONS.deliveryMode,
        logEveryNMessages: options.logEveryNMessages ?? DEFAULT_OPTIONS.logEveryNMessages,
    };

    const state: BridgeInternalState = {
        consumerChannel: null,
        producerChannel: null,
        isRunning: false,
        consumerTags: [],
        metrics: {
            messagesForwarded: 0,
            messagesFailed: 0,
            lastMessageAt: null,
        },
        errorLogCount: 0,
        lastErrorLogReset: Date.now(),
    };

    /**
     * Check if an error should be logged (rate limiting).
     * @returns Whether to log the error
     */
    const shouldLogError = (): boolean => {
        const now = Date.now();
        if (now - state.lastErrorLogReset > ERROR_LOG_WINDOW_MS) {
            if (state.errorLogCount > ERROR_LOG_LIMIT) {
                log.warn(`[bridge] Suppressed ${state.errorLogCount - ERROR_LOG_LIMIT} error logs in last ${ERROR_LOG_WINDOW_MS}ms`);
            }
            state.errorLogCount = 0;
            state.lastErrorLogReset = now;
        }
        state.errorLogCount++;
        return state.errorLogCount <= ERROR_LOG_LIMIT;
    };

    /**
     * Log forwarded message stats periodically.
     * @param exchange - Exchange name
     * @param routingKey - Routing key
     */
    const logForwarded = (exchange: string, routingKey: string): void => {
        state.metrics.messagesForwarded++;
        state.metrics.lastMessageAt = new Date();
        if (opts.logEveryNMessages > 0 && state.metrics.messagesForwarded % opts.logEveryNMessages === 0) {
            log.info(`[bridge] Forwarded ${state.metrics.messagesForwarded} messages, last: ${exchange} -> ${routingKey}`);
        }
    };

    /**
     * Forward a message to the target exchange.
     * @param channel - Producer confirm channel
     * @param exchange - Exchange name
     * @param routingKey - Routing key
     * @param content - Message content
     * @returns Promise that resolves when confirmed
     */
    const forwardMessage = (
        channel: ConfirmChannel,
        exchange: string,
        routingKey: string,
        content: ConsumeMessage["content"]
    ): Promise<void> =>
        new Promise((resolve, reject) => {
            try {
                channel.publish(
                    exchange,
                    routingKey,
                    content,
                    {
                        contentType: "application/json",
                        deliveryMode: opts.deliveryMode,
                        persistent: opts.deliveryMode === 2,
                    },
                    (err) => (err ? reject(err) : resolve())
                );
            } catch (err) {
                reject(err);
            }
        });

    /**
     * Handle an incoming message.
     * @param msg - Message or null
     * @param exchange - Exchange name
     */
    const handleMessage = async (
        msg: ConsumeMessage | null,
        exchange: string
    ): Promise<void> => {
        if (!msg) return;

        const consumerChannel = state.consumerChannel;
        const producerChannel = state.producerChannel;

        if (!consumerChannel || !producerChannel) {
            return;
        }

        const routingKey = msg.fields.routingKey;

        try {
            await forwardMessage(producerChannel, exchange, routingKey, msg.content);
            logForwarded(exchange, routingKey);
            consumerChannel.ack(msg);
        } catch (error) {
            state.metrics.messagesFailed++;
            const message = error instanceof Error ? error.message : String(error);

            const isChannelClosed = message.includes("Channel closed") || message.includes("channel closed");

            if (isChannelClosed) {
                if (shouldLogError()) {
                    log.warn(`[bridge] Channel closed, messages will be redelivered on reconnect`);
                }
                return;
            }

            if (shouldLogError()) {
                log.error(`[bridge] Forward error (${exchange} -> ${routingKey}):`, message);
            }

            try {
                const requeue = !msg.fields.redelivered;
                consumerChannel.nack(msg, false, requeue);

                if (!requeue && shouldLogError()) {
                    log.error(`[bridge] Message permanently failed: ${exchange} -> ${routingKey}`);
                }
            } catch {
                // Channel likely closed
            }
        }
    };

    /**
     * Start the bridge.
     * @returns Whether the bridge started successfully
     */
    const start = async (): Promise<boolean> => {
        if (!options.source.isConnected() || !options.target.isConnected()) {
            log.warn("[bridge] Cannot start - waiting for both connections");
            return false;
        }

        if (!state.consumerChannel) {
            state.consumerChannel = await options.source.createChannel();
        }
        if (!state.producerChannel) {
            state.producerChannel = await options.target.createConfirmChannel();
        }

        if (!state.consumerChannel || !state.producerChannel) {
            log.warn("[bridge] Cannot start - failed to create channels");
            return false;
        }

        state.consumerTags.length = 0;
        await state.consumerChannel.prefetch(opts.prefetch);

        for (const exchange of options.exchanges) {
            await state.consumerChannel.assertExchange(exchange, "topic", { durable: true });
            await state.producerChannel.assertExchange(exchange, "topic", { durable: true });

            const queueName = `${opts.queuePrefix}${exchange}`;
            await state.consumerChannel.assertQueue(queueName, { durable: true }).catch((err: Error) => {
                log.warn(`[bridge] Queue ${queueName} assertion warning:`, err.message);
                return { queue: queueName };
            });

            await state.consumerChannel.bindQueue(queueName, exchange, "#");

            const { consumerTag } = await state.consumerChannel.consume(
                queueName,
                (msg: ConsumeMessage | null) => handleMessage(msg, exchange)
            );

            state.consumerTags.push(consumerTag);
            log.info(`[bridge] Consuming from ${queueName}`);
        }

        state.isRunning = true;
        log.info("[bridge] Started - forwarding messages");

        if (options.onStart) {
            options.onStart();
        }

        return true;
    };

    /**
     * Stop the bridge.
     */
    const stop = async (): Promise<void> => {
        for (const tag of state.consumerTags) {
            try {
                await state.consumerChannel?.cancel(tag);
            } catch {
                // Ignore errors
            }
        }
        state.consumerTags.length = 0;

        try {
            await state.consumerChannel?.close();
        } catch {
            // Ignore errors
        }
        try {
            await state.producerChannel?.close();
        } catch {
            // Ignore errors
        }

        state.consumerChannel = null;
        state.producerChannel = null;
        state.isRunning = false;

        log.info("[bridge] Stopped");

        if (options.onStop) {
            options.onStop();
        }
    };

    /**
     * Check if bridge is running.
     * @returns True if running
     */
    const isRunning = (): boolean => state.isRunning;

    /**
     * Get bridge metrics.
     * @returns Copy of metrics
     */
    const getMetrics = (): BridgeMetrics => ({
        messagesForwarded: state.metrics.messagesForwarded,
        messagesFailed: state.metrics.messagesFailed,
        lastMessageAt: state.metrics.lastMessageAt,
    });

    /**
     * Get full bridge state.
     * @returns Current bridge state
     */
    const getState = (): BridgeState => ({
        sourceConnected: options.source.isConnected(),
        targetConnected: options.target.isConnected(),
        isRunning: state.isRunning,
        metrics: getMetrics(),
    });

    return {
        start,
        stop,
        isRunning,
        getMetrics,
        getState,
    };
};
