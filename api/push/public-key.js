export const config = { regions: ['hkg1'] };

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

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  return json({ publicKey: process.env.VAPID_PUBLIC_KEY || FALLBACK_PUBLIC_KEY });
}
