/**
 * Manages fenced sections in ~/.claude/CLAUDE.md for globally installed plugins.
 *
 * Each plugin gets a section delimited by:
 *   <!-- forge:global:{pluginId}:start -->
 *   ...content...
 *   <!-- forge:global:{pluginId}:end -->
 *
 * This allows multiple plugins to coexist and be independently updated/removed.
 */
/**
 * Insert or replace a managed section in CLAUDE.md content.
 *
 * - If the fenced section already exists, replaces its content.
 * - If not found, appends the section at the end.
 * - Handles empty or undefined input content.
 *
 * @param existingContent - Current file content (may be empty or undefined)
 * @param pluginId - Plugin identifier for the fence markers
 * @param sectionContent - The content to place between fences
 * @returns Updated file content
 */
export declare function upsertManagedSection(existingContent: string | undefined, pluginId: string, sectionContent: string): string;
/**
 * Remove a managed section from CLAUDE.md content.
 *
 * @param existingContent - Current file content
 * @param pluginId - Plugin identifier for the fence markers
 * @returns Updated file content with section removed
 */
export declare function removeManagedSection(existingContent: string, pluginId: string): string;
//# sourceMappingURL=claude-md-writer.d.ts.map