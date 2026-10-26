// Mengambil kurs IDR dan menulis rates.json dalam bentuk "Rp per 1 unit".
// Dipanggil oleh .github/workflows/update-rates.yml (tanpa API key).
const fs = require('fs');

const OUT = 'rates.json';
const CUR = ['CNY', 'THB', 'KRW'];
const RANGE = { CNY: [1500, 5000], THB: [300, 800], KRW: [5, 20] };
const TIMEOUT = 10000;

const round = (c, v) => (c === 'KRW' ? Math.round(v * 100) / 100 : Math.round(v));
const invert = (o) => {
  const out = {};
  for (const c of CUR) out[c] = 1 / Number(o[c]);
  return out;
};

function validate(obj) {
  const out = {};
  for (const c of CUR) {
    const v = Number(obj[c]);
    if (!isFinite(v) || v <= 0) throw new Error(c + ': nilai tidak valid (' + obj[c] + ')');
    const [lo, hi] = RANGE[c];
    if (v < lo || v > hi) throw new Error(c + ': ' + v + ' di luar rentang ' + lo + '-' + hi);
    out[c] = round(c, v);
  }
  return out;
}

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'jastip-rates-updater' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const isoDate = (d) => new Date(d).toISOString().slice(0, 10);

const SOURCES = [
  {
    name: 'Frankfurter',
    run: async () => {
      const d = await getJson('https://api.frankfurter.dev/v1/latest?base=IDR&symbols=CNY,THB,KRW');
      if (!d || !d.rates) throw new Error('format tidak dikenal');
      return { rates: validate(invert(d.rates)), date: d.date || '' };
    }
  },
  {
    name: 'ExchangeRate-API',
    run: async () => {
      const d = await getJson('https://open.er-api.com/v6/latest/IDR');
      if (!d || d.result !== 'success' || !d.rates) throw new Error('result = ' + (d && d.result));
      return { rates: validate(invert(d.rates)), date: isoDate(d.time_last_update_unix * 1000) };
    }
  },
  {
    name: 'currency-api',
    run: async () => {
      const d = await getJson('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/idr.json');
      const r = d && d.idr;
      if (!r) throw new Error('format tidak dikenal');
      return { rates: validate(invert({ CNY: r.cny, THB: r.thb, KRW: r.krw })), date: d.date || '' };
    }
  }
];

(async () => {
  for (const s of SOURCES) {
    try {
      const res = await s.run();
      const payload = {
        date: res.date || isoDate(Date.now()),
        source: s.name,
        rates: res.rates
      };
      const next = JSON.stringify(payload, null, 2) + '\n';
      const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
      if (prev === next) {
        console.log('OK ' + s.name + ' — rates.json tidak berubah, tidak perlu commit.');
      } else {
        fs.writeFileSync(OUT, next);
        console.log('OK ' + s.name + ' — rates.json diperbarui:\n' + next);
      }
      return;
    } catch (e) {
      console.error('GAGAL ' + s.name + ': ' + (e && e.message ? e.message : e));
    }
  }
  console.error('Semua sumber gagal — rates.json tidak diubah.');
  process.exit(1);
})();
