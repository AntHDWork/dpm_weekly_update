// tools/combine.mjs
// Combines the week's six JSON submissions and calls your GPT endpoint to generate summaries.
// Requires repo secrets: GPT_ENDPOINT and GPT_API_KEY. Node 20 provides global fetch.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const week = process.argv[2] || new Date().toISOString().slice(0,10);
const dir = path.join('data', week);
const required = ['catalogue','fulfilment','shopify_eu','shopify_us','d365','zendesk'];

function fail(msg) { console.error(msg); process.exit(1); }

if (!week || week.length !== 10) fail('Week parameter missing or invalid (YYYY-MM-DD).');
if (!fs.existsSync(dir)) { console.log(`No folder for week ${week}. Exiting.`); process.exit(0); }

const have = required.filter(k => fs.existsSync(path.join(dir, `${k}.json`)));
if (have.length !== required.length) {
  console.log(`Waiting for all submissions for ${week}. Have ${have.length}/6: ${have.join(', ')}`);
  process.exit(0);
}

// Load submissions
const submissions = required.map(k => {
  const p = path.join(dir, `${k}.json`);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    fail(`Invalid JSON in ${p}: ${e.message}`);
  }
});

// Build payload for the GPT
const payload = {
  run_metadata: { mode: 'github_ci', week_ending: week, hard_gate: true },
  submissions
};

// Secrets
const endpoint = process.env.GPT_ENDPOINT;
const key = process.env.GPT_API_KEY;
if (!endpoint || !key) fail('Missing GPT_ENDPOINT or GPT_API_KEY secrets.');

// Call the GPT endpoint
const res = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(payload)
});
if (!res.ok) {
  const txt = await res.text();
  fail(`GPT call failed: ${res.status} ${res.statusText}\n${txt}`);
}
const out = await res.json();

// Prepare outputs (accept either *_md or plain text fields)
const execMD = out.executive_summary_md || out.executive_summary || 'No executive summary returned.';
const combinedMD = out.combined_update_md || out.combined_update || 'No combined update returned.';

// Write files
fs.mkdirSync('summaries', { recursive: true });
const mdPath = path.join('summaries', `${week}.md`);
const jsonPath = path.join('summaries', `${week}.json`);
const mdContent = `**Executive Summary — ${week}**\n${execMD}\n\n**Combined Update — ${week}**\n${combinedMD}\n`;

fs.writeFileSync(mdPath, mdContent, 'utf8');
fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2), 'utf8');

// Commit the summary files
execSync('git config user.name "Update Combiner"', { stdio: 'inherit' });
execSync('git config user.email "bot@example.com"', { stdio: 'inherit' });
execSync(`git add "${mdPath}" "${jsonPath}"`, { stdio: 'inherit' });
execSync(`git commit -m "Add combined summary for ${week}" || echo "No changes"`, { shell: '/usr/bin/bash', stdio: 'inherit' });
execSync('git push', { stdio: 'inherit' });

console.log(`✅ Wrote summaries/${week}.md and summaries/${week}.json`);
