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

### Auto-Reconnection

All components (Publisher, Consumer, Bridge) automatically recover when the connection is restored:

```typescript
// Publishers auto-recover their channel and exchange
const publisher = await createPublisher(conn, { exchange: "events" });
// If connection drops and reconnects, publisher automatically re-creates its channel

// Consumers auto-resume if they were active
const consumer = await createConsumer(conn, {
  queue: "my-queue",
  onMessage: async (msg) => console.log("Received:", msg.content.toString()),
});
await consumer.start();
// If connection drops and reconnects, consumer automatically resumes

// Bridge auto-restarts when both connections are restored
const bridge = createBridge({ source, target, exchanges: ["events"] });
await bridge.start();
// If either connection drops and both reconnect, bridge automatically restarts
```

You can also subscribe to reconnection events manually:

```typescript
const unsubscribe = conn.onReconnect(() => {
  console.log("Connection restored! Doing custom recovery...");
});

// Later, to stop listening:
unsubscribe();
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

**Methods:**
- `isConnected()` - Check if connected
- `getState()` - Get connection state
- `createChannel()` - Create a regular channel
- `createConfirmChannel()` - Create a confirm channel
- `getMetrics()` - Get connection metrics
- `onReconnect(callback)` - Subscribe to reconnection events, returns unsubscribe function
- `close()` - Close connection gracefully

### `createPublisher(connection, options)`

Creates a publisher for sending messages. Auto-recovers on reconnect.

**Options:**
- `exchange` - Exchange name (required)
- `exchangeType` - Exchange type (default: "topic")
- `durable` - Durable exchange (default: true)
- `deliveryMode` - 1=non-persistent, 2=persistent (default: 2)
- `contentType` - Content type (default: "application/json")

**Methods:**
- `publish(routingKey, content)` - Publish a message
- `isReady()` - Check if publisher is ready
- `getMetrics()` - Get publish metrics
- `close()` - Close the publisher

### `createConsumer(connection, options)`

Creates a consumer for receiving messages. Auto-resumes on reconnect if was active.

**Options:**
- `queue` - Queue name (required)
- `exchange` - Exchange to bind to (optional)
- `routingKey` - Routing key pattern (default: "#")
- `durable` - Durable queue (default: true)
- `prefetch` - Prefetch count (default: 10)
- `onMessage` - Message handler (required)
- `onError` - Error handler (optional)

**Methods:**
- `start()` - Start consuming
- `stop()` - Stop consuming
- `close()` - Close consumer and clean up
- `isActive()` - Check if consuming
- `getMetrics()` - Get consume metrics

### `createBridge(options)`

Creates a bridge for forwarding messages between two brokers. Auto-restarts on reconnect.

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

**Methods:**
- `start()` - Start forwarding
- `stop()` - Stop forwarding
- `close()` - Close bridge and clean up
- `isRunning()` - Check if running
- `getMetrics()` - Get bridge metrics
- `getState()` - Get full bridge state

## License

MIT
