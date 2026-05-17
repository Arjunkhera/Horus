#!/usr/bin/env bash
# run-testenv.sh — Run the Horus .testenv scenario locally or on EC2
#
# Usage:
#   ./scripts/run-testenv.sh [--local | --ec2]
#
# Modes:
#   --ec2 (default)  Provision a fresh EC2 instance, bootstrap Horus, run the
#                    scenario, then terminate the instance. Cost-safe: the
#                    instance is always terminated on exit (trap).
#   --local          Run the shadow stack on the current machine. Requires
#                    Docker, Node 18+, and enough RAM (≥6 GB free).
#
# Requirements:
#   --ec2:  AWS CLI configured (aws sts get-caller-identity must succeed)
#           AWS_REGION, EC2_AMI_ID, EC2_INSTANCE_TYPE,
#           EC2_SECURITY_GROUP_ID env vars (or defaults below)
#           EC2_KEY_FILE (optional): path to an existing .pem for EC2_KEY_NAME;
#                         if unset, an ephemeral key pair is created & deleted
#           ANTHROPIC_API_KEY env var
#   --local: @arkhera30/cli and @akhera-horus/testenv-runner installed globally
#            ANTHROPIC_API_KEY env var
#
# Required secrets (asserted at runner Phase 1):
#   ANTHROPIC_API_KEY  always required (Claude Code agent runs)
#   CURSOR_API_KEY     ONLY required under the `full` profile (reader-server
#                      under test). --local uses `laptop`, --ec2 uses `cloud`,
#                      so CURSOR_API_KEY is NOT required for either mode here.
#
# Exit codes:
#   0 — scenario PASS
#   1 — scenario FAIL or error
#   2 — usage error

set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="${REPO_ROOT}/.testenv/manifest.yaml"
EVIDENCE_DIR="${REPO_ROOT}/.testenv-evidence"
RESULT_FILE="${EVIDENCE_DIR}/run-result.json"

# EC2 defaults (override with env vars)
AWS_REGION="${AWS_REGION:-us-east-1}"
EC2_AMI_ID="${EC2_AMI_ID:-ami-0c02fb55956c7d316}"   # Amazon Linux 2 us-east-1
EC2_INSTANCE_TYPE="${EC2_INSTANCE_TYPE:-t3.xlarge}"   # 4 vCPU / 16 GB — enough for shadow stack
EC2_KEY_NAME="${EC2_KEY_NAME:-}"
EC2_SECURITY_GROUP_ID="${EC2_SECURITY_GROUP_ID:-}"
EC2_KEY_FILE="${EC2_KEY_FILE:-}"   # optional: existing .pem for EC2_KEY_NAME; unset ⇒ ephemeral key pair

# ── Argument parsing ─────────────────────────────────────────────────────────

MODE="ec2"
for arg in "$@"; do
  case "$arg" in
    --ec2)   MODE="ec2"   ;;
    --local) MODE="local" ;;
    --help|-h)
      sed -n '2,28p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

# ── Helpers ──────────────────────────────────────────────────────────────────

log()  { echo "[run-testenv] $*"; }
fail() { echo "[run-testenv] FAIL: $*" >&2; exit 1; }

check_prereqs_local() {
  command -v horus         >/dev/null 2>&1 || fail "horus CLI not found — run: npm i -g @arkhera30/cli"
  command -v testenv-run   >/dev/null 2>&1 || fail "testenv-run not found — run: npm i -g @akhera-horus/testenv-runner"
  command -v docker        >/dev/null 2>&1 || fail "docker not found"
  [[ -n "${ANTHROPIC_API_KEY:-}" ]]        || fail "ANTHROPIC_API_KEY not set"
  [[ -f "$MANIFEST" ]]                     || fail "manifest not found: $MANIFEST"
}

check_prereqs_ec2() {
  command -v aws           >/dev/null 2>&1 || fail "aws CLI not found"
  aws sts get-caller-identity >/dev/null 2>&1 || fail "AWS credentials not configured"
  [[ -n "${ANTHROPIC_API_KEY:-}" ]]        || fail "ANTHROPIC_API_KEY not set"
  [[ -n "$EC2_SECURITY_GROUP_ID" ]]        || fail "EC2_SECURITY_GROUP_ID not set"
  if [[ -n "$EC2_KEY_FILE" ]]; then
    [[ -f "$EC2_KEY_FILE" ]]               || fail "EC2_KEY_FILE set but file not found: $EC2_KEY_FILE"
    [[ -n "$EC2_KEY_NAME" ]]               || fail "EC2_KEY_FILE set but EC2_KEY_NAME (matching AWS key pair name) not set"
  fi
  [[ -f "$MANIFEST" ]]                     || fail "manifest not found: $MANIFEST"
}

print_result() {
  local verdict="$1"
  echo ""
  echo "══════════════════════════════════════════════"
  if [[ "$verdict" == "PASS" ]]; then
    echo "  RESULT: ✓ PASS"
  else
    echo "  RESULT: ✗ FAIL"
  fi
  echo "  Evidence: $EVIDENCE_DIR"
  echo "══════════════════════════════════════════════"
}

# ── Local mode ───────────────────────────────────────────────────────────────

run_local() {
  check_prereqs_local

  # The runner OWNS slot lifecycle: its launch phase runs the manifest
  # provisioner (`horus test-env acquire --standalone --json`), discovers the
  # auto-assigned slot, and its teardown phase releases it. The script must NOT
  # pre-acquire (that caused a double-acquire) nor impose a slot.
  local workdir
  workdir="$(mktemp -d "${TMPDIR:-/tmp}/horus-testenv-work.XXXXXX")"

  log "Mode: local  |  workdir: $workdir"
  log "Evidence dir: $EVIDENCE_DIR"

  mkdir -p "$EVIDENCE_DIR"

  # Safety-net trap — release any slot still active (runner auto-detects the
  # acquired slot) and remove the temp workdir on exit.
  trap '
    log "Teardown safety-net: releasing any active slot...";
    horus test-env release 2>/dev/null || true;
    [[ -n "$workdir" && -d "$workdir" ]] && rm -rf "$workdir" || true
  ' EXIT

  log "Running scenario (runner provisions the shadow stack)..."
  testenv-run "$MANIFEST" \
    --src "$REPO_ROOT" \
    --workdir "$workdir" \
    --profile laptop \
    --run-class adhoc \
    --output "$RESULT_FILE" \
    2>&1 | tee "${EVIDENCE_DIR}/run.log"

  local exit_code=${PIPESTATUS[0]}

  if [[ $exit_code -eq 0 ]]; then
    print_result "PASS"
  else
    print_result "FAIL"
    exit 1
  fi
}

# ── EC2 mode ─────────────────────────────────────────────────────────────────

run_ec2() {
  check_prereqs_ec2

  local instance_id=""
  local ephemeral_key_name=""
  local key_file effective_key_name

  if [[ -n "$EC2_KEY_FILE" ]]; then
    # Caller supplied an existing private key for EC2_KEY_NAME (CI/harness convention).
    key_file="$EC2_KEY_FILE"
    effective_key_name="$EC2_KEY_NAME"
    log "Using caller-supplied key pair: $EC2_KEY_NAME ($EC2_KEY_FILE)"
  else
    # No key supplied — create an ephemeral key pair, deleted on teardown.
    key_file="${TMPDIR:-/tmp}/horus-testenv-key-$$.pem"
    ephemeral_key_name="horus-testenv-$$-$(date +%s)"
    effective_key_name="$ephemeral_key_name"
    log "Creating ephemeral EC2 key pair: $ephemeral_key_name"
    aws ec2 create-key-pair \
      --key-name "$ephemeral_key_name" \
      --region "$AWS_REGION" \
      --query 'KeyMaterial' --output text > "$key_file"
    chmod 600 "$key_file"
  fi

  log "Mode: ec2  |  type: $EC2_INSTANCE_TYPE  |  region: $AWS_REGION"
  log "Evidence dir: $EVIDENCE_DIR"

  mkdir -p "$EVIDENCE_DIR"

  # Teardown trap — always terminate the instance, delete ephemeral key, clean up on exit.
  # A caller-supplied EC2_KEY_FILE is NEVER deleted; only an ephemeral pair/file is.
  trap '
    log "Teardown: terminating EC2 instance $instance_id..."
    [[ -n "$instance_id" ]] && \
      aws ec2 terminate-instances --instance-ids "$instance_id" \
        --region "$AWS_REGION" >/dev/null 2>&1 || true
    if [[ -n "$ephemeral_key_name" ]]; then
      aws ec2 delete-key-pair --key-name "$ephemeral_key_name" \
        --region "$AWS_REGION" >/dev/null 2>&1 || true
      [[ -f "$key_file" ]] && rm -f "$key_file" || true
    fi
    log "Teardown complete."
  ' EXIT

  # Launch EC2 instance
  log "Launching EC2 instance..."
  local launch_result
  launch_result="$(aws ec2 run-instances \
    --image-id "$EC2_AMI_ID" \
    --instance-type "$EC2_INSTANCE_TYPE" \
    --key-name "$effective_key_name" \
    --security-group-ids "$EC2_SECURITY_GROUP_ID" \
    --region "$AWS_REGION" \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=horus-testenv-run},{Key=Purpose,Value=ci-testenv}]' \
    --query 'Instances[0].InstanceId' \
    --output text)"
  instance_id="$launch_result"
  log "Instance launched: $instance_id"

  # Wait for instance to be running and get public IP
  log "Waiting for instance to be ready..."
  aws ec2 wait instance-running \
    --instance-ids "$instance_id" \
    --region "$AWS_REGION"

  local public_ip
  public_ip="$(aws ec2 describe-instances \
    --instance-ids "$instance_id" \
    --region "$AWS_REGION" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' \
    --output text)"
  log "Instance ready: $public_ip"

  # Wait for SSH
  log "Waiting for SSH..."
  local retries=30
  while ! ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 \
    -i "$key_file" "ec2-user@${public_ip}" echo "ssh ready" 2>/dev/null; do
    retries=$((retries - 1))
    [[ $retries -le 0 ]] && fail "SSH did not become available"
    sleep 10
  done

  # Bootstrap: install Node, Docker, horus CLI, testenv-runner
  log "Bootstrapping instance..."
  ssh -o StrictHostKeyChecking=no -i "$key_file" "ec2-user@${public_ip}" bash <<BOOTSTRAP
set -euo pipefail
# Install Node 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs docker git
sudo systemctl start docker
sudo usermod -aG docker ec2-user

# Install horus CLI and testenv-runner
sudo npm install -g @arkhera30/cli @akhera-horus/testenv-runner

# Setup horus (zero-vault, no config needed)
mkdir -p ~/Horus
horus setup -y

echo "Bootstrap complete"
BOOTSTRAP

  # Upload repo snapshot and manifest
  log "Uploading repo snapshot..."
  local archive="${TMPDIR:-/tmp}/horus-src-$$.tar.gz"
  git -C "$REPO_ROOT" archive HEAD --format=tar.gz -o "$archive"
  scp -o StrictHostKeyChecking=no -i "$key_file" \
    "$archive" "ec2-user@${public_ip}:/tmp/horus-src.tar.gz"
  rm -f "$archive"

  # Run the scenario on EC2
  log "Running scenario on EC2..."
  local remote_exit=0
  ssh -o StrictHostKeyChecking=no -i "$key_file" "ec2-user@${public_ip}" bash <<RUNSCRIPT || remote_exit=$?
set -euo pipefail
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}"

# Extract repo
mkdir -p ~/horus-src ~/horus-work
tar -xzf /tmp/horus-src.tar.gz -C ~/horus-src

# Do NOT pre-acquire: the runner's launch phase provisions the stack
# (horus test-env acquire --standalone --json) and its teardown releases it.

# Run scenario
testenv-run ~/horus-src/.testenv/manifest.yaml \
  --src ~/horus-src \
  --workdir ~/horus-work \
  --profile cloud \
  --run-class adhoc \
  --output ~/testenv-result.json \
  2>&1 | tee ~/testenv-run.log

echo "Scenario complete"
RUNSCRIPT

  # Retrieve evidence
  log "Retrieving evidence..."
  scp -o StrictHostKeyChecking=no -i "$key_file" \
    "ec2-user@${public_ip}:~/testenv-result.json" "$RESULT_FILE" 2>/dev/null || true
  scp -o StrictHostKeyChecking=no -i "$key_file" \
    "ec2-user@${public_ip}:~/testenv-run.log" "${EVIDENCE_DIR}/run.log" 2>/dev/null || true

  if [[ $remote_exit -eq 0 ]]; then
    print_result "PASS"
  else
    print_result "FAIL"
    exit 1
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

case "$MODE" in
  local) run_local ;;
  ec2)   run_ec2   ;;
esac
