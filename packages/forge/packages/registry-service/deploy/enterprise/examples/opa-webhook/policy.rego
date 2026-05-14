package forge.registry.authz

import future.keywords.if
import future.keywords.in

# ─── Forge Registry OPA Policy ────────────────────────────────────────────────
#
# This policy is evaluated by the opa-webhook server for every request that
# reaches the Forge Registry with auth strategy = webhook.
#
# Input shape (from the registry webhook call):
#   {
#     "action":   "read" | "publish",
#     "resource": { "type": string, "id": string, "version": string },
#     "caller": {
#       "userId": string,
#       "name":   string,
#       "token":  string    # raw Bearer token value
#     }
#   }
#
# Output:
#   { "allow": true | false }
#
# ─── Rules ────────────────────────────────────────────────────────────────────

# Default deny — fail-closed
default allow := false

# Rule 1: Anonymous reads are always permitted.
# The registry itself enforces this for GET /artifacts/*  and GET /types.
# We mirror it here so the policy is self-documenting.
allow if {
  input.action == "read"
}

# Rule 2: Publish requires the caller to have the "admin" role in their JWT.
allow if {
  input.action == "publish"
  jwt_claims.role == "admin"
  # Optional: restrict publishable artifact types
  # input.resource.type in {"skill", "plugin", "agent", "decompose", "intake"}
}

# ─── JWT Verification ─────────────────────────────────────────────────────────
#
# Replace HS256_SECRET with the environment variable your OPA server reads.
# In production, use RS256 with a public key fetched from your JWKS endpoint.

jwt_claims := claims if {
  token := input.caller.token
  token != ""
  # io.jwt.verify_hs256 returns true if the signature is valid.
  # Swap for io.jwt.verify_rs256 + io.jwt.decode for RSA-signed tokens.
  io.jwt.verify_hs256(token, opa.runtime().env.JWT_SECRET)
  [_, claims, _] := io.jwt.decode(token)
  # Validate standard claims
  now := time.now_ns() / 1e9
  claims.exp > now
  claims.iss == "https://auth.example.com"
} else := {}

# ─── Example: per-artifact-type publish restriction ───────────────────────────
#
# Uncomment to allow the "ci-bot" user to publish only "skill" artifacts:
#
# allow if {
#   input.action      == "publish"
#   input.caller.userId == "ci-bot"
#   input.resource.type == "skill"
# }
#
# ─── Example: deny publish to a specific artifact ─────────────────────────────
#
# allow if {
#   input.action == "publish"
#   not is_locked_artifact
#   jwt_claims.role == "admin"
# }
#
# is_locked_artifact if {
#   input.resource.id == "core-framework"
#   input.resource.version != "latest"
# }
