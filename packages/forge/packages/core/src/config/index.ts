export {
  loadGlobalConfig,
  saveGlobalConfig,
  addGlobalRegistry,
  removeGlobalRegistry,
  ensureDefaultRegistries,
  DEFAULT_LOCAL_REGISTRY,
  DEFAULT_GLOBAL_REGISTRY,
  GLOBAL_CONFIG_DIR,
  GLOBAL_CONFIG_PATH,
} from './global-config-loader.js';

export {
  expandPath,
  expandPaths,
} from './path-utils.js';
