// DEV-only autoplay: `?bot&speed=4`. Plays like a sensible player (a bus whose colour is at the head
// of a station queue first, otherwise a front bus while parking remains) and reports the outcome in
// document.title. Steps the simulation with a fixed dt (headless browsers throttle rAF).
import type { Game } from '../game/Game';
import { LEVEL } from '../game/level';

const DT = 1 / 60;

export function runBot(getGame: () => Game, speed: number) {
  const q = new URLSearchParams(location.search);
  const snapAt = Number(q.get('snap') ?? -1);
  const bad = q.get('bot') === 'bad';
  let time = 0;
  let nextDecision = 0.8;
  const log: string[] = [];
  let prev: string[] = [];
  const step = () => {
    const g = getGame();
    for (let i = 0; i < speed; i++) {
      g.update(DT);
      time += DT;
    }
    const st = g.debugState();
    const states = st.buses.map((b) => b.split('[')[0]);
    states.forEach((b, i) => {
      if (prev[i] && prev[i] !== b) log.push(`${time.toFixed(1)}#${i}${b.split(':')[1]}`);
    });
    prev = states;
    if (snapAt > 0 && time >= snapAt) {
      document.title = `SNAP t=${time.toFixed(1)} heads=${st.heads.join(',')} | ${st.buses.join(' ')}`;
      // after a couple of rendered frames, append renderer stats
      setTimeout(() => (document.title += ` || ${(window as unknown as { __info?: () => string }).__info?.() ?? ''}`), 300);
      return;
    }
    if (st.ended) {
      document.title = `${st.won ? 'WIN' : `LOSE (${st.endReason})`} t=${time.toFixed(1)}s moves left=${st.movesLeft} | ${log.join(' ')}`;
      return;
    }
    if (time >= nextDecision) {
      nextDecision = time + 0.45;
      if (st.onRoad < LEVEL.capacity) {
        const heads = new Set(st.heads.filter(Boolean));
        const want = st.tappable.find((b) => heads.has(b.color));
        // ?bot=bad ignores colours entirely (exercises the lose path)
        const pick = bad
          ? st.tappable.find((b) => b.state === 'queued' && !heads.has(b.color)) ?? st.tappable[0]
          : want ?? (st.slotsFree > 1 ? st.tappable.find((b) => b.state === 'queued') : undefined);
        if (pick) {
          log.push(`${time.toFixed(1)}:${pick.color}${pick.seats}`);
          g.launch(pick);
        }
      }
    }
    document.title = `RUN t=${time.toFixed(1)}s road=${st.onRoad} rem=${st.remaining.join('/')} | ${st.buses.join(' ')}`;
    setTimeout(step, 16);
  };
  setTimeout(step, 100);
}
