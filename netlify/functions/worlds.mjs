import { getStore } from '@netlify/blobs';

const STORE_NAME = 'awi67-colleagues';
const replies = (payload, status = 200) => Response.json(payload, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});

function normalizeWorld(data) {
  const author = String(data?.author ?? '').trim().replace(/\s+/g, ' ');
  const title = String(data?.title ?? '').trim().replace(/\s+/g, ' ');
  if (author.length < 2 || author.length > 80 || title.length < 3 || title.length > 120) {
    throw new Error('Indica um nome (2–80 caracteres) e um título (3–120 caracteres).');
  }
  const u = new URL(String(data?.url ?? '').trim());
  if (u.protocol !== 'https:' || !['framevr.io', 'www.framevr.io'].includes(u.hostname.toLowerCase()) || u.username || u.password || u.pathname === '/') {
    throw new Error('Indica uma ligação pública válida para um espaço FrameVR.');
  }
  if (u.href.length > 450) throw new Error('A ligação introduzida é demasiado longa.');
  u.hash = '';
  return { author, title, url: u.href, createdAt: new Date().toISOString() };
}

async function keyFor(url) {
  const bytes = new TextEncoder().encode(new URL(url).origin + new URL(url).pathname.toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return 'worlds/' + Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join('');
}

export default async (request) => {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  try {
    if (request.method === 'GET') {
      const { blobs } = await store.list({ prefix: 'worlds/' });
      const entries = await Promise.all(blobs.slice(0, 200).map(b => store.get(b.key, { type: 'json' }).catch(() => null)));
      const worlds = entries.filter(x => x && x.author && x.title && x.url)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return replies({ worlds, total: worlds.length });
    }

    if (request.method === 'POST') {
      const len = Number(request.headers.get('content-length') || 0);
      if (len > 2500) return replies({ error: 'Pedido demasiado extenso.' }, 413);
      const body = await request.text();
      if (body.length > 2500) return replies({ error: 'Pedido demasiado extenso.' }, 413);
      let input;
      try { input = JSON.parse(body); } catch { return replies({ error: 'Formato inválido.' }, 400); }
      // Honey-pot: automated spam should never reach the public gallery.
      if (input.website) return replies({ error: 'Registo rejeitado.' }, 400);
      let world;
      try { world = normalizeWorld(input); } catch(e) { return replies({ error: e.message }, 400); }
      const key = await keyFor(world.url);
      const { modified } = await store.setJSON(key, world, { onlyIfNew: true });
      if (!modified) return replies({ error: 'Este endereço FrameVR já consta da galeria.' }, 409);
      return replies({ ok: true, world }, 201);
    }
    return replies({ error: 'Método não permitido.' }, 405);
  } catch (e) {
    console.error('Falha no acesso à galeria AWI:', e?.message ?? e);
    return replies({ error: 'Não foi possível aceder ao arquivo partilhado. Volta a tentar.' }, 503);
  }
};
export const config = { path: '/api/mundos', method: ['GET', 'POST'] };
