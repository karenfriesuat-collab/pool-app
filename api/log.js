const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const TEST_DB    = 'd7312c32-217a-479e-879b-86e064af66ae';
const ACTION_DB  = '9b06d3c7-d25c-44c4-bf9a-099e0bbd6402';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function propText(p) {
  return p?.rich_text?.[0]?.plain_text || '';
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — fetch recent log entries from both databases
  if (req.method === 'GET') {
    try {
      const [tests, actions] = await Promise.all([
        notion.databases.query({
          database_id: TEST_DB,
          sorts: [{ property: 'Date', direction: 'descending' }],
          page_size: 100,
        }),
        notion.databases.query({
          database_id: ACTION_DB,
          sorts: [{ property: 'Date', direction: 'descending' }],
          page_size: 100,
        }),
      ]);

      const testEntries = tests.results.map(p => ({
        type:       'test',
        notionId:   p.id,
        timestamp:  p.properties.Date?.date?.start || p.created_time,
        ctx:        p.properties.Context?.select?.name || '',
        chlorine:   p.properties.Chlorine?.number ?? '',
        ph:         p.properties.pH?.number ?? '',
        alkalinity: p.properties.Alkalinity?.number ?? '',
        cya:        p.properties.CYA?.number ?? '',
        hardness:   p.properties.Hardness?.number ?? '',
        visibility: propText(p.properties.Visibility),
        notes:      propText(p.properties.Notes),
      }));

      const actionEntries = actions.results.map(p => ({
        type:       'action',
        notionId:   p.id,
        timestamp:  p.properties.Date?.date?.start || p.created_time,
        ctx:        p.properties.Context?.select?.name || '',
        actionType: p.properties['Action Type']?.select?.name || '',
        chemical:   propText(p.properties.Chemical),
        amountUsed: propText(p.properties['Amount Used']),
        notes:      propText(p.properties.Notes),
      }));

      const combined = [...testEntries, ...actionEntries]
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      return res.json(combined);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — save a new test or action entry
  if (req.method === 'POST') {
    try {
      const body = req.body;
      const ts = body.timestamp || new Date().toISOString();

      if (body.type === 'test') {
        const props = {
          Name:    { title: [{ text: { content: `Test ${new Date(ts).toLocaleDateString('en-US')}` } }] },
          Date:    { date: { start: ts } },
        };
        if (body.ctx)        props.Context    = { select: { name: body.ctx } };
        if (body.chlorine  !== '' && body.chlorine  != null) props.Chlorine   = { number: parseFloat(body.chlorine) };
        if (body.ph        !== '' && body.ph        != null) props.pH         = { number: parseFloat(body.ph) };
        if (body.alkalinity !== '' && body.alkalinity != null) props.Alkalinity = { number: parseFloat(body.alkalinity) };
        if (body.cya       !== '' && body.cya       != null) props.CYA        = { number: parseFloat(body.cya) };
        if (body.hardness  !== '' && body.hardness  != null) props.Hardness   = { number: parseFloat(body.hardness) };
        if (body.visibility) props.Visibility = { rich_text: [{ text: { content: body.visibility } }] };
        if (body.notes)      props.Notes      = { rich_text: [{ text: { content: body.notes } }] };

        const page = await notion.pages.create({ parent: { database_id: TEST_DB }, properties: props });
        return res.json({ notionId: page.id });
      }

      if (body.type === 'action') {
        const props = {
          Name: { title: [{ text: { content: body.actionType || 'Action' } }] },
          Date: { date: { start: ts } },
        };
        if (body.ctx)        props.Context        = { select: { name: body.ctx } };
        if (body.actionType) props['Action Type'] = { select: { name: body.actionType } };
        if (body.chemical)   props.Chemical       = { rich_text: [{ text: { content: body.chemical } }] };
        if (body.amountUsed) props['Amount Used'] = { rich_text: [{ text: { content: body.amountUsed } }] };
        if (body.notes)      props.Notes          = { rich_text: [{ text: { content: body.notes } }] };

        const page = await notion.pages.create({ parent: { database_id: ACTION_DB }, properties: props });
        return res.json({ notionId: page.id });
      }

      return res.status(400).json({ error: 'Invalid type' });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};
