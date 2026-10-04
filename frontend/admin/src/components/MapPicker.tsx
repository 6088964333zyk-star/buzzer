// Editor control for map_pin questions: click the map to set the target, set
// the two scoring radii, and preview them as circles. Copied into the admin app
// (separate Vite builds); keep the copies identical.
// docs/design-t7-map-question.md, D2 / D5; T8 D7: any image can be the map.
import { MapCanvas } from './MapCanvas';
import { Input } from './ui/input';
import type { MapPoint } from '../lib/mapPin';

export interface MapPickerValue {
  target: MapPoint | null;
  fullRadius: number;
  zeroRadius: number;
}

export function MapPicker({
  value,
  onChange,
  imageUrl = null,
  aspectRatio = 2,
}: {
  value: MapPickerValue;
  /** Map image; null means the built-in world map (aspect 2). */
  imageUrl?: string | null;
  aspectRatio?: number;
  onChange: (v: MapPickerValue) => void;
}) {
  const radiiOk = 0 <= value.fullRadius && value.fullRadius < value.zeroRadius && value.zeroRadius <= 1;
  return (
    <div className="space-y-3">
      <label className="block text-xs text-slate-400">
        Click the map to set the correct location
        {value.target && (
          <span className="ml-2 text-slate-500">
            ({(value.target.x * 100).toFixed(1)}%, {(value.target.y * 100).toFixed(1)}%)
          </span>
        )}
      </label>
      <MapCanvas
        aspectRatio={aspectRatio}
        imageUrl={imageUrl}
        target={value.target}
        fullRadius={value.fullRadius}
        zeroRadius={value.zeroRadius}
        onPoint={(target) => onChange({ ...value, target })}
      />
      <div className="flex gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Full points within (% of map width)</label>
          <Input
            type="number"
            step="0.5"
            min="0"
            value={+(value.fullRadius * 100).toFixed(2)}
            onChange={(e) => onChange({ ...value, fullRadius: Number(e.target.value) / 100 })}
            className="w-28 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Zero points beyond (% of map width)</label>
          <Input
            type="number"
            step="0.5"
            min="0"
            max="100"
            value={+(value.zeroRadius * 100).toFixed(2)}
            onChange={(e) => onChange({ ...value, zeroRadius: Number(e.target.value) / 100 })}
            className="w-28 text-sm"
          />
        </div>
      </div>
      {!radiiOk && (
        <p className="text-red-400 text-xs">The "full points" radius must be smaller than the "zero points" radius.</p>
      )}
      <p className="text-slate-500 text-xs">
        Green circle: full points. Yellow ring: partial points, falling to zero at its edge.
      </p>
    </div>
  );
}
