"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const vault_client_js_1 = require("../vault-client.js");
(0, vitest_1.describe)('extractHostingFromUrl', () => {
    (0, vitest_1.it)('extracts hostname and org from HTTPS URL', () => {
        const result = (0, vault_client_js_1.extractHostingFromUrl)('https://github.com/Arjunkhera/Vault.git');
        (0, vitest_1.expect)(result).toEqual({ hostname: 'github.com', org: 'Arjunkhera' });
    });
    (0, vitest_1.it)('extracts hostname and org from SSH URL', () => {
        const result = (0, vault_client_js_1.extractHostingFromUrl)('git@github.com:Arjunkhera/Vault.git');
        (0, vitest_1.expect)(result).toEqual({ hostname: 'github.com', org: 'Arjunkhera' });
    });
    (0, vitest_1.it)('extracts enterprise GitHub hostname from HTTPS URL', () => {
        const result = (0, vault_client_js_1.extractHostingFromUrl)('https://github.corp.acme.com/platform-team/my-service.git');
        (0, vitest_1.expect)(result).toEqual({ hostname: 'github.corp.acme.com', org: 'platform-team' });
    });
    (0, vitest_1.it)('extracts enterprise GitHub hostname from SSH URL', () => {
        const result = (0, vault_client_js_1.extractHostingFromUrl)('git@github.corp.acme.com:platform-team/my-service.git');
        (0, vitest_1.expect)(result).toEqual({ hostname: 'github.corp.acme.com', org: 'platform-team' });
    });
    (0, vitest_1.it)('returns defaults for null remote URL', () => {
        const result = (0, vault_client_js_1.extractHostingFromUrl)(null);
        (0, vitest_1.expect)(result).toEqual({ hostname: 'github.com', org: '' });
    });
    (0, vitest_1.it)('returns defaults for unrecognised URL format', () => {
        const result = (0, vault_client_js_1.extractHostingFromUrl)('not-a-url');
        (0, vitest_1.expect)(result).toEqual({ hostname: 'github.com', org: '' });
    });
});
//# sourceMappingURL=vault-client.test.js.map