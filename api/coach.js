/**
 * Pool coaching API — generates a contextual narrative from test readings + history.
 * Calls the Anthropic API using the ANTHROPIC_API_KEY env variable.
 */

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const SYSTEM = `You are a pool coaching assistant for Karen, who has a 25,000-gallon above-ground pool with a Mineral Frog mineral sanitizer system.

Pool: 30' round, vinyl liner, Carvin Sherlok 120 cartridge filter, 1.5HP 2-speed pump (runs 16 hrs/day on low).

Target ranges (Mineral Frog lowers chlorine demand — minerals do the heavy lifting):
- Chlorine: 0.5–1.5 ppm
- pH: 7.4–7.6
- Alkalinity: 80–120 ppm
- CYA: 30–50 ppm
- Hardness: 200–400 ppm

Given current readings and recent history, write a SHORT conversational coaching message — 2 to 4 sentences. Explain what you see, why (given the history), and what to do next. Be specific about cause and effect. Tone: direct and warm, like texting a knowledgeable friend. No bullet points, no headers, no markdown.`;

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured in Vercel environment' });
  }

  try {
    const { reading, history, weather, ctx } = req.body;

    // Build readable history (last 8 entries)
    const recent = (history || []).slice(0, 8);
    const historyLines = recent.map(e => {
      const d = new Date(e.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      if (e.type === 'action') {
        const parts = [e.actionType];
        if (e.chemical) parts.push(e.chemical);
        if (e.amountUsed) parts.push(e.amountUsed);
        return `${d}: ${parts.join(', ')}${e.notes ? ' — ' + e.notes : ''}`;
      } else {
        const vals = [];
        if (e.chlorine != null && e.chlorine !== '') vals.push(`Cl ${e.chlorine}`);
        if (e.ph       != null && e.ph       !== '') vals.push(`pH ${e.ph}`);
        if (e.alkalinity != null && e.alkalinity !== '') vals.push(`Alk ${e.alkalinity}`);
        if (e.cya      != null && e.cya      !== '') vals.push(`CYA ${e.cya}`);
        return `${d}: Test — ${vals.join(', ')}${e.notes ? ' — ' + e.notes : ''}`;
      }
    });

    const readingLines = [];
    if (reading.chlorine   !== '') readingLines.push(`Chlorine: ${reading.chlorine} ppm`);
    if (reading.ph         !== '') readingLines.push(`pH: ${reading.ph}`);
    if (reading.alkalinity !== '') readingLines.push(`Alkalinity: ${reading.alkalinity} ppm`);
    if (reading.cya        !== '') readingLines.push(`CYA: ${reading.cya} ppm`);
    if (reading.hardness   !== '') readingLines.push(`Hardness: ${reading.hardness} ppm`);
    if (reading.visibility)        readingLines.push(`Visibility: ${reading.visibility}`);

    const weatherLine = weather
      ? `Weather: ${weather.tempF}°F, ${weather.rain24h}" rain today${weather.hotRun >= 2 ? `, ${weather.hotRun} consecutive 90°F+ days` : ''}`
      : '';

    const userPrompt = [
      `Today's readings:`,
      readingLines.map(l => `- ${l}`).join('\n'),
      '',
      historyLines.length ? `Recent history:\n${historyLines.map(l => `- ${l}`).join('\n')}` : 'No recent history on record.',
      '',
      weatherLine,
      ctx ? `Context: ${ctx} mode` : '',
    ].filter(Boolean).join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        system: SYSTEM,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      return res.status(502).json({ error: 'Anthropic API error' });
    }

    const data = await response.json();
    const narrative = data.content?.[0]?.text || '';
    return res.json({ narrative });

  } catch (e) {
    console.error('Coach error:', e);
    return res.status(500).json({ error: e.message });
  }
};
