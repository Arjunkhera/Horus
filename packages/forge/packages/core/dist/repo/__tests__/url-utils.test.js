"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const url_utils_js_1 = require("../url-utils.js");
(0, vitest_1.describe)('normalizeGitUrl', () => {
    (0, vitest_1.it)('converts git@github.com:org/repo.git', () => {
        (0, vitest_1.expect)((0, url_utils_js_1.normalizeGitUrl)('git@github.com:org/repo.git')).toBe('github.com/org/repo');
    });
    (0, vitest_1.it)('converts https://github.com/org/repo.git', () => {
        (0, vitest_1.expect)((0, url_utils_js_1.normalizeGitUrl)('https://github.com/org/repo.git')).toBe('github.com/org/repo');
    });
    (0, vitest_1.it)('converts https://github.com/org/repo (no .git)', () => {
        (0, vitest_1.expect)((0, url_utils_js_1.normalizeGitUrl)('https://github.com/org/repo')).toBe('github.com/org/repo');
    });
    (0, vitest_1.it)('strips auth from https://user:pass@github.com/org/repo.git', () => {
        (0, vitest_1.expect)((0, url_utils_js_1.normalizeGitUrl)('https://user:pass@github.com/org/repo.git')).toBe('github.com/org/repo');
    });
    (0, vitest_1.it)('converts ssh://git@github.com/org/repo', () => {
        (0, vitest_1.expect)((0, url_utils_js_1.normalizeGitUrl)('ssh://git@github.com/org/repo')).toBe('github.com/org/repo');
    });
    (0, vitest_1.it)('handles http protocol', () => {
        (0, vitest_1.expect)((0, url_utils_js_1.normalizeGitUrl)('http://github.com/org/repo.git')).toBe('github.com/org/repo');
    });
    (0, vitest_1.it)('handles git:// protocol', () => {
        (0, vitest_1.expect)((0, url_utils_js_1.normalizeGitUrl)('git://github.com/org/repo.git')).toBe('github.com/org/repo');
    });
    (0, vitest_1.it)('trims whitespace', () => {
        (0, vitest_1.expect)((0, url_utils_js_1.normalizeGitUrl)('  git@github.com:org/repo.git  ')).toBe('github.com/org/repo');
    });
});
//# sourceMappingURL=url-utils.test.js.map