# Burrow

A resilient RabbitMQ client for Deno and Node.js with auto-reconnect, retries, and metrics.

## Features

- **Resilient connections** - Automatic reconnection with exponential backoff
- **Publisher confirms** - Guaranteed message delivery with confirm channels
- **Consumer recovery** - Auto-resume consumption after reconnect
- **Metrics export** - Track messages sent/received/failed, connection state
- **Dual runtime** - Works in both Deno and Node.js
- **Functional API** - Factory functions, no classes
- **TypeScript** - Full type safety with JSDoc documentation

## Installation

### Deno (JSR)

```bash
deno add @sourcya/burrow
```

### Node.js (JSR)

```bash
npx jsr add @sourcya/burrow
```

## Usage

### Creating a Connection

```typescript
import { createConnection } from "@sourcya/burrow";

const conn = await createConnection({
  connection: {
    hostname: "localhost",
    port: 5672,
    username: "guest",
    password: "guest",
  },
  reconnect: {
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    multiplier: 2,
  },
  onConnect: () => console.log("Connected!"),
  onDisconnect: (err) => console.log("Disconnected:", err?.message),
  onReconnecting: (attempt) => console.log(`Reconnecting (attempt ${attempt})...`),
});
```

### Publishing Messages

```typescript
import { createPublisher } from "@sourcya/burrow";

const publisher = await createPublisher(conn, {
  exchange: "events",
  exchangeType: "topic",
  deliveryMode: 2, // persistent
});

await publisher.publish("user.created", { id: 1, name: "John" });
await publisher.publish("user.updated", { id: 1, name: "Jane" });

// Get metrics
console.log(publisher.getMetrics());
// { messagesPublished: 2, messagesPublishFailed: 0, lastPublishAt: Date }
```

### Consuming Messages

```typescript
import { createConsumer } from "@sourcya/burrow";

const consumer = await createConsumer(conn, {
  queue: "my-queue",
  exchange: "events",
  routingKey: "user.*",
  prefetch: 10,
  onMessage: async (msg) => {
    const data = JSON.parse(msg.content.toString());
    console.log("Received:", data);
    // Message is auto-acked on success
  },
  onError: (err, msg) => {
    console.error("Failed to process:", err.message);
    // Message is nacked and requeued once
  },
});

await consumer.start();

// Later...
await consumer.stop();
```

### Creating a Bridge

```typescript
import { createConnection, createBridge } from "@sourcya/burrow";

const source = await createConnection({
  connection: { hostname: "broker1.example.com", port: 5672 },
});

const target = await createConnection({
  connection: { hostname: "broker2.example.com", port: 5672 },
});

const bridge = createBridge({
  source,
  target,
  exchanges: ["events", "notifications"],
  prefetch: 50,
  deliveryMode: 2,
  logEveryNMessages: 100,
});

await bridge.start();

// Get bridge state
console.log(bridge.getState());
// { sourceConnected: true, targetConnected: true, isRunning: true, metrics: {...} }

// Get metrics
console.log(bridge.getMetrics());
// { messagesForwarded: 100, messagesFailed: 0, lastMessageAt: Date }

// Stop the bridge
await bridge.stop();
```

### Connection Metrics

```typescript
const metrics = conn.getMetrics();
console.log(metrics);
// {
//   connectionState: "connected",
//   connectionsEstablished: 1,
//   connectionsLost: 0,
//   messagesPublished: 100,
//   messagesPublishFailed: 0,
//   messagesConsumed: 50,
//   messagesConsumeFailed: 2,
//   lastPublishAt: Date,
//   lastConsumeAt: Date,
//   reconnectAttempt: 0,
// }
```

### Using the Logger

```typescript
import { createLogger, logger } from "@sourcya/burrow";

// Use the default logger
logger.info("Hello, world!");
// [2024-01-01T12:00:00.000Z] Hello, world!

// Or create your own
const log = createLogger();
log.warn("Something happened");
log.error("An error occurred", error);
```

## API Reference

### `createConnection(options)`

Creates a resilient connection to RabbitMQ.

**Options:**
- `connection.hostname` - RabbitMQ server hostname
- `connection.port` - Port (default: 5672)
- `connection.username` - Username (default: "guest")
- `connection.password` - Password (default: "guest")
- `connection.vhost` - Virtual host (default: "/")
- `reconnect.initialDelayMs` - Initial retry delay (default: 1000)
- `reconnect.maxDelayMs` - Maximum retry delay (default: 30000)
- `reconnect.multiplier` - Backoff multiplier (default: 2)
- `reconnect.maxRetries` - Max retries, -1 for infinite (default: -1)
- `onConnect` - Callback when connected
- `onDisconnect` - Callback when disconnected
- `onReconnecting` - Callback when reconnecting

### `createPublisher(connection, options)`

Creates a publisher for sending messages.

**Options:**
- `exchange` - Exchange name (required)
- `exchangeType` - Exchange type (default: "topic")
- `durable` - Durable exchange (default: true)
- `deliveryMode` - 1=non-persistent, 2=persistent (default: 2)
- `contentType` - Content type (default: "application/json")

### `createConsumer(connection, options)`

Creates a consumer for receiving messages.

**Options:**
- `queue` - Queue name (required)
- `exchange` - Exchange to bind to (optional)
- `routingKey` - Routing key pattern (default: "#")
- `durable` - Durable queue (default: true)
- `prefetch` - Prefetch count (default: 10)
- `onMessage` - Message handler (required)
- `onError` - Error handler (optional)

### `createBridge(options)`

Creates a bridge for forwarding messages between two brokers.

**Options:**
- `source` - Source connection (required)
- `target` - Target connection (required)
- `exchanges` - List of exchanges to bridge (required)
- `prefetch` - Prefetch count (default: 50)
- `queuePrefix` - Queue name prefix (default: "bridge_")
- `deliveryMode` - 1=non-persistent, 2=persistent (default: 2)
- `logEveryNMessages` - Log stats interval (default: 100, 0 to disable)
- `onStart` - Callback when bridge starts
- `onStop` - Callback when bridge stops

## License

MIT
