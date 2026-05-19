# ADR-0003: Pluggable CredentialProvider/Verifier pair over a locked Principal contract

**Status:** accepted
**Date:** 2026-05-19
**Related:** Decision journal `3dc752a8` (design-proposal `eee11da4` question A2); ADR-0001; story `e745a54d`

## Context

Horus is the sole front door and the mode module differentiates deployments (ADR-0001). The
open question (design-proposal `eee11da4` A2) was: how does Horus authenticate, and how do
subsystems (including MCP) validate that a caller is authorised? Enterprises have their own
paved-path auth (the user's company case), while SaaS needs a stateless default that scales.
The Forge `AuthStrategy`/`webhook`/`jose` seed already exists and is proven.

## Decision

Generalize the Forge `AuthStrategy` seed into a shared Horus auth library with a **pluggable
`CredentialProvider` / `CredentialVerifier` pair** over a **locked internal contract**:

- **Locked contract (never varies by deployment):** the `Principal {tenant, user, role}`
  schema and how authorization is interpreted in code. ALL business logic and tenant-scope
  enforcement bind to the `Principal`, never to the wire format. **Tenant isolation is a
  non-pluggable invariant** sitting below the pluggable layer — a misconfigured auth plugin
  cannot disable cross-tenant isolation.
- **Pluggable mechanism (mode-module dial):**
  - `CredentialProvider` (Horus side) — generates AND refreshes the `Authorization` header
    for every outbound call including MCP; owns credential lifecycle
    (cache/expiry/refresh) transparently to callers.
  - `CredentialVerifier` (subsystem side) — validates the header, emits the `Principal`.
  - Provider and Verifier are independent modules but deployed as a **matched pair** wired
    by the mode module.
- **SaaS default / reference impl:** asymmetric signed JWT — gateway holds the private key,
  signs `{tenant,user,role,iss,aud,exp}`; subsystems verify statelessly via
  JWKS-distributed public key (RS256/ES256); key rotation via `kid`. No callback to Horus.
- **Other deployments:** swap the pair, e.g. enterprise paved-path `appId`/`appSecret`/
  short-lived `userToken` (same shape as the existing Forge `webhook` strategy).
- Identity *source* (static userId / SSO-OIDC / hosted OAuth) is a separate mode dial
  feeding the Provider.

## Alternatives Considered

### Fixed JWT only
Rejected — cannot accommodate enterprise paved-path header schemes.

### Gateway-only with no per-service verify (Option B)
Rejected — inconsistent with the ADR-0002 hard-isolation stance.

### Per-service independent auth (Option A)
Rejected — scatters auth and contradicts the sole-front-door model.

## Consequences

### Positive
- Decouples wire format from business logic via the stable `Principal`, so swapping
  credential schemes touches zero subsystem logic — SaaS-without-rebuild in the auth layer.
- Reuses the proven Forge `AuthStrategy`/`webhook`/`jose` seed rather than inventing.
- Stateless verification scales and keeps subsystems sole-fronted yet defensible if ever
  reached directly.
- Accommodates real enterprise paved-path auth.

### Negative
- A thin stateless verify shim is required in every subsystem including the MCP transport.
- Provider/Verifier must be kept a compatible pair per deployment.
- MCP header propagation is required (natural over remote HTTP transport).

### Neutral
- Token lifetime/refresh policy and how the gateway itself is protected are deferred to
  the auth-lib implementation work item.

## Updates

_None._
