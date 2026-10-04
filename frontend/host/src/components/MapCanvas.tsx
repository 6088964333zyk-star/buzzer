// HTML <canvas> map for map_pin questions (docs/design-t7-map-question.md D4).
// The same file is copied into the host and admin apps (separate Vite builds);
// keep the copies identical.
import { useCallback, useEffect, useRef } from 'react';
import { MAP_URL, type MapPoint } from '../lib/mapPin';

export interface MapDot { point: MapPoint; count: number }

interface Props {
  aspectRatio: number;
  /** The player's (or editor's) pin. */
  point?: MapPoint | null;
  /** Called with image fractions when the user taps; omit for read-only. */
  onPoint?: (p: MapPoint) => void;
  target?: MapPoint | null;
  /** Radii in map-width units, drawn around the target. */
  fullRadius?: number;
  zeroRadius?: number;
  dots?: MapDot[];
  className?: string;
}

let mapImage: HTMLImageElement | null = null;
const waiting = new Set<() => void>();

/** Load the map once per page; redraw every canvas when it arrives (Goldfish J). */
function useMapImage(onReady: () => void) {
  useEffect(() => {
    if (!mapImage) {
      mapImage = new Image();
      mapImage.onload = () => waiting.forEach((cb) => cb());
      mapImage.src = MAP_URL;
    }
    waiting.add(onReady);
    return () => { waiting.delete(onReady); };
  }, [onReady]);
}

export function MapCanvas({
  aspectRatio, point, onPoint, target, fullRadius, zeroRadius, dots, className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Size from config.aspectRatio, never the image's natural size (Goldfish I).
    const cssWidth = canvas.clientWidth;
    const cssHeight = cssWidth / aspectRatio;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    if (mapImage?.complete && mapImage.naturalWidth > 0) {
      ctx.drawImage(mapImage, 0, 0, cssWidth, cssHeight);
    } else {
      ctx.fillStyle = '#cfe3f2';
      ctx.fillRect(0, 0, cssWidth, cssHeight);
    }

    const px = (p: MapPoint) => [p.x * cssWidth, p.y * cssHeight] as const;

    if (target) {
      const [tx, ty] = px(target);
      // Radii are in map-width units, so they scale with the canvas width.
      for (const [r, fill] of [[zeroRadius, 'rgba(250,204,21,0.15)'], [fullRadius, 'rgba(34,197,94,0.3)']] as const) {
        if (r) {
          ctx.beginPath();
          ctx.arc(tx, ty, r * cssWidth, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.fill();
        }
      }
    }

    if (dots?.length) {
      const max = Math.max(...dots.map((d) => d.count));
      for (const d of dots) {
        const [x, y] = px(d.point);
        ctx.beginPath();
        ctx.arc(x, y, 3 + 6 * Math.min(1, d.count / max), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99,102,241,0.75)';
        ctx.fill();
      }
    }

    const pin = (p: MapPoint, color: string) => {
      const [x, y] = px(p);
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    };
    if (target) pin(target, '#16a34a');
    if (point) pin(point, '#dc2626');
  }, [aspectRatio, point, target, fullRadius, zeroRadius, dots]);

  useMapImage(draw);
  useEffect(() => {
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [draw]);

  function handlePointer(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!onPoint) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    onPoint({
      x: clamp((e.clientX - rect.left) / rect.width),
      y: clamp((e.clientY - rect.top) / rect.height),
    });
  }

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointer}
      className={`w-full rounded-lg touch-none ${onPoint ? 'cursor-crosshair' : ''} ${className ?? ''}`}
    />
  );
}
