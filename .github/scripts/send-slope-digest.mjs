#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const digestPath = process.argv[2];
if (!digestPath) {
  console.error('Usage: send-slope-digest.mjs <digest-path>');
  process.exit(1);
}

const apiKey = process.env.RESEND_API_KEY;
const to = process.env.SLOPE_DIGEST_EMAIL_TO;
const from = process.env.SLOPE_DIGEST_EMAIL_FROM;

if (!apiKey || !to || !from) {
  console.error('RESEND_API_KEY, SLOPE_DIGEST_EMAIL_TO, and SLOPE_DIGEST_EMAIL_FROM are required.');
  process.exit(1);
}

const text = readFileSync(digestPath, 'utf8');
const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from,
    to: to.split(',').map(address => address.trim()).filter(Boolean),
    subject: 'SLOPE issue scout daily approval digest',
    text,
  }),
});

if (!response.ok) {
  const body = await response.text();
  console.error(`Resend API failed: ${response.status} ${body}`);
  process.exit(1);
}

console.log('SLOPE issue scout digest email sent.');
