// Initialize Anvil vault structure — called by `anvil init`

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Initialize an Anvil vault at the given path.
 * Creates .anvil/types/ with default type YAMLs, .anvil/.local/, .anvil/config.yaml, .gitignore
 */
export async function initVault(vaultPath: string): Promise<void> {
  // Get the defaults directory
  const defaultsDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'defaults'
  );

  // Create .anvil/types/ directory
  const typesDir = path.join(vaultPath, '.anvil', 'types');
  await fs.mkdir(typesDir, { recursive: true });

  // Copy all YAML files from defaults/ to .anvil/types/
  const defaultFiles = await fs.readdir(defaultsDir);
  for (const file of defaultFiles) {
    if (file.endsWith('.yaml')) {
      const src = path.join(defaultsDir, file);
      const dst = path.join(typesDir, file);
      await fs.copyFile(src, dst);
    }
  }

  // Create .anvil/.local/ directory
  const localDir = path.join(vaultPath, '.anvil', '.local');
  await fs.mkdir(localDir, { recursive: true });

  // Create .anvil/config.yaml with defaults
  const configYaml = path.join(vaultPath, '.anvil', 'config.yaml');
  const defaultConfig = `# Anvil vault configuration
# This file is safe to edit

git_remote: origin
sync_interval: 30
ignore_patterns: []
`;
  await fs.writeFile(configYaml, defaultConfig, 'utf-8');

  // Create/update .gitignore to exclude .anvil/.local/
  const gitignorePath = path.join(vaultPath, '.gitignore');
  let gitignoreContent = '';

  try {
    gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
  } catch {
    // File doesn't exist, that's fine
  }

  // Add .anvil/.local/ if not already present
  if (!gitignoreContent.includes('.anvil/.local')) {
    if (gitignoreContent && !gitignoreContent.endsWith('\n')) {
      gitignoreContent += '\n';
    }
    gitignoreContent += '.anvil/.local/\n';
  }

  await fs.writeFile(gitignorePath, gitignoreContent, 'utf-8');
}
