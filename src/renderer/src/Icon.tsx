import type { SVGProps } from 'react'

const paths = {
  open: 'M3 7h6l2 2h10l-3 10H3V7Zm0 0V4h6l2 3h7v2',
  save: 'M5 3h12l3 3v15H4V3h1Zm3 0v6h8V3M8 21v-8h8v8',
  copy: 'M9 8V3h8l3 3v12h-5M9 3v5h6v13H4V8h5Zm6 0v5h5',
  page: 'M5 2h14v20H5V2Zm3 5h8M8 11h8M8 15h5',
  print: 'M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6v-7Zm11-3h1',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7m0-8v16h7a4 4 0 0 0 0-8H7',
  italic: 'M11 4h8M5 20h8M15 4 9 20',
  strike: 'M17 5c-2-2-9-2-9 2 0 2 2 3 4 3M4 12h16M8 18c2 2 9 2 9-2 0-1-1-2-3-3',
  task: 'M3 5h7v7H3V5Zm1 3 2 2 3-4M14 7h7M14 11h7M3 16h7v5H3v-5Zm11 2h7',
  table: 'M3 4h18v16H3V4Zm0 5h18M3 14h18M9 4v16M15 4v16',
  image: 'M3 4h18v16H3V4Zm0 12 6-6 5 5 3-3 4 4M15 8h.1',
  link: 'm10 13 4-4M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  bullet: 'M9 6h11M9 12h11M9 18h11M4 6h.1M4 12h.1M4 18h.1',
  ordered: 'M10 6h10M10 12h10M10 18h10M3 4h1v5M2 9h4M2 14c0-3 4-3 4 0 0 1-4 3-4 5h4',
  quote: 'M5 6h5v7H5v-7Zm0 7v2c0 2 2 3 3 3M14 6h5v7h-5v-7Zm0 7v2c0 2 2 3 3 3',
  undo: 'M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12',
  redo: 'm15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12',
  chevron: 'm8 10 4 4 4-4',
  check: 'm5 12 4 4L19 6',
  sidebar: 'M3 4h18v16H3V4Zm6 0v16M5 8h2M5 12h2',
  search: 'M15 15l6 6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  close: 'm6 6 12 12M6 18 18 6',
  refresh: 'M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3',
  history: 'M3 4v5h5M3 9a9 9 0 1 1 0 6M12 7v5l3 2',
  brain: 'M9 5a3 3 0 1 0-6 1 4 4 0 0 0 0 7 3 3 0 0 0 6 5V5Zm6 0a3 3 0 1 1 6 1 4 4 0 0 1 0 7 3 3 0 0 1-6 5V5ZM6 9h3M15 9h3M6 15h3M15 15h3',
  plus: 'M5 12h14M12 5v14',
  minus: 'M5 12h14',
  fit: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
  info: 'M12 8h.01M11 12h1v5m-1 0h2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  folderPlus: 'M3 7V4h6l2 3h10v13H3V7Zm6 7h6M12 11v6',
  notePlus: 'M14 3H5v18h14V8l-5-5Zm0 0v5h5M9 14h6M12 11v6',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3c0-.4 0-.9-.1-1.3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2.2-1.3L14.3 ' +
      '3h-4l-.4 2.4a7.5 7.5 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 ' +
      '0 2.2 1.3l.4 2.4h4l.4-2.4a7.5 7.5 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z'
} as const

export type IconName = keyof typeof paths
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  )
}
