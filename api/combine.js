// api/combine.js
// Builds an executive roll-up + per-project digest from your flat JSON submissions.
// Expects POST body: { run_metadata: { week_ending }, submissions: [ { project_key, dpm, status, delta, milestones, risks, metrics, next7, asks, notes, submitted_at } ] }

function safe(v, fallback = '—') {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string' && v.trim() === '') return fallback;
  return v;
}

function formatStatusEmoji(status) {
  const s = (status || '').toLowerCase();
  if (s.startsWith('g')) return '🟢';
  if (s.startsWith('a') || s.startsWith('y')) return '🟡';
  if (s.startsWith('r')) return '🔴';
  return '⚪';
}

function summarizeExecutive(week, subs) {
  const byKey = {};
  for (const s of subs) byKey[s.project_key] = s;

  const keys = ['catalogue','fulfilment','shopify_eu','shopify_us','d365','zendesk'];
  const missing = keys.filter(k => !byKey[k]);
  const have = keys.filter(k => byKey[k]);

  const header = `**Executive Summary — ${week}**`;
  const flags = [
    ...(missing.length ? [`[Flag: missing ${missing.length}/6: ${missing.join(', ')}]`] : []),
  ];

  const statuses = have.map(k => {
    const s = byKey[k];
    return `- ${formatStatusEmoji(s.status)} **${k}** — ${safe(s.status, 'n/a')}: ${safe(s.delta, 'no update')}`;
  });

  // Risk highlights & upcoming milestones (compact)
  const riskLines = have
    .filter(k => safe(byKey[k].risks, '').toLowerCase() !== 'none' && safe(byKey[k].risks, '').trim() !== '')
    .map(k => `- **${k}** — ${safe(byKey[k].risks)}`);

  const milestoneLines = have
    .filter(k => safe(byKey[k].milestones, '').trim() !== '')
    .map(k => `- **${k}** — ${byKey[k].milestones}`);

  return [
    header,
    flags.join(' '),
    '',
    '**Status & Key Deltas**',
    ...(statuses.length ? statuses : ['- No project updates found.']),
    '',
    '**Top Risks**',
    ...(riskLines.length ? riskLines : ['- None flagged.']),
    '',
    '**Upcoming Milestones**',
    ...(milestoneLines.length ? milestoneLines : ['- None listed.'])
  ].join('\n');
}

function summarizeCombined(week, subs) {
  const order = ['catalogue','fulfilment','shopify_eu','shopify_us','d365','zendesk'];
  const byKey = {};
  for (const s of subs) byKey[s.project_key] = s;

  const sections = order.map(k => {
    const s = byKey[k];
    if (!s) return `### ${k}\n[Flag: missing submission]`;
    return [
      `### ${k}`,
      `- **DPM:** ${safe(s.dpm)}`,
      `- **Status:** ${formatStatusEmoji(s.status)} ${safe(s.status)}`,
      `- **Delta:** ${safe(s.delta)}`,
      `- **Milestones:** ${safe(s.milestones)}`,
      `- **Risks:** ${safe(s.risks)}`,
      `- **Metrics:** ${safe(s.metrics)}`,
      `- **Next 7 days:** ${safe(s.next7)}`,
      `- **Asks:** ${safe(s.asks, 'None.')}`,
      `- **Notes:** ${safe(s.notes)}`,
      `- **Submitted:** ${safe(s.submitted_at)}`
    ].join('\n');
  });

  return [
    `**Combined Update — ${week}**`,
    '',
    ...sections
  ].join('\n\n');
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(200).json({ ok: true, info: 'POST { run_metadata, submissions }' });
    }

    // Parse body (Vercel may or may not give parsed JSON)
    const body = typeof req.body === 'object' && req.body
      ? req.body
      : await new Promise((resolve) => {
          let d = '';
          req.on('data', (c) => (d += c));
          req.on('end', () => resolve(d ? JSON.parse(d) : {}));
        });

    const week = body?.run_metadata?.week_ending || 'unknown-week';
    const submissions = Array.isArray(body?.submissions) ? body.submissions : [];

    // Normalize: ensure expected fields exist (so templates don’t break)
    const normalized = submissions.map(s => ({
      project_key: s.project_key,
      dpm: s.dpm,
      status: s.status,
      delta: s.delta,
      milestones: s.milestones,
      risks: s.risks,
      metrics: s.metrics,
      next7: s.next7,
      asks: s.asks,
      notes: s.notes,
      submitted_at: s.submitted_at
    }));

    const executive_summary_md = summarizeExecutive(week, normalized);
    const combined_update_md = summarizeCombined(week, normalized);

    return res.status(200).json({ ok: true, executive_summary_md, combined_update_md });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
