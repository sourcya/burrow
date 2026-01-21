import { assertEquals } from "@std/assert";
import { createMetricsCollector } from "../src/metrics.ts";

Deno.test("createMetricsCollector - returns initial state", () => {
    const metrics = createMetricsCollector();
    const state = metrics.getMetrics();
    
    assertEquals(state.connectionState, "disconnected");
    assertEquals(state.connectionsEstablished, 0);
    assertEquals(state.connectionsLost, 0);
    assertEquals(state.messagesPublished, 0);
    assertEquals(state.messagesPublishFailed, 0);
    assertEquals(state.messagesConsumed, 0);
    assertEquals(state.messagesConsumeFailed, 0);
    assertEquals(state.lastPublishAt, null);
    assertEquals(state.lastConsumeAt, null);
    assertEquals(state.reconnectAttempt, 0);
});

Deno.test("createMetricsCollector - recordConnect updates state", () => {
    const metrics = createMetricsCollector();
    
    metrics.recordConnect();
    const state = metrics.getMetrics();
    
    assertEquals(state.connectionState, "connected");
    assertEquals(state.connectionsEstablished, 1);
    assertEquals(state.reconnectAttempt, 0);
});

Deno.test("createMetricsCollector - recordDisconnect updates state", () => {
    const metrics = createMetricsCollector();
    
    metrics.recordConnect();
    metrics.recordDisconnect();
    const state = metrics.getMetrics();
    
    assertEquals(state.connectionState, "disconnected");
    assertEquals(state.connectionsLost, 1);
});

Deno.test("createMetricsCollector - recordPublish updates state", () => {
    const metrics = createMetricsCollector();
    
    metrics.recordPublish();
    const state = metrics.getMetrics();
    
    assertEquals(state.messagesPublished, 1);
    assertEquals(state.lastPublishAt instanceof Date, true);
});

Deno.test("createMetricsCollector - recordPublishFailed updates state", () => {
    const metrics = createMetricsCollector();
    
    metrics.recordPublishFailed();
    const state = metrics.getMetrics();
    
    assertEquals(state.messagesPublishFailed, 1);
});

Deno.test("createMetricsCollector - recordConsume updates state", () => {
    const metrics = createMetricsCollector();
    
    metrics.recordConsume();
    const state = metrics.getMetrics();
    
    assertEquals(state.messagesConsumed, 1);
    assertEquals(state.lastConsumeAt instanceof Date, true);
});

Deno.test("createMetricsCollector - recordConsumeFailed updates state", () => {
    const metrics = createMetricsCollector();
    
    metrics.recordConsumeFailed();
    const state = metrics.getMetrics();
    
    assertEquals(state.messagesConsumeFailed, 1);
});

Deno.test("createMetricsCollector - setConnectionState updates state", () => {
    const metrics = createMetricsCollector();
    
    metrics.setConnectionState("connecting");
    assertEquals(metrics.getMetrics().connectionState, "connecting");
    
    metrics.setConnectionState("reconnecting");
    assertEquals(metrics.getMetrics().connectionState, "reconnecting");
});

Deno.test("createMetricsCollector - setReconnectAttempt updates state", () => {
    const metrics = createMetricsCollector();
    
    metrics.setReconnectAttempt(5);
    assertEquals(metrics.getMetrics().reconnectAttempt, 5);
});

Deno.test("createMetricsCollector - reset clears all state", () => {
    const metrics = createMetricsCollector();
    
    metrics.recordConnect();
    metrics.recordPublish();
    metrics.recordConsume();
    metrics.setReconnectAttempt(3);
    
    metrics.reset();
    const state = metrics.getMetrics();
    
    assertEquals(state.connectionState, "disconnected");
    assertEquals(state.connectionsEstablished, 0);
    assertEquals(state.messagesPublished, 0);
    assertEquals(state.messagesConsumed, 0);
    assertEquals(state.reconnectAttempt, 0);
});

Deno.test("createMetricsCollector - getMetrics returns immutable snapshot", () => {
    const metrics = createMetricsCollector();
    
    const snapshot1 = metrics.getMetrics();
    metrics.recordPublish();
    const snapshot2 = metrics.getMetrics();
    
    assertEquals(snapshot1.messagesPublished, 0);
    assertEquals(snapshot2.messagesPublished, 1);
});

Deno.test("createMetricsCollector - multiple operations accumulate", () => {
    const metrics = createMetricsCollector();
    
    metrics.recordConnect();
    metrics.recordDisconnect();
    metrics.recordConnect();
    
    metrics.recordPublish();
    metrics.recordPublish();
    metrics.recordPublish();
    metrics.recordPublishFailed();
    
    metrics.recordConsume();
    metrics.recordConsume();
    metrics.recordConsumeFailed();
    metrics.recordConsumeFailed();
    
    const state = metrics.getMetrics();
    
    assertEquals(state.connectionsEstablished, 2);
    assertEquals(state.connectionsLost, 1);
    assertEquals(state.messagesPublished, 3);
    assertEquals(state.messagesPublishFailed, 1);
    assertEquals(state.messagesConsumed, 2);
    assertEquals(state.messagesConsumeFailed, 2);
});
