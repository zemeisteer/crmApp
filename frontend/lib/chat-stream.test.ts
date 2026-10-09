import { test } from "node:test";
import assert from "node:assert/strict";
import { SseParser, backoffDelay, connectChatStream, type ChatStreamStop, type SseEvent } from "./chat-stream.ts";

test("frames: event and data fields, multi-line data, comments, a default event name", () => {
  const p = new SseParser();
  const out = p.push("event: ready\ndata: {}\n\n: ping\n\nevent: message\ndata: {\"conversationId\":\"c1\",\ndata: \"seq\":3}\n\ndata:no space\n\n");
  assert.deepEqual(out, [
    { event: "ready", data: "{}" },
    { event: "message", data: "{\"conversationId\":\"c1\",\n\"seq\":3}" },
    { event: "message", data: "no space" },
  ]);
  assert.equal(p.comments, 1);
});

test("frames split anywhere across chunks, also between \\r and \\n", () => {
  const text = "event: message\r\ndata: {\"seq\":1}\r\n\r\n:ping\r\rdata: a\rdata: b\r\r";
  for (let cut = 1; cut < text.length; cut++) {
    const p = new SseParser();
    const out = [...p.push(text.slice(0, cut)), ...p.push(text.slice(cut))];
    assert.deepEqual(out, [{ event: "message", data: "{\"seq\":1}" }, { event: "message", data: "a\nb" }], `cut at ${cut}`);
    assert.equal(p.comments, 1);
  }
  // One character at a time.
  const p = new SseParser();
  const out: SseEvent[] = [];
  for (const ch of text) out.push(...p.push(ch));
  assert.equal(out.length, 2);
});

test("a frame without data is no event; an unfinished frame waits; a leading BOM and unknown fields are ignored", () => {
  const p = new SseParser();
  assert.deepEqual(p.push("﻿event: ready\n\nretry: 10\nfoo: bar\nid: 7\ndata: x"), []);
  assert.deepEqual(p.push("\n\n"), [{ event: "message", data: "x", id: "7" }]);
  // The event name does not leak into the next frame.
  assert.deepEqual(p.push("event: revoked\n\ndata: y\n\n"), [{ event: "message", data: "y", id: "7" }]);
});

test("reconnect pauses double up to a cap, with jitter", () => {
  const top = () => 1;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((a) => backoffDelay(a, 1000, 30_000, top)), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  assert.equal(backoffDelay(3, 1000, 30_000, () => 0), 4000);
  assert.equal(backoffDelay(1000, 1000, 30_000, top), 30000);
});

// ---- the connection ---------------------------------------------------------

interface Call {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  send: (text: string) => void;
  end: () => void;
}

/** A fake server: each fetch takes the next scripted answer (default: an open stream). */
function fakeServer() {
  const calls: Call[] = [];
  const script: Array<number | "network-error"> = [];
  const enc = new TextEncoder();
  const fetchImpl = (async (url: string, init: RequestInit) => {
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (c) => { ctl = c; } });
    const signal = init.signal as AbortSignal;
    const call: Call = {
      url, headers: init.headers as Record<string, string>, signal,
      send: (text) => ctl.enqueue(enc.encode(text)),
      end: () => ctl.close(),
    };
    calls.push(call);
    // As a browser does: aborting the request errors its body.
    signal.addEventListener("abort", () => {
      try { ctl.error(new DOMException("aborted", "AbortError")); } catch { /* closed */ }
    });
    const next = script.shift();
    if (next === "network-error") throw new TypeError("Failed to fetch");
    if (typeof next === "number") return new Response(`{"statusCode":${next}}`, { status: next, headers: { "content-type": "application/json" } });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
  return { calls, script, fetchImpl };
}

async function until(pred: () => boolean, what: string, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) assert.fail(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 2));
  }
}
const settle = () => new Promise((r) => setTimeout(r, 30));

test("connects with the token in the header (never the URL), passes ready and message events on", async () => {
  const srv = fakeServer();
  const events: SseEvent[] = [];
  const h = connectChatStream({ url: "http://api.test/api/chat/stream", getToken: () => "tok-123", onEvent: (e) => events.push(e), fetchImpl: srv.fetchImpl });
  await until(() => srv.calls.length === 1, "first request");
  const c = srv.calls[0];
  assert.equal(c.url, "http://api.test/api/chat/stream");
  assert.ok(!c.url.includes("tok-123"));
  assert.equal(c.headers.Authorization, "Bearer tok-123");
  c.send("event: ready\ndata: {}\n\n: ping\n\nevent: message\ndata: {\"conversationId\":\"c1\",\"seq\":4}\n\n");
  await until(() => events.length === 2, "two events");
  assert.deepEqual(events.map((e) => e.event), ["ready", "message"]);
  assert.deepEqual(JSON.parse(events[1].data), { conversationId: "c1", seq: 4 });
  h.close();
  assert.ok(c.signal.aborted, "closing aborts the request");
});

test("a dropped stream is opened again after a pause, with the current token; ready resets the pauses", async () => {
  const srv = fakeServer();
  let token = "first";
  const states: string[] = [];
  const events: string[] = [];
  const h = connectChatStream({
    url: "u", getToken: () => token, onEvent: (e) => events.push(e.event), onState: (s) => states.push(s),
    fetchImpl: srv.fetchImpl, baseDelayMs: 5, maxDelayMs: 50, random: () => 1,
  });
  await until(() => srv.calls.length === 1, "first");
  srv.calls[0].send("event: ready\ndata: {}\n\n");
  await until(() => events.length === 1, "ready");
  token = "second";
  srv.calls[0].end();
  await until(() => srv.calls.length === 2, "reconnect after the drop");
  assert.equal(srv.calls[1].headers.Authorization, "Bearer second");
  srv.calls[1].send("event: ready\ndata: {}\n\n");
  await until(() => events.length === 2, "ready again (the page catches up here)");
  assert.deepEqual(states.slice(0, 4), ["connecting", "open", "waiting", "connecting"]);
  h.close();
});

test("server errors and network failures are retried with growing pauses", async () => {
  const srv = fakeServer();
  srv.script.push(503, "network-error", 502);
  const started = Date.now();
  const h = connectChatStream({ url: "u", getToken: () => "t", onEvent: () => undefined, fetchImpl: srv.fetchImpl, baseDelayMs: 10, maxDelayMs: 1000, random: () => 1 });
  await until(() => srv.calls.length === 4, "three retries");
  // 10 + 20 + 40 ms of pauses at least.
  assert.ok(Date.now() - started >= 65, `pauses were too short: ${Date.now() - started} ms`);
  h.close();
});

test("revoked: stops for good and says so", async () => {
  const srv = fakeServer();
  const stops: ChatStreamStop[] = [];
  const events: string[] = [];
  connectChatStream({ url: "u", getToken: () => "t", onEvent: (e) => events.push(e.event), onStop: (r) => stops.push(r), fetchImpl: srv.fetchImpl, baseDelayMs: 1 });
  await until(() => srv.calls.length === 1, "first");
  srv.calls[0].send("event: ready\ndata: {}\n\nevent: revoked\ndata: {}\n\nevent: message\ndata: {}\n\n");
  await until(() => stops.length === 1, "stop");
  assert.deepEqual(stops, ["revoked"]);
  assert.deepEqual(events, ["ready"], "nothing after revoked is passed on");
  await settle();
  assert.equal(srv.calls.length, 1, "no reconnect");
});

test("401: one refresh, then the new token; a second 401 stops", async () => {
  const srv = fakeServer();
  srv.script.push(401);
  let token = "old";
  let refreshes = 0;
  const stops: ChatStreamStop[] = [];
  const h = connectChatStream({
    url: "u", getToken: () => token, onEvent: () => undefined, onStop: (r) => stops.push(r), fetchImpl: srv.fetchImpl, baseDelayMs: 1,
    refresh: async () => { refreshes++; token = "new"; return true; },
  });
  await until(() => srv.calls.length === 2, "connected again after the refresh");
  assert.equal(srv.calls[1].headers.Authorization, "Bearer new");
  assert.equal(refreshes, 1);
  h.close();

  const srv2 = fakeServer();
  srv2.script.push(401, 401);
  const stops2: ChatStreamStop[] = [];
  connectChatStream({ url: "u", getToken: () => "t", onEvent: () => undefined, onStop: (r) => stops2.push(r), fetchImpl: srv2.fetchImpl, baseDelayMs: 1, refresh: async () => true });
  await until(() => stops2.length === 1, "stopped");
  assert.deepEqual(stops2, ["unauthorized"]);
  await settle();
  assert.equal(srv2.calls.length, 2);
  assert.deepEqual(stops, []);
});

test("401 without a refresh, 403, or no token: stops without retrying", async () => {
  for (const [status, reason] of [[401, "unauthorized"], [403, "forbidden"]] as const) {
    const srv = fakeServer();
    srv.script.push(status);
    const stops: ChatStreamStop[] = [];
    connectChatStream({ url: "u", getToken: () => "t", onEvent: () => undefined, onStop: (r) => stops.push(r), fetchImpl: srv.fetchImpl, baseDelayMs: 1 });
    await until(() => stops.length === 1, `stop on ${status}`);
    assert.deepEqual(stops, [reason]);
    await settle();
    assert.equal(srv.calls.length, 1);
  }
  const srv = fakeServer();
  const stops: ChatStreamStop[] = [];
  connectChatStream({ url: "u", getToken: () => null, onEvent: () => undefined, onStop: (r) => stops.push(r), fetchImpl: srv.fetchImpl });
  await until(() => stops.length === 1, "stop without a token");
  assert.equal(srv.calls.length, 0, "nothing is requested without a token");
});

test("closing (the page unmounts) aborts the open request and cancels a planned reconnect", async () => {
  const srv = fakeServer();
  const h = connectChatStream({ url: "u", getToken: () => "t", onEvent: () => undefined, fetchImpl: srv.fetchImpl, baseDelayMs: 40, random: () => 1 });
  await until(() => srv.calls.length === 1, "first");
  srv.calls[0].end(); // dropped: a reconnect is planned in 40 ms
  await settle();
  h.close();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(srv.calls.length, 1, "the planned reconnect was cancelled");

  const srv2 = fakeServer();
  const h2 = connectChatStream({ url: "u", getToken: () => "t", onEvent: () => undefined, fetchImpl: srv2.fetchImpl, baseDelayMs: 1 });
  await until(() => srv2.calls.length === 1, "first");
  h2.close();
  assert.ok(srv2.calls[0].signal.aborted);
  await settle();
  assert.equal(srv2.calls.length, 1, "an aborted stream is not reopened");
});

test("a connection silent for too long (not even a ping) is dropped and opened again", async () => {
  const srv = fakeServer();
  const h = connectChatStream({ url: "u", getToken: () => "t", onEvent: () => undefined, fetchImpl: srv.fetchImpl, idleTimeoutMs: 40, baseDelayMs: 1, random: () => 1 });
  await until(() => srv.calls.length === 1, "first");
  // Pings keep it alive.
  for (let i = 0; i < 4; i++) {
    srv.calls[0].send(": ping\n\n");
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(srv.calls.length, 1);
  await until(() => srv.calls.length === 2, "reopened after the silence");
  assert.ok(srv.calls[0].signal.aborted);
  h.close();
});

test("a listener that throws does not break the stream", async () => {
  const srv = fakeServer();
  const seen: string[] = [];
  const h = connectChatStream({
    url: "u", getToken: () => "t", fetchImpl: srv.fetchImpl,
    onEvent: (e) => { seen.push(e.data); if (e.data === "1") throw new Error("boom"); },
  });
  await until(() => srv.calls.length === 1, "first");
  srv.calls[0].send("data: 1\n\ndata: 2\n\n");
  await until(() => seen.length === 2, "both events");
  assert.equal(srv.calls.length, 1);
  h.close();
});
