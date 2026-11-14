// DEV-only debug views (tree-shaken from production: imported behind import.meta.env.DEV).
import type { Assets } from '../engine/assets';
import { runLayout } from './layout';
import { runStick } from './stick';

export function runDebugView(view: string, assets: Assets) {
  if (view === 'layout') runLayout(assets);
  if (view === 'stick') runStick(assets);
}
