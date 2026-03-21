"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertManagedSection = upsertManagedSection;
exports.removeManagedSection = removeManagedSection;
function startFence(pluginId) {
    return `<!-- forge:global:${pluginId}:start -->`;
}
function endFence(pluginId) {
    return `<!-- forge:global:${pluginId}:end -->`;
}
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
function upsertManagedSection(existingContent, pluginId, sectionContent) {
    const start = startFence(pluginId);
    const end = endFence(pluginId);
    const block = `${start}\n${sectionContent}\n${end}`;
    const content = existingContent ?? '';
    const startIdx = content.indexOf(start);
    const endIdx = content.indexOf(end);
    if (startIdx !== -1 && endIdx !== -1) {
        // Replace existing section
        const before = content.slice(0, startIdx);
        const after = content.slice(endIdx + end.length);
        return `${before}${block}${after}`;
    }
    // Append — add a blank line separator if file has existing content
    if (content.length > 0 && !content.endsWith('\n')) {
        return `${content}\n\n${block}\n`;
    }
    if (content.length > 0) {
        return `${content}\n${block}\n`;
    }
    return `${block}\n`;
}
/**
 * Remove a managed section from CLAUDE.md content.
 *
 * @param existingContent - Current file content
 * @param pluginId - Plugin identifier for the fence markers
 * @returns Updated file content with section removed
 */
function removeManagedSection(existingContent, pluginId) {
    const start = startFence(pluginId);
    const end = endFence(pluginId);
    const startIdx = existingContent.indexOf(start);
    const endIdx = existingContent.indexOf(end);
    if (startIdx === -1 || endIdx === -1) {
        // Section not found — return as-is
        return existingContent;
    }
    const before = existingContent.slice(0, startIdx);
    const after = existingContent.slice(endIdx + end.length);
    // Clean up extra blank lines left behind
    const result = (before + after).replace(/\n{3,}/g, '\n\n').trim();
    return result.length > 0 ? result + '\n' : '';
}
//# sourceMappingURL=claude-md-writer.js.map