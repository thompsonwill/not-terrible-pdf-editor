// Small stroke icon set (24×24, 2px strokes).
const P: Record<string, string> = {
  open: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  save: "M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v5h8V3M7 21v-7h10v7",
  saveas: "M5 3h11l3 3v6M7 3v5h8V3M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2M15 19h6M18 16v6",
  undo: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  redo: "m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  select: "M5 3l14 7-6 2-2 6z",
  edittext: "M4 7V5h12v2M10 5v14M7 19h6M15 13l4-4 2 2-4 4h-2z",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  note: "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6l-4 4v-4H6a2 2 0 0 1-2-2z",
  highlight: "m9 11-6 6v3h3l6-6M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4",
  underline: "M6 4v6a6 6 0 0 0 12 0V4M4 20h16",
  strike: "M16 4H9a3 3 0 0 0-2.8 4M14 12a4 4 0 0 1 0 8H6M4 12h16",
  pen: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  rect: "M4 5h16v14H4z",
  ellipse: "M12 5c4.97 0 9 3.13 9 7s-4.03 7-9 7-9-3.13-9-7 4.03-7 9-7z",
  line: "M5 19 19 5",
  arrow: "M5 19 19 5M10 5h9v9",
  polygon: "m12 3 9 7-3.5 10h-11L3 10z",
  signature: "M3 17c3-1 4-8 6-8s0 8 2 8 3-4 4-4 1 3 3 3 2-1 3-1M3 21h18",
  image: "M4 4h16v16H4zM4 16l5-5 4 4 2-2 5 5M15.5 8.5h.01",
  whiteout: "M7 21h10M5 3h14v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z",
  redact: "M3 6h18v5H3zM3 15h8M15 15h6M3 19h12",
  zoomin: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M8 11h6M11 8v6",
  zoomout: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M8 11h6",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
  up: "m6 15 6-6 6 6",
  down: "m6 9 6 6 6-6",
  close: "M6 6l12 12M18 6 6 18",
  sidebar: "M4 4h16v16H4zM9 4v16",
  panel: "M4 4h16v16H4zM15 4v16",
  rotl: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  rotr: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3",
  plus: "M12 5v14M5 12h14",
  merge: "M8 3h8l4 4v10M4 7h10l4 4v10H4zM11 12v6M8 15h6",
  extract: "M14 3h5v5M10 14 19 5M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  check: "M5 12l5 5L20 7",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  bold: "M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z",
  italic: "M10 4h9M5 20h9M15 4 9 20",
};

export function Icon({ name, size = 18 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={P[name] ?? ""} />
    </svg>
  );
}
