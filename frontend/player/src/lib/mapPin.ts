// map_pin helpers shared by the player pages (docs/design-t7-map-question.md).
// Mirrors backend/app/services/map_pin.py; the server computes points, the
// client only displays distance.

export interface MapPoint { x: number; y: number }

export const MAP_URL = `${import.meta.env.BASE_URL}world-map.svg`;

/** Distance in map-width units; y is divided by the aspect ratio (width / height). */
export function mapDistance(a: MapPoint, b: MapPoint, aspectRatio: number): number {
  return Math.hypot(a.x - b.x, (a.y - b.y) / aspectRatio);
}

export function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** "102:28" answer-distribution key -> point at the cell centre. */
export function cellToPoint(key: string): MapPoint | null {
  const [cx, cy] = key.split(':').map(Number);
  return Number.isFinite(cx) && Number.isFinite(cy) ? { x: cx / 200, y: cy / 100 } : null;
}
