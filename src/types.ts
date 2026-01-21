import type { Channel, ConfirmChannel, ConsumeMessage, ChannelModel } from "amqplib";

export type { ConsumeMessage };

/**
 * Configuration for connecting to a RabbitMQ broker.
 */
export interface ConnectionConfig {
    /** Protocol to use (default: "amqp") */
    readonly protocol?: string;
    /** Hostname of the RabbitMQ server */
    readonly hostname: string;
    /** Port number (default: 5672) */
    readonly port?: number;
    /** Username for authentication */
    readonly username?: string;
    /** Password for authentication */
    readonly password?: string;
    /** Virtual host (default: "/") */
    readonly vhost?: string;
}

/**
 * Configuration for reconnection behavior.
 */
export interface ReconnectConfig {
    /** Initial delay in milliseconds before first retry (default: 1000) */
    readonly initialDelayMs?: number;
    /** Maximum delay in milliseconds between retries (default: 30000) */
    readonly maxDelayMs?: number;
    /** Multiplier for exponential backoff (default: 2) */
    readonly multiplier?: number;
    /** Maximum number of retries, -1 for infinite (default: -1) */
    readonly maxRetries?: number;
}

/**
 * Options for creating a resilient connection.
 */
export interface ResilientConnectionOptions {
    /** Connection configuration */
    readonly connection: ConnectionConfig;
    /** Reconnection behavior configuration */
    readonly reconnect?: ReconnectConfig;
    /** Callback when connection is established */
    readonly onConnect?: () => void;
    /** Callback when connection is lost */
    readonly onDisconnect?: (error?: Error) => void;
    /** Callback when reconnection attempt starts */
    readonly onReconnecting?: (attempt: number) => void;
}

/**
 * Options for creating a publisher.
 */
export interface PublisherOptions {
    /** Exchange name to publish to */
    readonly exchange: string;
    /** Exchange type (default: "topic") */
    readonly exchangeType?: "direct" | "topic" | "fanout" | "headers";
    /** Whether exchange is durable (default: true) */
    readonly durable?: boolean;
    /** Message delivery mode: 1=non-persistent, 2=persistent (default: 2) */
    readonly deliveryMode?: 1 | 2;
    /** Content type for messages (default: "application/json") */
    readonly contentType?: string;
}

/**
 * Options for creating a consumer.
 */
export interface ConsumerOptions {
    /** Queue name to consume from */
    readonly queue: string;
    /** Exchange to bind the queue to (optional) */
    readonly exchange?: string;
    /** Routing key pattern for binding (default: "#") */
    readonly routingKey?: string;
    /** Whether queue is durable (default: true) */
    readonly durable?: boolean;
    /** Prefetch count (default: 10) */
    readonly prefetch?: number;
    /** Message handler function */
    readonly onMessage: MessageHandler;
    /** Error handler function */
    readonly onError?: (error: Error, msg?: ConsumeMessage) => void;
}

/**
 * Handler function for processing consumed messages.
 * @param msg - The consumed message
 * @returns Promise that resolves when message is processed, or rejects to nack
 */
export type MessageHandler = (msg: ConsumeMessage) => Promise<void>;

/**
 * Current state of a connection.
 */
export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

/**
 * Metrics collected by the library.
 */
export interface Metrics {
    /** Current connection state */
    readonly connectionState: ConnectionState;
    /** Number of successful connection attempts */
    readonly connectionsEstablished: number;
    /** Number of connection losses */
    readonly connectionsLost: number;
    /** Number of messages published successfully */
    readonly messagesPublished: number;
    /** Number of messages that failed to publish */
    readonly messagesPublishFailed: number;
    /** Number of messages consumed successfully */
    readonly messagesConsumed: number;
    /** Number of messages that failed processing */
    readonly messagesConsumeFailed: number;
    /** Timestamp of last successful publish */
    readonly lastPublishAt: Date | null;
    /** Timestamp of last successful consume */
    readonly lastConsumeAt: Date | null;
    /** Current reconnection attempt (0 if not reconnecting) */
    readonly reconnectAttempt: number;
}

/**
 * Unsubscribe function returned by event subscriptions.
 */
export type Unsubscribe = () => void;

/**
 * A resilient connection to RabbitMQ.
 */
export interface ResilientConnection {
    /** Get the underlying amqplib connection (may be null if disconnected) */
    readonly getConnection: () => ChannelModel | null;
    /** Check if currently connected */
    readonly isConnected: () => boolean;
    /** Get current connection state */
    readonly getState: () => ConnectionState;
    /** Create a regular channel */
    readonly createChannel: () => Promise<Channel | null>;
    /** Create a confirm channel for publisher confirms */
    readonly createConfirmChannel: () => Promise<ConfirmChannel | null>;
    /** Close the connection gracefully */
    readonly close: () => Promise<void>;
    /** Get current metrics */
    readonly getMetrics: () => Metrics;
    /** Subscribe to reconnection events. Returns unsubscribe function. */
    readonly onReconnect: (callback: () => void) => Unsubscribe;
}

/**
 * A publisher for sending messages to an exchange.
 */
export interface Publisher {
    /**
     * Publish a message to the exchange.
     * @param routingKey - Routing key for the message
     * @param content - Message content (will be JSON stringified if object)
     * @returns Promise that resolves when message is confirmed
     */
    readonly publish: (routingKey: string, content: unknown) => Promise<void>;
    /** Check if publisher is ready */
    readonly isReady: () => boolean;
    /** Close the publisher */
    readonly close: () => Promise<void>;
    /** Get publisher metrics */
    readonly getMetrics: () => Pick<Metrics, "messagesPublished" | "messagesPublishFailed" | "lastPublishAt">;
}

/**
 * A consumer for receiving messages from a queue.
 */
export interface Consumer {
    /** Start consuming messages */
    readonly start: () => Promise<void>;
    /** Stop consuming messages */
    readonly stop: () => Promise<void>;
    /** Close the consumer and clean up resources */
    readonly close: () => Promise<void>;
    /** Check if consumer is active */
    readonly isActive: () => boolean;
    /** Get consumer metrics */
    readonly getMetrics: () => Pick<Metrics, "messagesConsumed" | "messagesConsumeFailed" | "lastConsumeAt">;
}

/**
 * Logger interface used by the library.
 */
export interface Logger {
    /** Log info message */
    readonly info: (...args: unknown[]) => void;
    /** Log warning message */
    readonly warn: (...args: unknown[]) => void;
    /** Log error message */
    readonly error: (...args: unknown[]) => void;
}

/**
 * Options for creating a bridge between two brokers.
 */
export interface BridgeOptions {
    /** Source connection to consume from */
    readonly source: ResilientConnection;
    /** Target connection to publish to */
    readonly target: ResilientConnection;
    /** List of exchanges to bridge */
    readonly exchanges: readonly string[];
    /** Prefetch count for consumer (default: 50) */
    readonly prefetch?: number;
    /** Queue name prefix (default: "bridge_") */
    readonly queuePrefix?: string;
    /** Message delivery mode: 1=non-persistent, 2=persistent (default: 2) */
    readonly deliveryMode?: 1 | 2;
    /** Log stats every N messages (default: 100, 0 to disable) */
    readonly logEveryNMessages?: number;
    /** Callback when bridge starts forwarding */
    readonly onStart?: () => void;
    /** Callback when bridge stops */
    readonly onStop?: () => void;
}

/**
 * Metrics specific to bridge operations.
 */
export interface BridgeMetrics {
    /** Number of messages successfully forwarded */
    readonly messagesForwarded: number;
    /** Number of messages that failed to forward */
    readonly messagesFailed: number;
    /** Timestamp of last forwarded message */
    readonly lastMessageAt: Date | null;
}

/**
 * Current state of a bridge.
 */
export interface BridgeState {
    /** Whether source connection is connected */
    readonly sourceConnected: boolean;
    /** Whether target connection is connected */
    readonly targetConnected: boolean;
    /** Whether bridge is actively forwarding */
    readonly isRunning: boolean;
    /** Bridge metrics */
    readonly metrics: BridgeMetrics;
}

/**
 * A bridge for forwarding messages between two RabbitMQ brokers.
 */
export interface Bridge {
    /** Start the bridge */
    readonly start: () => Promise<boolean>;
    /** Stop the bridge */
    readonly stop: () => Promise<void>;
    /** Close the bridge and clean up all resources */
    readonly close: () => Promise<void>;
    /** Check if bridge is running */
    readonly isRunning: () => boolean;
    /** Get bridge metrics */
    readonly getMetrics: () => BridgeMetrics;
    /** Get full bridge state */
    readonly getState: () => BridgeState;
}
