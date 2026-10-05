// Pick one image from the game's library, or none (docs/design-t8-images.md Step 6).
// Copied into the admin app (separate Vite builds); keep the copies identical.
import { useState } from 'react';
import { ImageIcon, X } from 'lucide-react';
import { imageUrl, type GameImage } from '../lib/images';

export function ImagePicker({
  images,
  value,
  onChange,
  label = 'Image',
}: {
  images: GameImage[];
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = value ? images.find((i) => i.id === value) : undefined;

  return (
    <div className="relative inline-block">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
          title={label}
        >
          {current ? (
            <img src={imageUrl(current.id, current.sha256)} alt={current.filename} className="h-8 w-8 object-cover rounded" />
          ) : value ? (
            // Referenced but not in the list (e.g. deleted elsewhere); the server will say so on save.
            <span className="text-amber-300">missing image</span>
          ) : (
            <ImageIcon size={16} />
          )}
          <span>{current ? 'Change' : label}</span>
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-slate-500 hover:text-slate-200"
            title="Remove image"
            aria-label="Remove image"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-20 mt-1 w-72 rounded-lg border border-slate-600 bg-slate-900 p-2 shadow-xl">
          {images.length === 0 ? (
            <p className="text-xs text-slate-400 p-2">Upload images in the Images panel first.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 max-h-56 overflow-y-auto">
              {images.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => { onChange(img.id); setOpen(false); }}
                  className={`rounded border p-0.5 ${img.id === value ? 'border-indigo-400' : 'border-slate-700 hover:border-slate-500'}`}
                  title={img.filename}
                >
                  <img src={imageUrl(img.id, img.sha256)} alt={img.filename} className="h-14 w-full object-cover rounded" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
