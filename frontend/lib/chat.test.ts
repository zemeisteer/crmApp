import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CHAT_BODY, checkBody, dropConfirmed, failPending, firstSeq, lastSeq, mergeMessages, newClientMessageId, removePending, unreadTotal, upsertPending, senderLabel,
  type PendingMessage,
} from "./chat.ts";

const msg = (seq: number, extra: Partial<{ id: string; clientMessageId: string; mine: boolean; body: string }> = {}) => ({
  id: extra.id ?? `m${seq}`, seq, clientMessageId: extra.clientMessageId ?? `client-${seq}`, mine: extra.mine ?? false, body: extra.body ?? `body ${seq}`,
});
const pending = (id: string, status: PendingMessage["status"] = "sending"): PendingMessage => ({ clientMessageId: id, body: `text ${id}`, status, createdAt: "2026-10-09T10:00:00.000Z" });

test("lists merge by seq: one copy per message, in server order, whatever order pages arrive in", () => {
  const latest = [msg(4), msg(5), msg(6)];
  const older = [msg(1), msg(2), msg(3), msg(4)];
  const merged = mergeMessages(latest, older);
  assert.deepEqual(merged.map((m) => m.seq), [1, 2, 3, 4, 5, 6]);
  // A catch-up after a reconnect overlapping what is shown.
  const caught = mergeMessages(merged, [msg(6), msg(7), msg(5)]);
  assert.deepEqual(caught.map((m) => m.seq), [1, 2, 3, 4, 5, 6, 7]);
  // The later copy of a message wins (e.g. the send's own answer).
  const updated = mergeMessages(caught, [msg(7, { body: "server copy" })]);
  assert.equal(updated.find((m) => m.seq === 7)!.body, "server copy");
  assert.equal(updated.length, 7);
  // Nothing new: the same array back (no re-render).
  assert.equal(mergeMessages(updated, []), updated);
});

test("cursors: the last seq for catching up, the first for older pages", () => {
  assert.equal(lastSeq([]), 0);
  assert.equal(lastSeq([msg(3), msg(9), msg(4)]), 9);
  assert.equal(firstSeq([]), null);
  assert.equal(firstSeq([msg(3), msg(9), msg(2)]), 2);
});

test("a message on its way is kept once per client id: a retry or a second click updates it", () => {
  let list = upsertPending([], pending("a"));
  list = upsertPending(list, pending("b"));
  list = failPending(list, "a", "Too many");
  assert.deepEqual(list.map((p) => [p.clientMessageId, p.status, p.error ?? null]), [["a", "failed", "Too many"], ["b", "sending", null]]);
  // Retry: the same id goes back to "sending" in its place, not a new row.
  list = upsertPending(list, { ...pending("a"), createdAt: "2030-01-01T00:00:00.000Z" });
  assert.equal(list.length, 2);
  assert.equal(list[0].status, "sending");
  assert.equal(list[0].createdAt, "2026-10-09T10:00:00.000Z", "keeps its original place in time");
  list = removePending(list, "a");
  assert.deepEqual(list.map((p) => p.clientMessageId), ["b"]);
  assert.equal(removePending(list, "zzz"), list);
});

test("the server's copy of my message replaces the one on its way; others' messages with the same id do not", () => {
  const list = [pending("mine-1"), pending("mine-2")];
  const confirmed = [msg(10, { clientMessageId: "mine-1", mine: true }), msg(11, { clientMessageId: "mine-2", mine: false })];
  assert.deepEqual(dropConfirmed(list, confirmed).map((p) => p.clientMessageId), ["mine-2"]);
  // Nothing confirmed: the same array back.
  assert.equal(dropConfirmed(list, []), list);
});

test("the composer sends trimmed text up to the server's limit", () => {
  assert.deepEqual(checkBody("  salom \r\n dunyo  "), { ok: true, body: "salom \n dunyo" });
  assert.deepEqual(checkBody("   \n "), { ok: false, reason: "empty" });
  assert.deepEqual(checkBody("x".repeat(MAX_CHAT_BODY)), { ok: true, body: "x".repeat(MAX_CHAT_BODY) });
  assert.deepEqual(checkBody(` ${"x".repeat(MAX_CHAT_BODY)} `), { ok: true, body: "x".repeat(MAX_CHAT_BODY) });
  assert.deepEqual(checkBody("x".repeat(MAX_CHAT_BODY + 1)), { ok: false, reason: "tooLong" });
});

test("client message ids are unique and in the form the server accepts", () => {
  const SERVER_RE = /^[A-Za-z0-9_-]{8,64}$/;
  const ids = new Set(Array.from({ length: 200 }, () => newClientMessageId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, SERVER_RE);
  // Without randomUUID (a page served over plain http): random bytes in hex.
  const fallback = newClientMessageId({ getRandomValues: <T extends ArrayBufferView | null>(a: T) => globalThis.crypto.getRandomValues(a as Uint8Array) as unknown as T });
  assert.match(fallback, /^[0-9a-f]{32}$/);
  // randomUUID that throws (insecure context in some browsers) falls back too.
  const throwing = newClientMessageId({ randomUUID: () => { throw new Error("insecure"); }, getRandomValues: <T extends ArrayBufferView | null>(a: T) => a });
  assert.match(throwing, SERVER_RE);
});

test("the unread total adds every conversation's count", () => {
  assert.equal(unreadTotal([]), 0);
  assert.equal(unreadTotal([{ unread: 2 }, { unread: 0 }, { unread: 5 }]), 7);
});

test("sender names are built in the reader's language from the parts", () => {
  const tpl = { parentOf: "{child}'s parent", parentNamed: "{name} ({child}'s parent)" };
  assert.equal(senderLabel({ senderName: "Staff", senderRole: "staff", senderPerson: "Staff", senderAbout: null }, tpl), "Staff");
  assert.equal(senderLabel({ senderName: "Ali", senderRole: "student", senderPerson: "Ali", senderAbout: null }, tpl), "Ali");
  assert.equal(senderLabel({ senderName: "Ona (Ali — ota-ona)", senderRole: "parent", senderPerson: "Ona", senderAbout: "Ali" }, tpl), "Ona (Ali's parent)");
  assert.equal(senderLabel({ senderName: "Ali (ota-ona)", senderRole: "parent", senderPerson: null, senderAbout: "Ali" }, tpl), "Ali's parent");
  // An older server without the parts: the stored label.
  assert.equal(senderLabel({ senderName: "Ali (ota-ona)" }, tpl), "Ali (ota-ona)");
});
