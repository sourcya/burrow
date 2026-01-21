/**
 * Bridge Example
 *
 * This example demonstrates how to create a message bridge that forwards
 * messages from one RabbitMQ broker to another using createBridge.
 *
 * The bridge automatically restarts when both source and target connections
 * are restored after a disconnect.
 *
 * Run with: deno run --allow-net --allow-env examples/bridge.ts
 */

import { createConnection, createBridge } from "../mod.ts";

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

const EXCHANGES = (Deno.env.get("EXCHANGES") || "events,notifications").split(",");

async function main() {
    console.log("Creating source connection...");

    const source = await createConnection({
        connection: SOURCE_BROKER,
        reconnect: { initialDelayMs: 1000, maxDelayMs: 30000, multiplier: 2 },
        onConnect: () => console.log("[source] Connected"),
        onDisconnect: () => console.log("[source] Disconnected"),
        onReconnecting: (attempt) => console.log(`[source] Reconnecting (attempt ${attempt})...`),
    });

    console.log("Creating target connection...");

    const target = await createConnection({
        connection: TARGET_BROKER,
        reconnect: { initialDelayMs: 1000, maxDelayMs: 30000, multiplier: 2 },
        onConnect: () => console.log("[target] Connected"),
        onDisconnect: () => console.log("[target] Disconnected"),
        onReconnecting: (attempt) => console.log(`[target] Reconnecting (attempt ${attempt})...`),
    });

    console.log("Creating bridge...");

    const bridge = createBridge({
        source,
        target,
        exchanges: EXCHANGES,
        prefetch: 50,
        deliveryMode: 2,
        logEveryNMessages: 100,
        onStart: () => console.log("[bridge] Started forwarding"),
        onStop: () => console.log("[bridge] Stopped"),
    });

    await bridge.start();

    console.log("\n=== Bridge Configuration ===");
    console.log(`Source: ${SOURCE_BROKER.hostname}:${SOURCE_BROKER.port}`);
    console.log(`Target: ${TARGET_BROKER.hostname}:${TARGET_BROKER.port}`);
    console.log(`Exchanges: ${EXCHANGES.join(", ")}`);
    console.log("============================\n");

    const metricsInterval = setInterval(() => {
        const state = bridge.getState();
        console.log(`[metrics] forwarded=${state.metrics.messagesForwarded}, failed=${state.metrics.messagesFailed}, source=${state.sourceConnected}, target=${state.targetConnected}`);
    }, 10000);

    Deno.addSignalListener("SIGINT", async () => {
        console.log("\nShutting down bridge...");
        clearInterval(metricsInterval);
        const metrics = bridge.getMetrics();
        await bridge.close();
        await source.close();
        await target.close();
        console.log(`Final stats: forwarded=${metrics.messagesForwarded}, failed=${metrics.messagesFailed}`);
        console.log("Goodbye!");
        Deno.exit(0);
    });

    console.log("Bridge running. Press Ctrl+C to stop.");
}

main().catch(console.error);
