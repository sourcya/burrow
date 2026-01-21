import { Buffer } from "node:buffer";
import type { ConfirmChannel } from "amqplib";
import type {
    ResilientConnection,
    Publisher,
    PublisherOptions,
    Metrics,
} from "./types.ts";
import { logger as defaultLogger } from "./logger.ts";

/**
 * Default publisher options.
 */
const DEFAULT_OPTIONS: Partial<PublisherOptions> = {
    exchangeType: "topic",
    durable: true,
    deliveryMode: 2,
    contentType: "application/json",
};

/**
 * Internal state for the publisher.
 */
interface PublisherState {
    channel: ConfirmChannel | null;
    isReady: boolean;
    messagesPublished: number;
    messagesPublishFailed: number;
    lastPublishAt: Date | null;
}

/**
 * Creates a publisher for sending messages to an exchange.
 * @param connection - The resilient connection to use
 * @param options - Publisher options including exchange configuration
 * @returns A publisher instance
 * @example
 * ```typescript
 * const publisher = await createPublisher(conn, {
 *   exchange: "events",
 *   exchangeType: "topic",
 *   deliveryMode: 2,
 * });
 *
 * await publisher.publish("user.created", { id: 1, name: "John" });
 * ```
 */
export const createPublisher = async (
    connection: ResilientConnection,
    options: PublisherOptions
): Promise<Publisher> => {
    const log = defaultLogger;
    const opts: Required<PublisherOptions> = {
        ...DEFAULT_OPTIONS,
        ...options,
    } as Required<PublisherOptions>;

    const state: PublisherState = {
        channel: null,
        isReady: false,
        messagesPublished: 0,
        messagesPublishFailed: 0,
        lastPublishAt: null,
    };

    /**
     * Setup the channel and exchange.
     * @returns Promise that resolves when ready
     */
    const setup = async (): Promise<void> => {
        state.channel = await connection.createConfirmChannel();

        if (!state.channel) {
            throw new Error("Failed to create confirm channel");
        }

        await state.channel.assertExchange(opts.exchange, opts.exchangeType, {
            durable: opts.durable,
        });

        state.channel.on("close", () => {
            log.warn(`[burrow:publisher] Channel closed for exchange ${opts.exchange}`);
            state.isReady = false;
            state.channel = null;
        });

        state.isReady = true;
        log.info(`[burrow:publisher] Ready on exchange ${opts.exchange}`);
    };

    /**
     * Publish a message to the exchange.
     * @param routingKey - Routing key for the message
     * @param content - Message content (will be JSON stringified if object)
     * @returns Promise that resolves when message is confirmed
     */
    const publish = (routingKey: string, content: unknown): Promise<void> => {
        if (!state.channel || !state.isReady) {
            state.messagesPublishFailed++;
            return Promise.reject(new Error("Publisher not ready"));
        }

        const buffer = Buffer.from(
            typeof content === "string" ? content : JSON.stringify(content)
        );

        return new Promise((resolve, reject) => {
            try {
                state.channel!.publish(
                    opts.exchange,
                    routingKey,
                    buffer,
                    {
                        contentType: opts.contentType,
                        deliveryMode: opts.deliveryMode,
                        persistent: opts.deliveryMode === 2,
                    },
                    (err: Error | null) => {
                        if (err) {
                            state.messagesPublishFailed++;
                            reject(err);
                        } else {
                            state.messagesPublished++;
                            state.lastPublishAt = new Date();
                            resolve();
                        }
                    }
                );
            } catch (publishErr) {
                state.messagesPublishFailed++;
                reject(publishErr);
            }
        });
    };

    /**
     * Check if publisher is ready.
     * @returns True if ready to publish
     */
    const isReady = (): boolean => state.isReady && state.channel !== null;

    /**
     * Close the publisher.
     * @returns Promise that resolves when closed
     */
    const close = async (): Promise<void> => {
        if (state.channel) {
            try {
                await state.channel.close();
                log.info(`[burrow:publisher] Closed for exchange ${opts.exchange}`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log.error(`[burrow:publisher] Error closing:`, message);
            }
        }
        state.channel = null;
        state.isReady = false;
    };

    /**
     * Get publisher metrics.
     * @returns Publisher metrics snapshot
     */
    const getMetrics = (): Pick<Metrics, "messagesPublished" | "messagesPublishFailed" | "lastPublishAt"> => ({
        messagesPublished: state.messagesPublished,
        messagesPublishFailed: state.messagesPublishFailed,
        lastPublishAt: state.lastPublishAt,
    });

    // Initial setup
    await setup();

    return {
        publish,
        isReady,
        close,
        getMetrics,
    };
};
