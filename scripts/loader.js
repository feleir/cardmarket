// The short bookmarklet. It downloads the optimizer from a public URL that
// answers cross-site requests (e.g. raw.githubusercontent.com of a public
// repository; the file is run from its text, so the plain-text content type
// does not matter), keeps a copy in cardmarket.com's localStorage for when
// the download fails, and says what went wrong instead of failing silently.
// It carries no credentials: it runs inside cardmarket.com's page.
//
// __URL__ is filled in by build.mjs. Kept free of "%" so it can be used as a
// javascript: URL as-is.
export const LOADER = `(async()=>{
const U='__URL__',K='cmoptCode';
const say=(m)=>{let d=document.getElementById('cmopt-toast');if(!d){d=document.createElement('div');d.id='cmopt-toast';d.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;padding:12px 14px;border-radius:10px;background:#1c211d;color:#fff;font:15px/1.4 system-ui,sans-serif';document.body.appendChild(d)}d.textContent=m;return d};
if(!/cardmarket\\.com$/.test(location.hostname)){alert('Open cardmarket.com first, then run cmopt again.');return}
const t=say('Loading Cardmarket Optimizer…');
let c='';
try{
const r=await fetch(U,{cache:'no-cache'});
if(!r.ok)throw new Error(r.status==404?'file not found (is the repository public, and the branch right?)':'download answered HTTP '+r.status);
c=await r.text();
try{localStorage.setItem(K,c)}catch(e){}
}catch(e){
try{c=localStorage.getItem(K)||''}catch(x){}
if(!c){say('Cardmarket Optimizer could not load: '+(e.message||e));return}
say('Download failed ('+(e.message||e)+'), using the saved copy.');
}
try{(0,eval)(c)}catch(e){
if(!(e instanceof EvalError)){say('Cardmarket Optimizer failed to start: '+(e.message||e));return}
const s=document.createElement('script');s.textContent=c;document.body.appendChild(s);
}
setTimeout(()=>t.remove(),2500);
})();`;

export const loaderBookmarklet = (url) =>
  'javascript:' + LOADER.replace(/\n/g, '').replace('__URL__', url) + 'void 0';
