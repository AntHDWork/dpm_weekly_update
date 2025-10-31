// api/combine.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, info: 'POST JSON with { run_metadata, submissions }' });
  }
  const body = typeof req.body === 'object' ? req.body : {};
  const week = body?.run_metadata?.week_ending || 'unknown-week';
  return res.status(200).json({
    ok: true,
    executive_summary_md: `**Executive Summary — ${week}**\nAPI OK.`,
    combined_update_md: `**Combined Update — ${week}**\nWiring OK.`
  });
}

// Optional: force Node 20 for this function
export const config = { runtime: 'nodejs20.x' };
