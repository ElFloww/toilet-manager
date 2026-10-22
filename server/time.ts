const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function parisDay(timestamp: number): string {
  const parts = formatter.formatToParts(timestamp);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

export function nextParisMidnight(now: number): number {
  const day = parisDay(now);
  let low = Math.floor(now);
  let high = low + 27 * 60 * 60 * 1000;
  // Searching the date boundary also handles 23- and 25-hour daylight-saving days.
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (parisDay(middle) === day) low = middle;
    else high = middle;
  }
  return high;
}
