// api/combine.js
export default async function handler(req, res) {
  try {
    // BASIC AUTH (Authorization: Bearer <token>)
    const auth = req.headers.authorization || '';
    const requiredKey = process.env.API_KEY; // set in Vercel → Project → Settings → Environment Variables
    if (requiredKey && auth !== `Bearer ${requiredKey}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method !== 'POST') {
      return res.status(200).json({ ok: true, info: 'POST JSON with { run_metadata, submissions }' });
    }

    // Parse body safely (Vercel may or may not parse for you)
    let payload = req.body;
    if (!payload || typeof payload !== 'object') {
      const txt = await new Promise(resolve => {
        let d = ''; req.on('data', c => d += c);
        req.on('end', () => resolve(d));
      });
      payload = txt ? JSON.parse(txt) : {};
    }

    const week = payload?.run_metadata?.week_ending || 'unknown-week';
    const submissions = Array.isArray(payload?.submissions) ? payload.submissions : [];

    // Naive summary builder (stub) — replace with your real LLM call later
    const lines = submissions.map(s => {
      const key = s.project_key || 'unknown';
      const status = s.status || s.delta || 'update';
      return `- **${key}** — ${status}`;
    });

    const executive = [
      `**Executive Summary — ${week}**`,
      submissions.length === 6 ? 'All six submissions received.' : `Received ${submissions.length}/6.`,
      ...lines
    ].join('\n');

    const combined = [
      `**Combined Update — ${week}**`,
      ...submissions.map(s => `### ${s.project_key}\n- Status: ${s.status || 'n/a'}\n- Delta: ${s.delta || 'n/a'}\n- Risks: ${s.risks || 'n/a'}\n- Next7: ${s.next7 || 'n/a'}`)
    ].join('\n\n');

    return res.status(200).json({
      ok: true,
      executive_summary_md: executive,
      combined_update_md: combined
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error', details: String(err?.message || err) });
  }
}
