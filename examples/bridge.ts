/**
 * Bridge Example
 *
 * This example demonstrates how to create a message bridge that consumes
 * messages from one RabbitMQ broker and publishes them to another.
 *
 * Run with: deno run --allow-net --allow-env examples/bridge.ts
 */

import { createConnection, createConsumer, createPublisher } from "../mod.ts";

const SOURCE_BROKER = {
    hostname: Deno.env.get("SOURCE_HOST") || "localhost",
    port: parseInt(Deno.env.get("SOURCE_PORT") || "5672"),
    username: Deno.env.get("SOURCE_USER") || "guest",
    password: Deno.env.get("SOURCE_PASS") || "guest",
};

const TARGET_BROKER = {
    hostname: Deno.env.get("TARGET_HOST") || "localhost",
    port: parseInt(Deno.env.get("TARGET_PORT") || "5673"),
    username: Deno.env.get("TARGET_USER") || "guest",
    password: Deno.env.get("TARGET_PASS") || "guest",
};

const EXCHANGE = Deno.env.get("EXCHANGE") || "events";
const QUEUE = Deno.env.get("QUEUE") || "bridge-queue";
const ROUTING_KEY = Deno.env.get("ROUTING_KEY") || "#";

async function main() {
    console.log("Creating source connection...");

    const sourceConnection = await createConnection({
        connection: SOURCE_BROKER,
        reconnect: {
            initialDelayMs: 1000,
            maxDelayMs: 30000,
            multiplier: 2,
        },
        onConnect: () => console.log("[source] Connected"),
        onDisconnect: () => console.log("[source] Disconnected"),
        onReconnecting: (attempt) => console.log(`[source] Reconnecting (attempt ${attempt})...`),
    });

    console.log("Creating target connection...");

    const targetConnection = await createConnection({
        connection: TARGET_BROKER,
        reconnect: {
            initialDelayMs: 1000,
            maxDelayMs: 30000,
            multiplier: 2,
        },
        onConnect: () => console.log("[target] Connected"),
        onDisconnect: () => console.log("[target] Disconnected"),
        onReconnecting: (attempt) => console.log(`[target] Reconnecting (attempt ${attempt})...`),
    });

    console.log("Creating publisher on target...");

    const publisher = await createPublisher(targetConnection, {
        exchange: EXCHANGE,
        exchangeType: "topic",
        durable: true,
        deliveryMode: 2,
    });

    console.log("Creating consumer on source...");

    let forwarded = 0;
    let failed = 0;

    const consumer = await createConsumer(sourceConnection, {
        queue: QUEUE,
        exchange: EXCHANGE,
        routingKey: ROUTING_KEY,
        durable: true,
        prefetch: 50,
        onMessage: async (msg) => {
            const routingKey = msg.fields.routingKey;
            const content = msg.content;

            try {
                await publisher.publish(routingKey, content.toString());
                forwarded++;
                console.log(`Forwarded [${routingKey}] (${forwarded} total)`);
            } catch (error) {
                failed++;
                console.error(`Failed to forward [${routingKey}]:`, error);
                throw error;
            }
        },
        onError: (error, msg) => {
            console.error(`Error forwarding message:`, error.message);
            if (msg) {
                console.error(`  Routing key: ${msg.fields.routingKey}`);
            }
        },
    });

    await consumer.start();

    console.log("\n=== Bridge Configuration ===");
    console.log(`Source: ${SOURCE_BROKER.hostname}:${SOURCE_BROKER.port}`);
    console.log(`Target: ${TARGET_BROKER.hostname}:${TARGET_BROKER.port}`);
    console.log(`Exchange: ${EXCHANGE}`);
    console.log(`Queue: ${QUEUE}`);
    console.log(`Routing Key: ${ROUTING_KEY}`);
    console.log("============================\n");

    const metricsInterval = setInterval(() => {
        const sourceMetrics = sourceConnection.getMetrics();
        const targetMetrics = targetConnection.getMetrics();
        console.log(`[metrics] forwarded=${forwarded}, failed=${failed}, source=${sourceMetrics.connectionState}, target=${targetMetrics.connectionState}`);
    }, 10000);

    Deno.addSignalListener("SIGINT", async () => {
        console.log("\nShutting down bridge...");
        clearInterval(metricsInterval);
        await consumer.stop();
        await publisher.close();
        await sourceConnection.close();
        await targetConnection.close();
        console.log(`Final stats: forwarded=${forwarded}, failed=${failed}`);
        console.log("Goodbye!");
        Deno.exit(0);
    });

    console.log("Bridge running. Press Ctrl+C to stop.");
}

main().catch(console.error);
