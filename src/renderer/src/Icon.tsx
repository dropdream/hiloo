import type { SVGProps } from 'react'

const paths = {
  open: 'M3 7h6l2 2h10l-3 10H3V7Zm0 0V4h6l2 3h7v2',
  save: 'M5 3h12l3 3v15H4V3h1Zm3 0v6h8V3M8 21v-8h8v8',
  copy: 'M9 8V3h8l3 3v12h-5M9 3v5h6v13H4V8h5Zm6 0v5h5',
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
  check: 'm5 12 4 4L19 6'
} as const

export type IconName = keyof typeof paths
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>
}
