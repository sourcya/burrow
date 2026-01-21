/**
 * Consumer Example
 *
 * This example demonstrates how to create a resilient RabbitMQ consumer
 * that receives messages from a queue with automatic recovery.
 *
 * The consumer automatically resumes consuming when the connection is
 * restored after a disconnect, if it was previously active.
 *
 * Run with: deno run --allow-net --allow-env examples/consumer.ts
 */

import { createConnection, createConsumer } from "../mod.ts";

const RABBITMQ_URL = {
    hostname: Deno.env.get("RABBITMQ_HOST") || "localhost",
    port: parseInt(Deno.env.get("RABBITMQ_PORT") || "5672"),
    username: Deno.env.get("RABBITMQ_USER") || "guest",
    password: Deno.env.get("RABBITMQ_PASS") || "guest",
};

const EXCHANGE = Deno.env.get("EXCHANGE") || "events";
const QUEUE = Deno.env.get("QUEUE") || "my-queue";
const ROUTING_KEY = Deno.env.get("ROUTING_KEY") || "#";

async function main() {
    console.log("Creating connection...");

    const connection = await createConnection({
        connection: RABBITMQ_URL,
        reconnect: {
            initialDelayMs: 1000,
            maxDelayMs: 30000,
            multiplier: 2,
        },
        onConnect: () => console.log("Connected to RabbitMQ"),
        onDisconnect: () => console.log("Disconnected from RabbitMQ"),
        onReconnecting: (attempt) => console.log(`Reconnecting (attempt ${attempt})...`),
    });

    console.log("Creating consumer...");

    const consumer = await createConsumer(connection, {
        queue: QUEUE,
        exchange: EXCHANGE,
        routingKey: ROUTING_KEY,
        durable: true,
        prefetch: 10,
        onMessage: async (msg) => {
            const content = msg.content.toString();
            const routingKey = msg.fields.routingKey;

            try {
                const data = JSON.parse(content);
                console.log(`Received [${routingKey}]:`, data);
            } catch {
                console.log(`Received [${routingKey}]:`, content);
            }

            const metrics = consumer.getMetrics();
            console.log(`Metrics: consumed=${metrics.messagesConsumed}, failed=${metrics.messagesConsumeFailed}`);
            await Promise.resolve();
        },
        onError: (error, msg) => {
            console.error(`Error processing message:`, error.message);
            if (msg) {
                console.error(`  Routing key: ${msg.fields.routingKey}`);
            }
        },
    });

    await consumer.start();
    console.log(`Consumer started on queue: ${QUEUE}`);
    console.log(`Bound to exchange: ${EXCHANGE} with routing key: ${ROUTING_KEY}`);

    Deno.addSignalListener("SIGINT", async () => {
        console.log("\nShutting down...");
        await consumer.close();
        await connection.close();
        console.log("Goodbye!");
        Deno.exit(0);
    });

    console.log("Waiting for messages. Press Ctrl+C to stop.");
}

main().catch(console.error);
