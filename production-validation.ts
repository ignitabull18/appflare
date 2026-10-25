// Disposable production validation fixture; no user data or secrets.
export default {
  async fetch(request: Request, env: {DB: D1Database}): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/mapped-error') throw new Error('Appflare production validation mapped error');
    if (path === '/marker') {
      const marker = await env.DB.prepare('SELECT value FROM validation_marker WHERE id = 1').first();
      return Response.json(marker);
    }
    return Response.json({fixture: 'appflare-production-validation', status: 'ok'});
  }
};
