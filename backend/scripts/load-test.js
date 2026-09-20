// k6 load test for TalimCRM's backend.
//
// Install k6 (https://k6.io/docs/get-started/installation/), then:
//   k6 run -e BASE_URL=http://localhost:4000/api -e EMAIL=aziz@ilmmarkazi.uz -e PASSWORD=password123 scripts/load-test.js
//
// Ramps virtual users up to simulate concurrent admins browsing the app,
// hitting the endpoints a real session actually calls (login once, then
// repeatedly list groups/students/payments — the read-heavy common path).

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '20s', target: 10 },
    { duration: '40s', target: 50 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'], // less than 1% errors
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000/api';
const EMAIL = __ENV.EMAIL;
const PASSWORD = __ENV.PASSWORD;

export function setup() {
  const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'login ok': (r) => r.status === 200 || r.status === 201 });
  return { token: res.json('accessToken') };
}

export default function (data) {
  const headers = { Authorization: `Bearer ${data.token}` };

  const endpoints = ['/groups', '/students', '/payments', '/payments/summary', '/health'];
  const path = endpoints[Math.floor(Math.random() * endpoints.length)];
  const res = http.get(`${BASE_URL}${path}`, { headers });
  check(res, { [`${path} status 200`]: (r) => r.status === 200 });

  sleep(1);
}
