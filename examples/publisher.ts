/**
 * Publisher Example
 *
 * This example demonstrates how to create a resilient RabbitMQ publisher
 * that sends messages to an exchange with publisher confirms.
 *
 * Run with: deno run --allow-net --allow-env examples/publisher.ts
 */

import { createConnection, createPublisher } from "../mod.ts";

const RABBITMQ_URL = {
    hostname: Deno.env.get("RABBITMQ_HOST") || "localhost",
    port: parseInt(Deno.env.get("RABBITMQ_PORT") || "5672"),
    username: Deno.env.get("RABBITMQ_USER") || "guest",
    password: Deno.env.get("RABBITMQ_PASS") || "guest",
};

const EXCHANGE = Deno.env.get("EXCHANGE") || "events";

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

    console.log("Creating publisher...");

    const publisher = await createPublisher(connection, {
        exchange: EXCHANGE,
        exchangeType: "topic",
        durable: true,
        deliveryMode: 2,
    });

    console.log(`Publisher ready on exchange: ${EXCHANGE}`);

    let messageCount = 0;

    const interval = setInterval(async () => {
        messageCount++;
        const routingKey = "user.created";
        const message = {
            id: messageCount,
            name: `User ${messageCount}`,
            createdAt: new Date().toISOString(),
        };

        try {
            await publisher.publish(routingKey, message);
            console.log(`Published message ${messageCount}: ${routingKey}`);
        } catch (error) {
            console.error(`Failed to publish message ${messageCount}:`, error);
        }

        const metrics = publisher.getMetrics();
        console.log(`Metrics: published=${metrics.messagesPublished}, failed=${metrics.messagesPublishFailed}`);
    }, 2000);

    Deno.addSignalListener("SIGINT", async () => {
        console.log("\nShutting down...");
        clearInterval(interval);
        await publisher.close();
        await connection.close();
        console.log("Goodbye!");
        Deno.exit(0);
    });

    console.log("Publishing messages every 2 seconds. Press Ctrl+C to stop.");
}

main().catch(console.error);
