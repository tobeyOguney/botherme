export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Lowercase, ASCII-fold, replace runs of non-alphanumerics with hyphens, trim.
 * Stable across calls — slugify(slugify(x)) === slugify(x).
 *
 * Does NOT throw on empty results; the caller is responsible for length checks.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks (accents)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function isValidSlug(s: string): boolean {
  return SLUG_PATTERN.test(s);
}
