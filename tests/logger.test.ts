import { assertEquals, assertMatch } from "@std/assert";
import { createLogger } from "../src/logger.ts";

Deno.test("createLogger - returns logger with info, warn, error methods", () => {
    const logger = createLogger();
    
    assertEquals(typeof logger.info, "function");
    assertEquals(typeof logger.warn, "function");
    assertEquals(typeof logger.error, "function");
});

Deno.test("createLogger - info logs with timestamp prefix", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    
    console.log = (...args: unknown[]) => {
        logs.push(args.join(" "));
    };
    
    try {
        const logger = createLogger();
        logger.info("test message");
        assertEquals(logs.length, 1);
        assertMatch(logs[0], /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\] test message$/);
    } finally {
        console.log = originalLog;
    }
});

Deno.test("createLogger - warn logs with timestamp prefix", () => {
    const logs: string[] = [];
    const originalWarn = console.warn;
    
    console.warn = (...args: unknown[]) => {
        logs.push(args.join(" "));
    };
    
    try {
        const logger = createLogger();
        logger.warn("warning message");
        assertEquals(logs.length, 1);
        assertMatch(logs[0], /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\] warning message$/);
    } finally {
        console.warn = originalWarn;
    }
});

Deno.test("createLogger - error logs with timestamp prefix", () => {
    const logs: string[] = [];
    const originalError = console.error;
    
    console.error = (...args: unknown[]) => {
        logs.push(args.join(" "));
    };
    
    try {
        const logger = createLogger();
        logger.error("error message");
        assertEquals(logs.length, 1);
        assertMatch(logs[0], /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\] error message$/);
    } finally {
        console.error = originalError;
    }
});

Deno.test("createLogger - handles multiple arguments", () => {
    const logs: unknown[][] = [];
    const originalLog = console.log;
    
    console.log = (...args: unknown[]) => {
        logs.push(args);
    };
    
    try {
        const logger = createLogger();
        logger.info("message", { key: "value" }, 123);
        assertEquals(logs.length, 1);
        assertEquals(logs[0].length, 4);
        assertMatch(logs[0][0] as string, /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\]$/);
        assertEquals(logs[0][1], "message");
        assertEquals(logs[0][2], { key: "value" });
        assertEquals(logs[0][3], 123);
    } finally {
        console.log = originalLog;
    }
});
