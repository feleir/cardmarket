// Chrome extension entry, injected into cardmarket.com pages in the page's
// own JavaScript world ("world": "MAIN"), like the bookmarklet: the cart code
// needs Cardmarket's globals (jcp's request queue), which an isolated
// content script cannot see. The toolbar button calls window.__cmoptMount.
import { mount } from './ui.js';

if (!window.__cmoptLoaded) {
  window.__cmoptLoaded = true;
  window.__cmoptMount = mount;
  const add = () => {
    const b = document.createElement('button');
    b.id = 'cmopt-launch';
    b.textContent = '⚡ Optimize';
    b.title = 'Cardmarket Optimizer';
    b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147482000;padding:10px 14px;border-radius:999px;border:0;background:#0a6cff;color:#fff;font:600 14px system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.25);cursor:pointer';
    b.addEventListener('click', mount);
    document.body.appendChild(b);
  };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
}
