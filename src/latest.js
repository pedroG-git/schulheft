// Für Eingaben, die den Server fragen (Suche): erst nach einer kurzen Tipp-Pause anfragen,
// die alte Anfrage abbrechen und nur das Ergebnis der neuesten Eingabe liefern.
// Ergebnis: { value } bzw. { error }; null, wenn inzwischen eine neuere Eingabe kam.
export function latestOnly(fn, delay = 180, timers = globalThis) {
  let timer = null, ctrl = null, pending = null, seq = 0;
  const drop = () => {
    timers.clearTimeout(timer); timer = null;
    ctrl?.abort(); ctrl = null;
    pending?.(null); pending = null;
  };
  const run = (...args) => {
    drop();
    const my = ++seq;
    return new Promise(resolve => {
      pending = resolve;
      timer = timers.setTimeout(async () => {
        timer = null;
        const c = ctrl = new AbortController();
        let out;
        try { out = { value: await fn(...args, c.signal) }; } catch (error) { out = { error }; }
        if (my !== seq || c.signal.aborted) return;   // längst überholt (drop hat schon null geliefert)
        ctrl = null; pending = null;
        resolve(out);
      }, delay);
    });
  };
  run.cancel = () => { seq++; drop(); };
  return run;
}
