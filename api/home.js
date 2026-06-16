// Serves the homepage with the live webinar date/time injected BEFORE the page is sent,
// so the date the visitor sees on first paint already matches the Google Sheet (no flash).
// If anything fails (Sheet slow/down, file missing), it falls back to the plain static page.

const fs = require('fs');
const path = require('path');

const SHEET_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzKNNqL6SfggXKnH6oafnOC1OHdxYlQ5pDgdGezc-GzibBynm2kepgbHxL0T9cfifPp/exec';

// Baked-in literals in index.html that represent the fallback date/time.
const FB_DATE = 'Trešdien, 17. jūnijā';
const FB_TIME = '19:00 (Latvijas laiks)';
const FB_ISO  = '2026-06-17T19:00:00+03:00';

let TEMPLATE = null;
function loadTemplate(){
  if (TEMPLATE) return TEMPLATE;
  const candidates = [
    path.join(process.cwd(), 'home.html'),
    path.join(__dirname, '..', 'home.html'),
    path.join(__dirname, 'home.html'),
  ];
  for (const f of candidates){
    try { TEMPLATE = fs.readFileSync(f, 'utf8'); return TEMPLATE; } catch (e) {}
  }
  return null;
}

// "YYYY-MM-DD HH:MM" entered as Latvia local time -> ISO string with the correct DST offset.
function rigaISO(datetime){
  const m = String(datetime || '').trim().match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const asUTC = Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], 0);
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone:'Europe/Riga', hour12:false,
    year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const p = {}; dtf.formatToParts(new Date(asUTC)).forEach(x => p[x.type] = x.value);
  const asTZ = Date.UTC(+p.year, +p.month-1, +p.day, +p.hour, +p.minute, +p.second);
  const offMin = Math.round((asTZ - asUTC) / 60000);
  const sign = offMin >= 0 ? '+' : '-';
  const pad = n => String(n).padStart(2, '0');
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${sign}${pad(Math.floor(Math.abs(offMin)/60))}:${pad(Math.abs(offMin)%60)}`;
}

async function fetchConfig(){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4500);   // Apps Script can be slow on a cold start
  try {
    const r = await fetch(SHEET_ENDPOINT + '?action=config', { signal: ctrl.signal, redirect: 'follow' });
    const text = await r.text();
    return JSON.parse(text);
  } finally { clearTimeout(t); }
}

module.exports = async (req, res) => {
  const html = loadTemplate();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Edge-cache the rendered page; refresh in the background so the Sheet date shows within ~30s.
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');

  if (!html){ res.status(500).send('home.html not found'); return; }

  try {
    const cfg = await fetchConfig();
    let out = html;
    if (cfg && cfg.dateText) out = out.split(FB_DATE).join(cfg.dateText);
    if (cfg && cfg.timeText) out = out.split(FB_TIME).join(cfg.timeText);
    const iso = cfg && cfg.datetime ? rigaISO(cfg.datetime) : null;
    if (iso) out = out.split(FB_ISO).join(iso);
    res.status(200).send(out);
  } catch (e) {
    res.status(200).send(html);   // Sheet unreachable -> serve the static fallback page
  }
};
