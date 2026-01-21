/**
 * Burrow - A resilient RabbitMQ client with auto-reconnect, retries, and metrics.
 *
 * @module
 * @example
 * ```typescript
 * import { createConnection, createPublisher, createConsumer, createBridge } from "@sourcya/burrow";
 *
 * // Create a resilient connection
 * const conn = await createConnection({
 *   connection: { hostname: "localhost", port: 5672 },
 *   onConnect: () => console.log("Connected!"),
 *   onDisconnect: () => console.log("Disconnected!"),
 * });
 *
 * // Create a publisher
 * const publisher = await createPublisher(conn, { exchange: "events" });
 * await publisher.publish("user.created", { id: 1, name: "John" });
 *
 * // Create a consumer
 * const consumer = await createConsumer(conn, {
 *   queue: "my-queue",
 *   exchange: "events",
 *   onMessage: async (msg) => {
 *     console.log("Received:", JSON.parse(msg.content.toString()));
 *   },
 * });
 * await consumer.start();
 *
 * // Create a bridge between two brokers
 * const source = await createConnection({ connection: { hostname: "broker1" } });
 * const target = await createConnection({ connection: { hostname: "broker2" } });
 * const bridge = createBridge({
 *   source,
 *   target,
 *   exchanges: ["events", "notifications"],
 * });
 * await bridge.start();
 *
 * // Get metrics
 * console.log(conn.getMetrics());
 * console.log(bridge.getState());
 * ```
 */

// Types
export type {
    ConnectionConfig,
    ReconnectConfig,
    ResilientConnectionOptions,
    PublisherOptions,
    ConsumerOptions,
    MessageHandler,
    ConnectionState,
    Metrics,
    ResilientConnection,
    Publisher,
    Consumer,
    Logger,
    BridgeOptions,
    BridgeMetrics,
    BridgeState,
    Bridge,
} from "./src/types.ts";

// Logger
export { createLogger, logger } from "./src/logger.ts";

// Metrics
export { createMetricsCollector } from "./src/metrics.ts";
export type { MetricsCollector } from "./src/metrics.ts";

// Connection
export { createConnection } from "./src/connection.ts";

// Publisher
export { createPublisher } from "./src/publisher.ts";

// Consumer
export { createConsumer } from "./src/consumer.ts";

// Bridge
export { createBridge } from "./src/bridge.ts";
