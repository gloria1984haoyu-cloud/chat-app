export const config = { maxDuration: 60 };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
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
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version, x-base-url',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    const apiKey = req.headers.get('x-api-key');
    const baseUrl = req.headers.get('x-base-url') || 'https://ai.aiclick.cc';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55000);

    let response;
    try {
      response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const data = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const looksJson = contentType.includes('application/json') || data.trim().startsWith('{') || data.trim().startsWith('[');
    if (!looksJson) {
      return jsonResponse({
        error: {
          message: `上游服务返回了非 JSON 响应（HTTP ${response.status}），通常是中转站或模型请求超时。`,
          upstream_status: response.status,
          upstream_preview: data.slice(0, 300),
        },
      }, response.ok ? 502 : response.status);
    }

    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    const isAbort = e?.name === 'AbortError';
    return jsonResponse({
      error: {
        message: isAbort
          ? '请求上游模型超时。通常是上下文太长、开启思考链、图片/文件较大，或中转站响应慢。'
          : (e?.message || '代理请求失败'),
      },
    }, isAbort ? 504 : 500);
  }
}
