"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expandPaths = exports.expandPath = exports.GLOBAL_CONFIG_PATH = exports.GLOBAL_CONFIG_DIR = exports.removeGlobalRegistry = exports.addGlobalRegistry = exports.saveGlobalConfig = exports.loadGlobalConfig = void 0;
var global_config_loader_js_1 = require("./global-config-loader.js");
Object.defineProperty(exports, "loadGlobalConfig", { enumerable: true, get: function () { return global_config_loader_js_1.loadGlobalConfig; } });
Object.defineProperty(exports, "saveGlobalConfig", { enumerable: true, get: function () { return global_config_loader_js_1.saveGlobalConfig; } });
Object.defineProperty(exports, "addGlobalRegistry", { enumerable: true, get: function () { return global_config_loader_js_1.addGlobalRegistry; } });
Object.defineProperty(exports, "removeGlobalRegistry", { enumerable: true, get: function () { return global_config_loader_js_1.removeGlobalRegistry; } });
Object.defineProperty(exports, "GLOBAL_CONFIG_DIR", { enumerable: true, get: function () { return global_config_loader_js_1.GLOBAL_CONFIG_DIR; } });
Object.defineProperty(exports, "GLOBAL_CONFIG_PATH", { enumerable: true, get: function () { return global_config_loader_js_1.GLOBAL_CONFIG_PATH; } });
var path_utils_js_1 = require("./path-utils.js");
Object.defineProperty(exports, "expandPath", { enumerable: true, get: function () { return path_utils_js_1.expandPath; } });
Object.defineProperty(exports, "expandPaths", { enumerable: true, get: function () { return path_utils_js_1.expandPaths; } });
//# sourceMappingURL=index.js.map