#!/usr/bin/env node
/* eslint-disable */
// Local stand-in for a provider: sends one call's webhook events, in
// Zadarma's format and signed the way Zadarma signs them, to a center's
// webhook address. No real call, no request to any provider.
//
//   node scripts/telephony-mock-call.cjs --url <webhook URL from the settings> --secret <the secret you saved> \
//        [--from +998901234567] [--ext 100] [--missed] [--duration 95] [--out] [--record]
//
//   --missed     nobody answers (status MISSED)
//   --out        an outgoing call from --ext to --from
//   --record     the call has a recording
//
// Never for production: it refuses non-local addresses.
const { createHmac } = require('crypto');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);

const url = opt('url');
const secret = opt('secret');
if (!url || !secret) {
  console.error('usage: node scripts/telephony-mock-call.cjs --url <webhook URL> --secret <secret> [--from +998901234567] [--ext 100] [--missed] [--out] [--record]');
  process.exit(1);
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1'].includes(host) && !host.endsWith('.localhost')) {
  console.error(`telephony-mock-call: ${url} is not a local address - refusing.`);
  process.exit(1);
}

const from = opt('from', '+998901234567');
const ext = opt('ext', '100');
const duration = flag('missed') ? '0' : opt('duration', '95');
const disposition = flag('missed') ? 'no answer' : 'answered';
const id = `${flag('out') ? 'out' : 'in'}_mock_${Date.now()}`;
const callStart = new Date().toISOString().slice(0, 19).replace('T', ' ');
const rec = flag('record') && !flag('missed') ? `rec_${Date.now()}` : '';
const line = '+998712000000';

// The fields each event's signature covers (Zadarma's documentation).
const SIGNED = {
  NOTIFY_START: ['caller_id', 'called_did', 'call_start'],
  NOTIFY_INTERNAL: ['caller_id', 'called_did', 'call_start'],
  NOTIFY_ANSWER: ['caller_id', 'destination', 'call_start'],
  NOTIFY_END: ['caller_id', 'called_did', 'call_start'],
  NOTIFY_OUT_START: ['internal', 'destination', 'call_start'],
  NOTIFY_OUT_END: ['internal', 'destination', 'call_start'],
  NOTIFY_RECORD: ['pbx_call_id', 'call_id_with_rec'],
};
const sign = (b) => Buffer.from(createHmac('sha1', secret).update(SIGNED[b.event].map((f) => b[f] ?? '').join('')).digest('hex')).toString('base64');

const base = { call_start: callStart, pbx_call_id: id };
const events = flag('out')
  ? [
      { ...base, event: 'NOTIFY_OUT_START', internal: ext, destination: from.replace(/^\+/, '') },
      ...(flag('missed') ? [] : [{ ...base, event: 'NOTIFY_ANSWER', caller_id: ext, destination: from.replace(/^\+/, ''), internal: ext }]),
      { ...base, event: 'NOTIFY_OUT_END', internal: ext, caller_id: ext, destination: from.replace(/^\+/, ''), duration, disposition, status_code: '16', is_recorded: rec ? '1' : '0', call_id_with_rec: rec },
    ]
  : [
      { ...base, event: 'NOTIFY_START', caller_id: from, called_did: line },
      { ...base, event: 'NOTIFY_INTERNAL', caller_id: from, called_did: line, internal: ext },
      ...(flag('missed') ? [] : [{ ...base, event: 'NOTIFY_ANSWER', caller_id: from, destination: ext, internal: ext }]),
      { ...base, event: 'NOTIFY_END', caller_id: from, called_did: line, internal: ext, duration, disposition, status_code: '16', is_recorded: rec ? '1' : '0', call_id_with_rec: rec },
    ];
if (rec) events.push({ event: 'NOTIFY_RECORD', pbx_call_id: id, call_id_with_rec: rec });

(async () => {
  console.log(`call ${id}: ${flag('out') ? `${ext} -> ${from}` : `${from} -> ${ext}`}, ${flag('missed') ? 'missed' : `answered, ${duration}s`}`);
  for (const ev of events) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Signature: sign(ev) },
      body: new URLSearchParams(ev).toString(),
    });
    console.log(`  ${ev.event.padEnd(17)} -> ${res.status}`);
    if (!res.ok) {
      process.exitCode = 1;
      break; // refused (403: wrong secret, 404: wrong address): the rest would be refused too
    }
    await new Promise((r) => setTimeout(r, Number(opt('delay', '400'))));
  }
})();
