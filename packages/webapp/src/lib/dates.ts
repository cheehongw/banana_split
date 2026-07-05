// Group expenses (or anything with a unix-seconds timestamp) by calendar day,
// with friendly "Today" / "Yesterday" / locale-date labels.

export function dayLabel(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString();
}

export interface DayGroup<T> {
  label: string;
  items: T[];
}

/** Group items (assumed already sorted newest-first) into consecutive day runs. */
export function groupByDay<T>(items: T[], getTime: (item: T) => number): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const label = dayLabel(getTime(item));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
