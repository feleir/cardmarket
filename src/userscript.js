// Userscript entry: a small floating button opens the optimizer.
import { mount } from './ui.js';

const b = document.createElement('button');
b.textContent = '⚡ Optimize';
b.title = 'Cardmarket Optimizer';
b.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147482000;padding:10px 14px;border-radius:999px;border:0;background:#0a6cff;color:#fff;font:600 14px system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.25)';
b.addEventListener('click', mount);
document.body.appendChild(b);
