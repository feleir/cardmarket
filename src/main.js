import { mount } from './ui.js';

if (!/(^|\.)cardmarket\.com$/.test(location.hostname)) {
  alert('Open cardmarket.com (and log in), then run the Cardmarket Optimizer again.');
} else {
  try {
    mount();
  } catch (e) {
    alert('Cardmarket Optimizer failed to start: ' + (e && e.message ? e.message : e));
    throw e;
  }
}
