import webPush from 'web-push';

const SB_URL = 'https://xtyouprikflaumctggxs.supabase.co';
const SB_KEY = 'sb_publishable_7of0a388w-l2JV8rD3K8rg_3Jh3ZniY';
const PUSH_FILE_ID = '__lucian_push_subscriptions__';
const PUSH_FILE_NAME = '.lucian-push-subscriptions.json';
const FALLBACK_PUBLIC_KEY = 'BMe3CEiLb3zQR7cKQipgVZIMLIHNC0UIHs5eASiUwxd097_FpnmG-j6dTWHUxr8orWRnwXWBh2chcITM4HBHRfg';

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

  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!privateKey) return json({ error: 'Missing VAPID_PRIVATE_KEY' }, 500);

  try {
    const body = await req.json().catch(() => ({}));
    const title = String(body.title || 'Lucian').slice(0, 80);
    const message = String(body.body || '在吗。').slice(0, 180);
    const subscriptions = await fetchSubscriptions();
    if (subscriptions.length === 0) return json({ ok: false, sent: 0, error: 'No subscriptions' }, 404);

    webPush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:push@chat-app-gloria5.vercel.app',
      process.env.VAPID_PUBLIC_KEY || FALLBACK_PUBLIC_KEY,
      privateKey
    );

    const payload = JSON.stringify({
      title,
      body: message,
      url: '/',
      tag: 'lucian-test',
      timestamp: Date.now(),
    });

    const results = await Promise.allSettled(
      subscriptions.map(item => webPush.sendNotification(item.subscription, payload))
    );
    const failedEndpoints = new Set();
    let sent = 0;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        sent++;
        return;
      }
      const statusCode = result.reason?.statusCode;
      if (statusCode === 404 || statusCode === 410) failedEndpoints.add(subscriptions[index].endpoint);
    });

    if (failedEndpoints.size > 0) {
      await saveSubscriptions(subscriptions.filter(item => !failedEndpoints.has(item.endpoint)));
    }

    return json({ ok: true, sent, total: subscriptions.length, removed: failedEndpoints.size });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
