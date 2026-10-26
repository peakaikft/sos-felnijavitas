// SOS Felnijavítás – e-mail értesítések új ajánlatkérésnél.
// Hívja: Supabase Database Webhook (INSERT a public.sos_felni_leads táblán).
// Küld: 1) belső értesítőt a pultnak (ERTESITES_EMAIL), 2) visszaigazolót az ügyfélnek.
// Környezeti változók (Vercel): RESEND_API_KEY, EMAIL_FROM, ERTESITES_EMAIL,
// PUBLIC_BASE_URL, WEBHOOK_SECRET, CEG_NEV (opcionális).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function kuld(apiKey, body) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('Resend ' + r.status + ': ' + (await r.text()).slice(0, 300));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || req.headers['x-webhook-secret'] !== secret) return res.status(401).json({ ok: false });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (body.type !== 'INSERT' || !body.record) return res.status(200).json({ ok: true, skip: true });
  const l = body.record;

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const pult = process.env.ERTESITES_EMAIL;
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const ceg = process.env.CEG_NEV || 'Centrum Gumi';
  if (!apiKey || !from) return res.status(500).json({ ok: false, error: 'missing env' });

  const boardUrl = base + '/ajanlat-board.html';
  const ugyfelUrl = base + '/ugyfel-nezet.html?token=' + encodeURIComponent(l.share_token);
  const fotoDb = Array.isArray(l.fotok) ? l.fotok.length : 0;
  const hibak = [];

  if (pult) {
    const sor = (k, v) => '<tr><td style="padding:4px 12px 4px 0;color:#666">' + k + '</td><td style="padding:4px 0"><b>' + esc(v || '–') + '</b></td></tr>';
    try {
      await kuld(apiKey, {
        from, to: [pult], reply_to: l.email || undefined,
        subject: 'Új SOS Felnijavítás ajánlatkérés – ' + (l.nev || 'ismeretlen') + ' (' + (l.telefon || '') + ')',
        html: '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111">' +
          '<h2 style="margin:0 0 12px">Új ajánlatkérés érkezett</h2>' +
          '<table>' + sor('Név', l.nev) + sor('Telefon', l.telefon) + sor('E-mail', l.email) + sor('Felni méret', l.felni_meret) + sor('Darabszám', l.darabszam) + sor('Fotók', fotoDb + ' db') + '</table>' +
          '<p style="margin:16px 0"><a href="' + esc(boardUrl) + '" style="background:#1faea8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Megnyitás a pulton</a></p>' +
          '<p style="color:#666;font-size:13px">A fotók a pulton, bejelentkezés után láthatók. Kérjük, hívja vissza az ügyfelet, és állítsa át az állapotot.</p></div>',
      });
    } catch (e) { hibak.push('pult: ' + e.message); }
  }

  if (l.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email)) {
    try {
      await kuld(apiKey, {
        from, to: [l.email], reply_to: pult || undefined,
        subject: ceg + ' – megkaptuk az ajánlatkérésedet (SOS Felnijavítás)',
        html: '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;max-width:560px">' +
          '<p>Kedves ' + esc(l.nev || 'Ügyfelünk') + '!</p>' +
          '<p>Köszönjük, megkaptuk a felnijavítási ajánlatkérésedet. Kollégánk a fotók alapján felméri a munkát, és a megadott telefonszámon (' + esc(l.telefon) + ') hamarosan felkeres egy pontos ajánlattal.</p>' +
          '<p>Az ajánlatkérésed állapotát bármikor megnézheted itt:<br><a href="' + esc(ugyfelUrl) + '">' + esc(ugyfelUrl) + '</a></p>' +
          '<p style="color:#666;font-size:13px">Ezt az üzenetet azért kaptad, mert ajánlatot kértél az SOS Felnijavítás oldalon. Az adataid kezelésének részleteit az oldalon található adatkezelési tájékoztatóban találod.</p>' +
          '<p>Üdvözlettel,<br>' + esc(ceg) + '</p></div>',
      });
    } catch (e) { hibak.push('ugyfel: ' + e.message); }
  }

  if (hibak.length) { console.error(hibak.join(' | ')); return res.status(500).json({ ok: false, hibak }); }
  return res.status(200).json({ ok: true });
};
