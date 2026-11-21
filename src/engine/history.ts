import type { DocumentModel } from './types';

/** Keep newest snapshots and count shared immutable image strings only once. */
export function limitHistory(
  entries: DocumentModel[],
  maxEntries = 50,
  maxImageBytes = 96 * 1024 * 1024,
): DocumentModel[] {
  const seen = new Set<string>();
  const kept: DocumentModel[] = [];
  let bytes = 0;
  for (let index = entries.length - 1; index >= 0 && kept.length < maxEntries; index--) {
    const entry = entries[index];
    const images = entry.objects.flatMap((object) =>
      object.kind === 'image' ? [object.pixels, object.original] : [],
    );
    const unique = [...new Set(images.filter((source) => !seen.has(source)))];
    const additionalBytes = unique.reduce((total, source) => total + source.length * 2, 0);
    if (kept.length > 0 && bytes + additionalBytes > maxImageBytes) break;
    kept.push(entry);
    bytes += additionalBytes;
    unique.forEach((source) => seen.add(source));
  }
  return kept.reverse();
}
