"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RepoCloneError = exports.createReferenceClone = exports.normalizeGitUrl = exports.RepoIndexQuery = exports.loadRepoIndex = exports.saveRepoIndex = exports.scan = exports.Registry = exports.ForgeCore = void 0;
// Core
var core_js_1 = require("./core.js");
Object.defineProperty(exports, "ForgeCore", { enumerable: true, get: function () { return core_js_1.ForgeCore; } });
var registry_js_1 = require("./registry/registry.js");
Object.defineProperty(exports, "Registry", { enumerable: true, get: function () { return registry_js_1.Registry; } });
// Models
__exportStar(require("./models/index.js"), exports);
// Adapters
__exportStar(require("./adapters/index.js"), exports);
// Resolver
__exportStar(require("./resolver/index.js"), exports);
// Workspace
__exportStar(require("./workspace/index.js"), exports);
// Compiler
__exportStar(require("./compiler/index.js"), exports);
// Global Config
__exportStar(require("./config/index.js"), exports);
// Repo Scanner & Index
var repo_scanner_js_1 = require("./repo/repo-scanner.js");
Object.defineProperty(exports, "scan", { enumerable: true, get: function () { return repo_scanner_js_1.scan; } });
var repo_index_store_js_1 = require("./repo/repo-index-store.js");
Object.defineProperty(exports, "saveRepoIndex", { enumerable: true, get: function () { return repo_index_store_js_1.saveRepoIndex; } });
Object.defineProperty(exports, "loadRepoIndex", { enumerable: true, get: function () { return repo_index_store_js_1.loadRepoIndex; } });
var repo_index_query_js_1 = require("./repo/repo-index-query.js");
Object.defineProperty(exports, "RepoIndexQuery", { enumerable: true, get: function () { return repo_index_query_js_1.RepoIndexQuery; } });
var url_utils_js_1 = require("./repo/url-utils.js");
Object.defineProperty(exports, "normalizeGitUrl", { enumerable: true, get: function () { return url_utils_js_1.normalizeGitUrl; } });
var repo_clone_js_1 = require("./repo/repo-clone.js");
Object.defineProperty(exports, "createReferenceClone", { enumerable: true, get: function () { return repo_clone_js_1.createReferenceClone; } });
Object.defineProperty(exports, "RepoCloneError", { enumerable: true, get: function () { return repo_clone_js_1.RepoCloneError; } });
//# sourceMappingURL=index.js.map