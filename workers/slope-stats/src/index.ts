// SLOPE Stats Worker — serves pre-computed stats JSON from KV

interface Env {
  STATS_KV: KVNamespace;
}

const ALLOWED_ORIGINS = [
  'https://slope.dev',
  'https://www.slope.dev',
  'http://localhost:4321',  // Astro dev
  'http://localhost:3000',
];

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    switch (url.pathname) {
      case '/stats': {
        const data = await env.STATS_KV.get('stats');
        if (!data) {
          return new Response(
            JSON.stringify({ error: 'Stats not yet computed' }),
            {
              status: 503,
              headers: {
                ...corsHeaders(request),
                'Content-Type': 'application/json',
                'Retry-After': '60',
              },
            },
          );
        }
        return new Response(data, {
          headers: {
            ...corsHeaders(request),
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300, s-maxage=3600',
          },
        });
      }

      case '/health': {
        const cached = await env.STATS_KV.get('stats');
        const meta = cached ? JSON.parse(cached) : null;
        return new Response(
          JSON.stringify({
            ok: true,
            has_stats: !!cached,
            sprints_completed: meta?.sprints_completed ?? null,
          }),
          {
            headers: {
              ...corsHeaders(request),
              'Content-Type': 'application/json',
            },
          },
        );
      }

      default:
        return new Response('Not found', { status: 404 });
    }
  },
} satisfies ExportedHandler<Env>;
