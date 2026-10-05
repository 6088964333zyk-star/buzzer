// A game's image library: upload, view, replace and delete (docs/design-t8-images.md
// D5). Copied into the admin app (separate Vite builds); keep the copies identical.
// `prefix` is '/host' or '/admin'; the server enforces who may do what.
import { useRef, useState } from 'react';
import { Upload, Replace, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { imageUrl, type GameImage } from '../lib/images';
import { Button } from './ui/button';

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

function formData(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

export function ImageLibrary({
  prefix,
  gameId,
  images,
  onChanged,
}: {
  prefix: '/host' | '/admin';
  gameId: string | number;
  images: GameImage[];
  /** Reload the list (and anything that shows images) after a change. */
  onChanged: () => Promise<void> | void;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  function upload(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    void run(async () => {
      for (const file of list) {
        await api.postForm(`${prefix}/games/${gameId}/images`, formData(file));
      }
    });
  }

  function replace(img: GameImage, file: File | undefined) {
    if (!file) return;
    void run(() => api.putForm(`${prefix}/images/${img.id}`, formData(file)));
  }

  function remove(img: GameImage) {
    if (!confirm(`Delete ${img.filename}?`)) return;
    void run(() => api.delete(`${prefix}/images/${img.id}`));
  }

  return (
    <div className="rounded-xl border border-border bg-surface/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-fg">Images</h3>
          <p className="text-xs text-fg-subtle">
            PNG, JPEG, GIF or WebP, up to 2 MB. Use large, clear, high-contrast images.
          </p>
        </div>
        <input
          ref={uploadRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => { upload(e.target.files); e.target.value = ''; }}
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => uploadRef.current?.click()}>
          <Upload size={14} className="mr-1" /> {busy ? 'Working…' : 'Upload'}
        </Button>
      </div>

      {error && <p className="text-danger-fg text-sm">{error}</p>}

      {images.length === 0 ? (
        <p className="text-fg-subtle text-sm">No images yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {images.map((img) => (
            <div key={img.id} className="rounded-lg border border-border bg-bg/60 p-2 space-y-1">
              <a href={imageUrl(img.id, img.sha256)} target="_blank" rel="noopener noreferrer">
                <img
                  src={imageUrl(img.id, img.sha256)}
                  alt={img.filename}
                  className="w-full h-24 object-contain rounded bg-bg"
                />
              </a>
              <p className="text-xs text-fg truncate" title={img.filename}>{img.filename}</p>
              <p className="text-[11px] text-fg-subtle">
                {img.width}×{img.height} · {Math.max(1, Math.round(img.size_bytes / 1024))} KB
              </p>
              <p className="text-[11px] text-fg-subtle">
                {img.used_by.length > 0 ? `Used by Q${img.used_by.join(', Q')}` : 'Not used'}
              </p>
              <div className="flex gap-1">
                <label
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-surface-raised cursor-pointer ${busy ? 'pointer-events-none opacity-50' : ''}`}
                  title="Replace with another file (keeps every question that uses it)"
                >
                  <Replace size={12} /> Replace
                  <input
                    type="file"
                    accept={IMAGE_ACCEPT}
                    className="hidden"
                    onChange={(e) => { replace(img, e.target.files?.[0]); e.target.value = ''; }}
                  />
                </label>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(img)} title="Delete">
                  <Trash2 size={12} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
