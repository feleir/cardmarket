// Userscript entry: a small floating button opens the optimizer. Managers
// may inject at document-start or into a sandbox (Safari's Userscripts
// app), so wait for <body> and do not assume access to the page's globals.
import { mount } from './ui.js';

if (!window.__cmoptLoaded) {
  window.__cmoptLoaded = true;
  window.__cmoptMount = mount;
  const add = () => {
    if (document.getElementById('cmopt-launch')) return;
    const b = document.createElement('button');
    b.id = 'cmopt-launch';
    b.textContent = '⚡ Optimize';
    b.title = 'Cardmarket Optimizer';
    b.style.cssText = 'position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom, 0px));z-index:2147482000;padding:10px 14px;border-radius:999px;border:0;background:#0a6cff;color:#fff;font:600 14px system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.25);cursor:pointer';
    b.addEventListener('click', mount);
    document.body.appendChild(b);
  };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
}
