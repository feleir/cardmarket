// Same-origin page fetching, one request at a time with a pause between them,
// so the run looks like a person browsing rather than a burst. 429s back off;
// a Cloudflare challenge stops the run, since only the user can solve it.
import { isChallengePage } from './parse.js';

export class BlockedError extends Error {}
export class StoppedError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Fetcher {
  constructor({ delayMs = 1200, cacheMinutes = 30, onWait } = {}) {
    this.delayMs = delayMs;
    this.ttl = cacheMinutes * 60000;
    this.last = 0;
    this.stopped = false;
    this.onWait = onWait || (() => {});
    this.mem = new Map();
    this.requests = 0;
  }

  stop() { this.stopped = true; }

  async html(url) {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.stopped) throw new StoppedError('Stopped');
      const wait = this.last + this.delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      this.requests++;
      let res;
      try {
        res = await fetch(url, { credentials: 'include', headers: { Accept: 'text/html' } });
      } catch (e) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (res.status === 429) {
        const back = 10000 * (attempt + 1);
        this.onWait(`Rate limited by Cardmarket, pausing ${back / 1000}s…`);
        await sleep(back);
        continue;
      }
      const text = await res.text();
      if (res.status === 403 || res.status === 503 || isChallengePage(text)) {
        throw new BlockedError('Cardmarket asked for a browser check. Reload any Cardmarket page, pass the check, then run again — finished pages are cached.');
      }
      if (res.status === 404) return null;
      if (!res.ok) { await sleep(2000); continue; }
      return text;
    }
    throw new Error(`Could not load ${url}`);
  }

  async doc(url) {
    const text = await this.html(url);
    return text == null ? null : new DOMParser().parseFromString(text, 'text/html');
  }

  // Parsed results are cached per URL (memory + sessionStorage) so changing
  // optimizer settings does not mean fetching everything again.
  cached(url) {
    const m = this.mem.get(url);
    if (m && Date.now() - m.t < this.ttl) return m.v;
    try {
      const raw = sessionStorage.getItem('cmopt:c:' + url);
      if (raw) {
        const e = JSON.parse(raw);
        if (Date.now() - e.t < this.ttl) { this.mem.set(url, e); return e.v; }
      }
    } catch { /* storage unavailable */ }
    return undefined;
  }

  store(url, v) {
    const e = { t: Date.now(), v };
    this.mem.set(url, e);
    try {
      sessionStorage.setItem('cmopt:c:' + url, JSON.stringify(e));
    } catch {
      // Out of space: drop the old cache and keep only memory for this one.
      try {
        Object.keys(sessionStorage).filter((k) => k.startsWith('cmopt:c:')).forEach((k) => sessionStorage.removeItem(k));
      } catch { /* ignore */ }
    }
  }

  static clearCache() {
    try {
      Object.keys(sessionStorage).filter((k) => k.startsWith('cmopt:c:')).forEach((k) => sessionStorage.removeItem(k));
    } catch { /* ignore */ }
  }
}
