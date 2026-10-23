import { mount } from './ui.js';

if (!/(^|\.)cardmarket\.com$/.test(location.hostname)) {
  alert('Open cardmarket.com (and log in), then run the Cardmarket Optimizer again.');
} else {
  mount();
}
