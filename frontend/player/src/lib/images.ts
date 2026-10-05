// Public image URLs (docs/design-t8-images.md D2). Copied into the host, player
// and admin apps; keep the copies identical.

/** Image stored in the database; `version` (the image's sha256) busts caches after a replace. */
export function imageUrl(id: string, version?: string): string {
  return version ? `/api/images/${id}?v=${version}` : `/api/images/${id}`;
}

/** What GET /api/{host,admin}/games/{id}/images returns (bytes not included). */
export interface GameImage {
  id: string;
  game_id: number;
  filename: string;
  mime: string;
  width: number;
  height: number;
  size_bytes: number;
  sha256: string;
  updated_at: string | null;
  /** 1-based positions of the questions that use it. */
  used_by: number[];
}
