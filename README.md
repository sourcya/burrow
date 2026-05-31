# Burrow

A resilient RabbitMQ client for Deno and Node.js with auto-reconnect, retries, and metrics.

[![JSR](https://jsr.io/badges/@sourcya/burrow)](https://jsr.io/@sourcya/burrow)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Install

```bash
# Deno
deno add jsr:@sourcya/burrow

# Node.js
npx jsr add @sourcya/burrow
```

## Quick Start

```typescript
import { createConnection, createPublisher, createConsumer } from "@sourcya/burrow";

const conn = await createConnection({
  connection: { hostname: "localhost", port: 5672 },
  onConnect: () => console.log("Connected!"),
  onDisconnect: (err) => console.log("Disconnected:", err?.message),
});

const publisher = await createPublisher(conn, { exchange: "events" });
await publisher.publish("user.created", { id: 1, name: "Alice" });

const consumer = await createConsumer(conn, {
  queue: "my-queue",
  exchange: "events",
  routingKey: "user.*",
  onMessage: async (msg) => {
    console.log("Received:", JSON.parse(msg.content.toString()));
  },
});
await consumer.start();
```

All components automatically recover after a connection drop — publishers re-create their channels, consumers resume where they left off, and bridges restart once both ends reconnect.

## Publishing

```typescript
const publisher = await createPublisher(conn, {
  exchange: "events",
  exchangeType: "topic",   // "direct" | "topic" | "fanout" | "headers"
  deliveryMode: 2,         // 1 = non-persistent, 2 = persistent
});

await publisher.publish("order.placed", { orderId: 42 });
```

## Consuming

```typescript
const consumer = await createConsumer(conn, {
  queue: "orders",
  exchange: "events",
  exchangeType: "topic",
  routingKey: "order.*",
  prefetch: 10,
  onMessage: async (msg) => {
    const data = JSON.parse(msg.content.toString());
    console.log("Processing order:", data.orderId);
    // auto-acked on success, nacked and requeued once on error
  },
  onError: (err, msg) => {
    console.error("Failed:", err.message);
  },
});

await consumer.start();
await consumer.stop();
```

### Manual Ack

When you need full control over acknowledgment (e.g., routing to a dead-letter exchange):

```typescript
const consumer = await createConsumer(conn, {
  queue: "commands",
  exchange: "commands.exchange",
  exchangeType: "direct",
  routingKey: "command.dispatch",
  manualAck: true,
  onMessage: async () => {},
  onManualMessage: async (msg, channel) => {
    const payload = JSON.parse(msg.content.toString());

    if (!payload.ready) {
      channel.nack(msg, false, false); // send to DLX
      return;
    }

    await processCommand(payload);
    channel.ack(msg);
  },
});
```

### Queue Options

Configure dead-letter exchanges, TTL, max length, and more:

```typescript
const consumer = await createConsumer(conn, {
  queue: "parking-queue",
  exchange: "parking.exchange",
  exchangeType: "direct",
  routingKey: "park",
  queueOptions: {
    deadLetterExchange: "main.exchange",
    deadLetterRoutingKey: "retry",
    messageTtl: 60_000,
    maxLength: 10_000,
  },
  onMessage: async (msg) => { /* ... */ },
});
```

## Bridge

Forward messages between two RabbitMQ brokers:

```typescript
import { createConnection, createBridge } from "@sourcya/burrow";

const source = await createConnection({ connection: { hostname: "broker1.example.com" } });
const target = await createConnection({ connection: { hostname: "broker2.example.com" } });

const bridge = createBridge({
  source,
  target,
  exchanges: ["events", "notifications"],
  prefetch: 50,
  deliveryMode: 2,
});

await bridge.start();

console.log(bridge.getState());
// { sourceConnected: true, targetConnected: true, isRunning: true, metrics: { ... } }
```

## Auto-Reconnect

Connection drops are handled transparently. Configure the backoff strategy:

```typescript
const conn = await createConnection({
  connection: { hostname: "localhost" },
  reconnect: {
    initialDelayMs: 1000,
    maxDelayMs: 30_000,
    multiplier: 2,
    maxRetries: -1, // infinite
  },
  onReconnecting: (attempt) => console.log(`Attempt ${attempt}...`),
});
```

Subscribe to reconnection events for custom recovery logic:

```typescript
const unsubscribe = conn.onReconnect(() => {
  console.log("Connection restored!");
});
```

## Metrics

Every component exposes metrics:

```typescript
// Connection metrics
conn.getMetrics();
// { connectionState, connectionsEstablished, connectionsLost,
//   messagesPublished, messagesPublishFailed, messagesConsumed,
//   messagesConsumeFailed, lastPublishAt, lastConsumeAt, reconnectAttempt }

// Publisher metrics
publisher.getMetrics();
// { messagesPublished, messagesPublishFailed, lastPublishAt }

// Consumer metrics
consumer.getMetrics();
// { messagesConsumed, messagesConsumeFailed, lastConsumeAt }

// Bridge metrics
bridge.getMetrics();
// { messagesForwarded, messagesFailed, lastMessageAt }
```

## License

MIT
