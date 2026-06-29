export const config = { regions: ['hkg1'] };

const SB_URL = 'https://xtyouprikflaumctggxs.supabase.co';
const SB_KEY = 'sb_publishable_7of0a388w-l2JV8rD3K8rg_3Jh3ZniY';
const PUSH_FILE_ID = '__lucian_push_subscriptions__';
const PUSH_FILE_NAME = '.lucian-push-subscriptions.json';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
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

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json();
    const subscription = body.subscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return json({ error: 'Invalid subscription' }, 400);
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

    return json({ ok: true, count: next.length });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
