import type { Channel, ConsumeMessage } from "amqplib";
import type {
    ResilientConnection,
    Consumer,
    ConsumerOptions,
    Metrics,
    Unsubscribe,
} from "./types.ts";
import { logger as defaultLogger } from "./logger.ts";

/**
 * Default consumer options.
 */
const DEFAULT_OPTIONS: Partial<ConsumerOptions> = {
    routingKey: "#",
    durable: true,
    prefetch: 10,
};

/**
 * Internal state for the consumer.
 */
interface ConsumerState {
    channel: Channel | null;
    consumerTag: string | null;
    isActive: boolean;
    wasActive: boolean;
    messagesConsumed: number;
    messagesConsumeFailed: number;
    lastConsumeAt: Date | null;
    unsubscribeReconnect: Unsubscribe | null;
}

/**
 * Creates a consumer for receiving messages from a queue.
 * @param connection - The resilient connection to use
 * @param options - Consumer options including queue and message handler
 * @returns A consumer instance
 * @example
 * ```typescript
 * const consumer = await createConsumer(conn, {
 *   queue: "my-queue",
 *   exchange: "events",
 *   routingKey: "user.*",
 *   prefetch: 10,
 *   onMessage: async (msg) => {
 *     console.log("Received:", msg.content.toString());
 *   },
 *   onError: (err, msg) => {
 *     console.error("Failed to process:", err);
 *   },
 * });
 *
 * await consumer.start();
 * ```
 */
export const createConsumer = async (
    connection: ResilientConnection,
    options: ConsumerOptions
): Promise<Consumer> => {
    const log = defaultLogger;
    const opts = {
        ...DEFAULT_OPTIONS,
        ...options,
    };

    const state: ConsumerState = {
        channel: null,
        consumerTag: null,
        isActive: false,
        wasActive: false,
        messagesConsumed: 0,
        messagesConsumeFailed: 0,
        lastConsumeAt: null,
        unsubscribeReconnect: null,
    };

    /**
     * Setup the channel, queue, and bindings.
     * @returns Promise that resolves when ready
     */
    const setup = async (): Promise<void> => {
        if (state.channel) {
            try {
                await state.channel.close();
            } catch {
                // Channel may already be closed
            }
            state.channel = null;
        }

        state.channel = await connection.createChannel();

        if (!state.channel) {
            throw new Error("Failed to create channel");
        }

        await state.channel.prefetch(opts.prefetch!);

        await state.channel.assertQueue(opts.queue, {
            durable: opts.durable,
        });

        if (opts.exchange) {
            await state.channel.assertExchange(opts.exchange, "topic", {
                durable: opts.durable,
            });
            await state.channel.bindQueue(opts.queue, opts.exchange, opts.routingKey!);
        }

        state.channel.on("close", () => {
            log.warn(`[burrow:consumer] Channel closed for queue ${opts.queue}`);
            state.wasActive = state.isActive;
            state.isActive = false;
            state.channel = null;
            state.consumerTag = null;
        });

        log.info(`[burrow:consumer] Setup complete for queue ${opts.queue}`);
    };

    /**
     * Handle reconnection by re-setting up and resuming if was active.
     */
    const handleReconnect = async (): Promise<void> => {
        log.info(`[burrow:consumer] Connection restored, re-setting up queue ${opts.queue}`);
        try {
            await setup();
            if (state.wasActive) {
                await startConsuming();
                log.info(`[burrow:consumer] Resumed consuming from ${opts.queue}`);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.error(`[burrow:consumer] Failed to re-setup after reconnect:`, message);
        }
    };

    /**
     * Handle an incoming message.
     * @param msg - The consumed message or null if consumer cancelled
     */
    const handleMessage = async (msg: ConsumeMessage | null): Promise<void> => {
        if (!msg || !state.channel) return;

        try {
            await opts.onMessage(msg);
            state.channel.ack(msg);
            state.messagesConsumed++;
            state.lastConsumeAt = new Date();
        } catch (err) {
            state.messagesConsumeFailed++;
            const error = err instanceof Error ? err : new Error(String(err));

            if (opts.onError) {
                opts.onError(error, msg);
            } else {
                log.error(`[burrow:consumer] Message processing failed:`, error.message);
            }

            try {
                const requeue = !msg.fields.redelivered;
                state.channel.nack(msg, false, requeue);
            } catch {
                // Channel likely closed
            }
        }
    };

    /**
     * Internal function to start consuming.
     */
    const startConsuming = async (): Promise<void> => {
        if (!state.channel) {
            throw new Error("No channel available");
        }

        const { consumerTag } = await state.channel.consume(
            opts.queue,
            handleMessage
        );

        state.consumerTag = consumerTag;
        state.isActive = true;
        state.wasActive = true;
    };

    /**
     * Start consuming messages.
     * @returns Promise that resolves when consuming
     */
    const start = async (): Promise<void> => {
        if (!state.channel) {
            await setup();
        }

        if (!state.channel) {
            throw new Error("Failed to setup channel");
        }

        if (state.isActive) {
            log.warn(`[burrow:consumer] Already consuming from ${opts.queue}`);
            return;
        }

        await startConsuming();
        log.info(`[burrow:consumer] Started consuming from ${opts.queue}`);
    };

    /**
     * Stop consuming messages.
     * @returns Promise that resolves when stopped
     */
    const stop = async (): Promise<void> => {
        if (state.channel && state.consumerTag) {
            try {
                await state.channel.cancel(state.consumerTag);
                log.info(`[burrow:consumer] Stopped consuming from ${opts.queue}`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log.error(`[burrow:consumer] Error stopping:`, message);
            }
        }
        state.consumerTag = null;
        state.isActive = false;
        state.wasActive = false;
    };

    /**
     * Close the consumer and clean up resources.
     * @returns Promise that resolves when closed
     */
    const close = async (): Promise<void> => {
        if (state.unsubscribeReconnect) {
            state.unsubscribeReconnect();
            state.unsubscribeReconnect = null;
        }

        await stop();

        if (state.channel) {
            try {
                await state.channel.close();
            } catch {
                // Channel may already be closed
            }
            state.channel = null;
        }
    };

    /**
     * Check if consumer is active.
     * @returns True if actively consuming
     */
    const isActive = (): boolean => state.isActive;

    /**
     * Get consumer metrics.
     * @returns Consumer metrics snapshot
     */
    const getMetrics = (): Pick<Metrics, "messagesConsumed" | "messagesConsumeFailed" | "lastConsumeAt"> => ({
        messagesConsumed: state.messagesConsumed,
        messagesConsumeFailed: state.messagesConsumeFailed,
        lastConsumeAt: state.lastConsumeAt,
    });

    // Initial setup
    await setup();

    // Subscribe to reconnection events
    state.unsubscribeReconnect = connection.onReconnect(() => {
        handleReconnect().catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            log.error(`[burrow:consumer] Reconnect handler error:`, message);
        });
    });

    return {
        start,
        stop,
        close,
        isActive,
        getMetrics,
    };
};
