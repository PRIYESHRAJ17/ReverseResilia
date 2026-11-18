const istFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const utcFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

let isUtc = false;

export function startClock(el) {
  if (!el) return;
  const tick = () => {
    const fmt = isUtc ? utcFormat : istFormat;
    const loc = isUtc ? 'UTC' : 'BENGALURU, IN';
    el.textContent = `${loc}_${fmt.format(new Date())}`;
  };

  el.style.cursor = 'pointer';
  el.title = 'Click to toggle IST (Bengaluru) / UTC operations clock';
  el.addEventListener('click', () => {
    isUtc = !isUtc;
    tick();
  });

  tick();
  setInterval(tick, 1000);
}
