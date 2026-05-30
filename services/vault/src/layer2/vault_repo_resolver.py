"""
Per-vault git clone resolver for the Vault writer.

The single vault-writer StatefulSet serves writes for ALL vaults. Each vault
has its own knowledge-base GitHub repo, cloned to a separate directory on the
writer's PVC. This resolver maps vault namespace → local repo path, lazy-cloning
on first access.

Layout on the PVC:
    /data/knowledge-repo              ← "default" vault (entrypoint.sh clones this)
    /data/vaults/<slug>/knowledge-repo ← non-default vaults (lazy-cloned here)
"""

import logging
import subprocess
import threading
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_NAMESPACE = "default"
VAULTS_BASE = "/data/vaults"


class VaultRepoResolver:
    """Maps vault namespace → local knowledge-repo path on the writer PVC."""

    def __init__(
        self,
        default_repo_path: str,
        github_token: str = "",
        vaults_base: str = VAULTS_BASE,
    ):
        self._default_path = default_repo_path
        self._github_token = github_token
        self._vaults_base = Path(vaults_base)
        self._lock = threading.Lock()
        self._resolved: dict[str, str] = {}

    def resolve(
        self,
        vault_namespace: str,
        git_repo: Optional[str] = None,
    ) -> str:
        if vault_namespace == DEFAULT_NAMESPACE or not vault_namespace:
            return self._default_path

        with self._lock:
            if vault_namespace in self._resolved:
                return self._resolved[vault_namespace]

        if not git_repo:
            logger.warning(
                "No git_repo for vault %r — falling back to default repo",
                vault_namespace,
            )
            return self._default_path

        return self._ensure_clone(vault_namespace, git_repo)

    def _ensure_clone(self, vault_namespace: str, git_repo: str) -> str:
        slug = vault_namespace.replace("/", "-").replace("\\", "-")
        repo_dir = self._vaults_base / slug / "knowledge-repo"

        with self._lock:
            if vault_namespace in self._resolved:
                return self._resolved[vault_namespace]

            if (repo_dir / ".git").exists():
                self._resolved[vault_namespace] = str(repo_dir)
                logger.info(
                    "Vault %r: reusing existing clone at %s",
                    vault_namespace, repo_dir,
                )
                self._git_pull(repo_dir)
                return str(repo_dir)

            repo_dir.parent.mkdir(parents=True, exist_ok=True)
            clone_url = self._authenticated_url(git_repo)
            try:
                subprocess.run(
                    ["git", "clone", clone_url, str(repo_dir)],
                    capture_output=True, text=True, check=True, timeout=120,
                )
                logger.info(
                    "Vault %r: cloned %s → %s",
                    vault_namespace, git_repo, repo_dir,
                )
            except subprocess.CalledProcessError as e:
                logger.error(
                    "Clone failed for vault %r (%s): %s",
                    vault_namespace, git_repo, e.stderr,
                )
                raise

            self._resolved[vault_namespace] = str(repo_dir)
            return str(repo_dir)

    def _authenticated_url(self, git_repo: str) -> str:
        if self._github_token:
            return f"https://x-access-token:{self._github_token}@github.com/{git_repo}.git"
        return f"https://github.com/{git_repo}.git"

    def _git_pull(self, repo_dir: Path) -> None:
        try:
            subprocess.run(
                ["git", "-C", str(repo_dir), "pull", "--ff-only"],
                capture_output=True, text=True, check=True, timeout=30,
            )
        except Exception as e:
            logger.warning("git pull failed for %s (non-fatal): %s", repo_dir, e)
