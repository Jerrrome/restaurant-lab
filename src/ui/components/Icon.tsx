import type { CSSProperties } from 'react';

const paths: Record<string, string> = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  people:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  menu: 'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5',
  chart: 'M4 19h16 M6 15V9 M12 15V4 M18 15v-4',
  play: 'M8 5l12 7-12 7z',
  pause: 'M8 5v14 M16 5v14',
  reset: 'M3 10a9 9 0 1 1 2.64 8.36 M3 4v6h6',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2z M7 3v6h10V3 M7 21v-8h10v8',
  load: 'M3 7h7l2 2h9v11H3z M3 7V4h7l2 3',
  fridge: 'M6 3h12v18H6z M6 10h12 M9 6v2 M9 13v4',
  prep: 'M3 6h18v10H3z M5 16v5 M19 16v5 M8 10h8',
  stove: 'M3 5h18v15H3z M8 10a2 2 0 1 0 0 .01 M16 10a2 2 0 1 0 0 .01 M6 17h12',
  fryer: 'M4 8h16v12H4z M7 11h10v6H7z M10 8V3h5',
  rice: 'M5 9h14v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z M3 9h18 M8 6V3 M12 6V3 M16 6V3',
  sink: 'M3 11h18v8H3z M12 11V5a3 3 0 0 1 6 0 M5 21v-2 M19 21v-2',
  serving: 'M3 16h18 M5 16a7 7 0 0 1 14 0 M12 9V6 M4 20h16',
  storage: 'M4 3v18 M20 3v18 M4 8h16 M4 14h16 M4 20h16 M7 4h4 M14 10h3',
  table: 'M3 8h18v8H3z M6 16v5 M18 16v5 M7 3v5 M17 3v5',
  checkout: 'M5 11h14v9H5z M8 4h8v7H8z M8 16h8 M11 7h2',
  restroom: 'M5 3h14v18H5z M9 7h6 M9 11h6 M9 15h6',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M12 6v6l4 2',
  close: 'M6 6l12 12 M18 6 6 18',
  flask: 'M9 3h6 M10 3v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3 M7 15h10',
  move: 'M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3',
  trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  rotate: 'M20 10a8 8 0 1 0-2 8 M20 4v6h-6',
  check: 'M5 12l4 4L19 6',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M12 11v6 M12 7h.01',
};

export function Icon({
  name,
  size = 18,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.grid} />
    </svg>
  );
}
