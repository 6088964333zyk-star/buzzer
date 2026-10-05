// HTML <canvas> map for map_pin questions (docs/design-t7-map-question.md D4).
// T8 (docs/design-t8-images.md D7): any uploaded image can replace the world map.
// The same file is copied into the host, player and admin apps (separate Vite
// builds); keep the copies identical.
import { useCallback, useEffect, useRef } from 'react';
import { MAP_URL, type MapPoint } from '../lib/mapPin';
import { cssColor, onThemeChange } from '../lib/theme';

export interface MapDot { point: MapPoint; count: number }

interface Props {
  aspectRatio: number;
  /** Background image; omit for the built-in world map. */
  imageUrl?: string | null;
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

// One <img> per URL for the whole page; every canvas redraws when one arrives
// (Goldfish J). Editors put ?v=<sha256> in the URL, so a replaced image is a
// new entry (T8 Goldfish 2).
const images = new Map<string, HTMLImageElement>();
const waiting = new Set<() => void>();

function loadImage(url: string): HTMLImageElement {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.onload = () => waiting.forEach((cb) => cb());
    img.src = url;
    images.set(url, img);
  }
  return img;
}

function useRedrawOnLoad(onReady: () => void) {
  useEffect(() => {
    waiting.add(onReady);
    return () => { waiting.delete(onReady); };
  }, [onReady]);
}

/** Tall images would fill the page; cap the height and narrow the canvas. */
const MAX_HEIGHT_FRACTION = 0.7;

export function MapCanvas({
  aspectRatio, imageUrl, point, onPoint, target, fullRadius, zeroRadius, dots, className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Size from config.aspectRatio, never the image's natural size (Goldfish I).
    const available = canvas.parentElement?.clientWidth ?? canvas.clientWidth;
    const cssWidth = Math.min(available, window.innerHeight * MAX_HEIGHT_FRACTION * aspectRatio);
    const cssHeight = cssWidth / aspectRatio;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const background = loadImage(imageUrl || MAP_URL);
    if (background.complete && background.naturalWidth > 0) {
      ctx.drawImage(background, 0, 0, cssWidth, cssHeight);
    } else {
      ctx.fillStyle = cssColor('map-water');
      ctx.fillRect(0, 0, cssWidth, cssHeight);
    }

    const px = (p: MapPoint) => [p.x * cssWidth, p.y * cssHeight] as const;

    if (target) {
      const [tx, ty] = px(target);
      // Radii are in map-width units, so they scale with the canvas width.
      // Colors are theme tokens, read at draw time (T9 design T4).
      for (const [r, fill] of [[zeroRadius, cssColor('warning', 0.15)], [fullRadius, cssColor('success', 0.3)]] as const) {
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
        ctx.fillStyle = cssColor('accent', 0.75);
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
      ctx.strokeStyle = cssColor('surface');
      ctx.stroke();
    };
    if (target) pin(target, cssColor('success'));
    if (point) pin(point, cssColor('danger'));
  }, [aspectRatio, imageUrl, point, target, fullRadius, zeroRadius, dots]);

  useRedrawOnLoad(draw);
  useEffect(() => {
    draw();
    window.addEventListener('resize', draw);
    const unsubscribe = onThemeChange(draw);
    return () => {
      window.removeEventListener('resize', draw);
      unsubscribe();
    };
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
      className={`block mx-auto max-w-full rounded-lg touch-none ${onPoint ? 'cursor-crosshair' : ''} ${className ?? ''}`}
    />
  );
}
