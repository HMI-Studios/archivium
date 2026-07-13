import type { DocSelection } from "./hooks/useProvider";

export const HTTP_INSUFFICIENT_STORAGE = 507;

// TODO this is duplicated from helpers.pug
export const capitalize = (str: string) => str[0]?.toUpperCase() + str.substr(1,str.length-1);
export const formatDate = (date: Date, intervalOnly=false, short=false) => {
  if (!date) return;
  const now = new Date();
  const secondsAgo = (now.getTime() - date.getTime()) / 1000;
  if (secondsAgo < 0) {
    //- Future Dates
    const secondsUntil = (date.getTime() - now.getTime()) / 1000;
    if (secondsUntil < 60) return `in ${Math.round(secondsUntil)} second${Math.round(secondsUntil) === 1 ? '' : 's'}`;
    const minutesUntil = secondsUntil / 60;
    if (minutesUntil < 60) return `in ${Math.round(minutesUntil)} minute${Math.round(minutesUntil) === 1 ? '' : 's'}`;
    const hoursUntil = minutesUntil / 60;
    if (hoursUntil < 24) return `in ${Math.round(hoursUntil)} hour${Math.round(hoursUntil) === 1 ? '' : 's'}`;
    const daysUntil = hoursUntil / 24;
    if (daysUntil < 30) return `in ${Math.round(daysUntil)} day${Math.round(daysUntil) === 1 ? '' : 's'}`;
    if (intervalOnly) {
      const weeksUntil = daysUntil / 7;
      if (Math.round(weeksUntil) < 8) return `in ${Math.round(weeksUntil)} week${Math.round(weeksUntil) === 1 ? '' : 's'}`;
      const monthDiff = now.getMonth() - date.getMonth();
      const yearDiff = now.getFullYear() - date.getFullYear();
      if (yearDiff === 0) {
        return `in ${monthDiff} months`;
      } else if (yearDiff === 1) {
        if (monthDiff < 0) return `in ${monthDiff + 12} months`;
        else return 'next year';
      } else {
        const yearsUntil = yearDiff - (monthDiff < 0 ? 1 : 0);
        if (yearsUntil === 1) return 'next year';
        else return `${yearsUntil} years ago`;
      }
    }
  } else {
    //- Past Dates
    if (secondsAgo < 60) return `${Math.round(secondsAgo)} second${Math.round(secondsAgo) === 1 ? '' : 's'} ago`;
    const minutesAgo = secondsAgo / 60;
    if (minutesAgo < 60) return `${Math.round(minutesAgo)} minute${Math.round(minutesAgo) === 1 ? '' : 's'} ago`;
    const hoursAgo = minutesAgo / 60;
    if (hoursAgo < 24) return `${Math.round(hoursAgo)} hour${Math.round(hoursAgo) === 1 ? '' : 's'} ago`;
    const daysAgo = hoursAgo / 24;
    if (daysAgo < 30) return `${Math.round(daysAgo)} day${Math.round(daysAgo) === 1 ? '' : 's'} ago`;
    if (intervalOnly) {
      const weeksAgo = daysAgo / 7;
      if (Math.round(weeksAgo) < 8) return `${Math.round(weeksAgo)} week${Math.round(weeksAgo) === 1 ? '' : 's'} ago`;
      const monthDiff = now.getMonth() - date.getMonth();
      const yearDiff = now.getFullYear() - date.getFullYear();
      if (yearDiff === 0) {
        return `${monthDiff} months ago`;
      } else if (yearDiff === 1) {
        if (monthDiff < 0) return `${monthDiff + 12} months ago`;
        else return 'last year';
      } else {
        const yearsAgo = yearDiff - (monthDiff < 0 ? 1 : 0);
        if (yearsAgo === 1) return 'last year';
        else return `${yearsAgo} years ago`;
      }
    }
  }

  if (short) return `${date.toDateString()} ${date.toLocaleTimeString()}`;
  else return `on ${date.toDateString()} at ${date.toLocaleTimeString()}`;
};

export function sprintf(format: string, ...args: string[]): string {
  let i = 0;
  return format.replace(/%s/g, () => args[i++]);
}

export function T(str: string, ...args: string[]): string {
// return sprintf(locale[lang][str] ?? str, ...args);
  return sprintf(str, ...args);
}

export async function postFormData(url: string, data: { [key: string]: any }) {
  const formData = new FormData();
  for (const key in data) {
    formData.append(key, data[key]);
  }
  return await fetch(url, {
    method: 'POST',
    body: formData,
  });
}

export function debounce(id: NodeJS.Timeout | null, func: () => void, timeout: number) {
  if (id) {
    clearTimeout(id);
  }

  return setTimeout(func, timeout);
}

export async function fetchAsync(url: string): Promise<any> {
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data;
}

export async function fetchData(url: string, setter: (value: any) => Promise<void> | void): Promise<any> {
  const data = await fetchAsync(url);
  await setter(data);
}

export class BulkExistsFetcher {
  data: { [universe: string]: string[] } = {};
  resolvers: { [key: string]: (exists: boolean) => void } = {};
  promises: { [key: string]: Promise<boolean> } = {};

  exists(universe: string, item: string): Promise<boolean> {
    if (`${universe}/${item}` in this.promises) return this.promises[`${universe}/${item}`];
    if (!(universe in this.data)) this.data[universe] = [];
    const promise = new Promise<boolean>(async (resolve) => {
      this.data[universe].push(item);
      this.resolvers[`${universe}/${item}`] = resolve;
    });
    this.promises[`${universe}/${item}`] = promise;
    return promise;
  }

  async fetchAll() {
    const result = await (await fetch('/api/exists', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(this.data),
    })).json();
    for (const universe in result) {
      for (const item in result[universe]) {
        this.resolvers[`${universe}/${item}`](result[universe][item] as boolean);
      }
    }
  }
}

export function handleFormBlur(relatedTarget: HTMLElement | null, setAwareness: (data: Partial<DocSelection>) => void): void {
  if (relatedTarget && 'selectionControlled' in relatedTarget.dataset) {
    return;
  }

  setAwareness({ selectedElement: null });
}
