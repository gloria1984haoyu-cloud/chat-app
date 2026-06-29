export const config = { regions: ['hkg1'] };

const SB_URL = 'https://xtyouprikflaumctggxs.supabase.co';
const SB_KEY = 'sb_publishable_7of0a388w-l2JV8rD3K8rg_3Jh3ZniY';
const PUSH_FILE_ID = '__lucian_push_subscriptions__';
const PUSH_FILE_NAME = '.lucian-push-subscriptions.json';

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(data));
}

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
  };
}

async function fetchSubscriptions() {
  const res = await fetch(`${SB_URL}/rest/v1/files?id=eq.${encodeURIComponent(PUSH_FILE_ID)}&select=*`, {
    headers: sbHeaders(),
  });
  if (!res.ok) return [];
  const rows = await res.json();
  if (!rows?.[0]?.content) return [];
  try {
    const parsed = JSON.parse(rows[0].content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveSubscriptions(items) {
  await fetch(`${SB_URL}/rest/v1/files`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      id: PUSH_FILE_ID,
      name: PUSH_FILE_NAME,
      content: JSON.stringify(items),
      created_at: Date.now(),
    }),
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const subscription = body.subscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      sendJson(res, 400, { error: 'Invalid subscription' });
      return;
    }

    const now = Date.now();
    const items = await fetchSubscriptions();
    const nextItem = {
      endpoint: subscription.endpoint,
      subscription,
      device_id: body.device_id || '',
      device_name: body.device_name || 'Unknown device',
      user_agent: body.user_agent || '',
      updated_at: now,
    };
    const next = items.filter(item => item.endpoint !== subscription.endpoint && item.device_id !== nextItem.device_id);
    next.unshift(nextItem);
    await saveSubscriptions(next.slice(0, 20));

    sendJson(res, 200, { ok: true, count: next.length });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}
