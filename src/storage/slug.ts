// Title → file slug generation with collision handling

/**
 * Core slug transformation: convert text to URL-safe format.
 * Lowercase, replace spaces/special chars with hyphens, remove consecutive
 * hyphens, strip leading/trailing hyphens.
 */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      // Replace spaces and special characters with hyphens
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s]+/g, '-')
      // Remove consecutive hyphens
      .replace(/-{2,}/g, '-')
      // Strip leading/trailing hyphens
      .replace(/^-|-$/g, '')
  );
}

/**
 * Generate a URL-safe slug from a title.
 * Converts title to lowercase, replaces spaces and special chars with hyphens,
 * removes consecutive hyphens, strips leading/trailing hyphens.
 */
export function generateSlug(title: string, maxLength: number = 80): string {
  const slug = slugify(title);

  // Trim to max length
  if (slug.length > maxLength) {
    // Try to break at a word boundary
    const trimmed = slug.substring(0, maxLength);
    return trimmed.replace(/-+$/, '');
  }

  return slug;
}

/**
 * Generate a file path for a new note.
 * For 'flat': {slug}.md
 * For 'by-type': {type}/{slug}.md
 * Handles collisions by appending -1, -2, etc.
 */
export function generateFilePath(
  title: string,
  type: string,
  strategy: 'flat' | 'by-type' = 'flat',
  existingPaths: Set<string>,
): string {
  const slug = generateSlug(title);

  let basePath: string;
  if (strategy === 'by-type') {
    basePath = `${type}/${slug}.md`;
  } else {
    basePath = `${slug}.md`;
  }

  // Check for collision
  if (!existingPaths.has(basePath)) {
    return basePath;
  }

  // Collision detected — append counters until we find a unique path
  let counter = 1;
  while (true) {
    let candidatePath: string;
    if (strategy === 'by-type') {
      candidatePath = `${type}/${slug}-${counter}.md`;
    } else {
      candidatePath = `${slug}-${counter}.md`;
    }

    if (!existingPaths.has(candidatePath)) {
      return candidatePath;
    }

    counter++;
  }
}
