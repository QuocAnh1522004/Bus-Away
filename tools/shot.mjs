// Dev helper: headless-Edge/Chrome screenshot of the running dev server.
// Usage: node tools/shot.mjs "<query>" out.png [width height waitMs]
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [query = '', out = 'shots/shot.png', w = '540', h = '960', wait = '6000'] = process.argv.slice(2);
const browsers = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const exe = browsers.find((b) => existsSync(b));
if (!exe) throw new Error('No Chromium browser found');
const url = query.startsWith('http') || query.startsWith('file') ? query : `http://localhost:5173/${query}`;
execFileSync(exe, [
  '--headless=new', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  `--window-size=${w},${h}`, `--virtual-time-budget=${wait}`, `--screenshot=${resolve(out)}`, url,
], { stdio: 'pipe' });
console.log('saved', out);
