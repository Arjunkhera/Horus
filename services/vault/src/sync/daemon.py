"""
Sync daemon for Knowledge Service.

Provides two background tasks:
1. Git pull loop - Periodically pulls from knowledge repo and triggers re-index
2. File watcher - Monitors workspace for changes and triggers re-index (debounced)

Both tasks coordinate via a shared lock to prevent concurrent re-indexing.
"""

import asyncio
import logging
import os
from pathlib import Path
from typing import Any, Optional
from datetime import datetime

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileSystemEvent

from ..layer1.interface import SearchStore

logger = logging.getLogger(__name__)


class ReindexLock:
    """
    Shared lock and state for coordinating re-index operations.
    
    Prevents concurrent re-indexing from git pull loop and file watcher.
    Tracks last re-index time for logging and monitoring.
    """
    
    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.last_reindex: Optional[datetime] = None
        self.reindex_count = 0
    
    async def reindex(self, store: SearchStore, trigger: str) -> bool:
        """
        Execute re-index with lock protection.
        
        Args:
            store: SearchStore instance to re-index
            trigger: Description of what triggered the re-index (for logging)
        
        Returns:
            True if re-index was performed, False if skipped (lock held)
        """
        if self.lock.locked():
            logger.debug(f"Re-index already in progress, skipping trigger: {trigger}")
            return False
        
        async with self.lock:
            try:
                logger.info(f"Starting re-index (trigger: {trigger})...")
                start_time = datetime.now()
                
                # Run synchronous store.reindex() in thread pool to avoid blocking
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, store.reindex)
                
                elapsed = (datetime.now() - start_time).total_seconds()
                self.last_reindex = datetime.now()
                self.reindex_count += 1
                
                logger.info(f"Re-index complete (trigger: {trigger}, elapsed: {elapsed:.2f}s, total: {self.reindex_count})")
                return True
                
            except Exception as e:
                logger.error(f"Re-index failed (trigger: {trigger}): {e}", exc_info=True)
                return False


async def git_pull_loop(
    store: SearchStore,
    repo_path: str,
    interval: int,
    reindex_lock: ReindexLock
) -> None:
    """
    Periodic git pull loop for knowledge repo.
    
    Runs every `interval` seconds. If new commits are pulled, triggers re-index.
    Handles errors gracefully without crashing the loop.
    
    Args:
        store: SearchStore instance for re-indexing
        repo_path: Path to knowledge repo (must be a git repository)
        interval: Seconds between pull attempts
        reindex_lock: Shared lock for coordinating re-index operations
    """
    logger.info(f"Starting git pull loop (repo: {repo_path}, interval: {interval}s)")
    
    # Validate repo path exists
    if not os.path.isdir(repo_path):
        logger.warning(f"Knowledge repo path does not exist: {repo_path}")
        logger.warning("Git pull loop will not run until repo is initialized")
        return
    
    if not os.path.isdir(os.path.join(repo_path, ".git")):
        logger.warning(f"Path is not a git repository: {repo_path}")
        logger.warning("Git pull loop will not run")
        return
    
    pull_count = 0
    update_count = 0
    
    while True:
        try:
            # Wait for interval before next pull
            await asyncio.sleep(interval)
            
            pull_count += 1
            logger.debug(f"Attempting git pull #{pull_count}...")
            
            # Run git pull via subprocess
            process = await asyncio.create_subprocess_exec(
                "git", "-C", repo_path, "pull", "--ff-only",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await process.communicate()
            stdout_text = stdout.decode().strip()
            stderr_text = stderr.decode().strip()
            
            if process.returncode != 0:
                logger.error(f"Git pull failed (exit {process.returncode}): {stderr_text}")
                continue
            
            # Check if new commits were pulled
            if "Already up to date" in stdout_text or "Already up-to-date" in stdout_text:
                logger.debug(f"Git pull #{pull_count}: already up to date")
            else:
                update_count += 1
                logger.info(f"Git pull #{pull_count}: new commits pulled")
                logger.debug(f"Git output: {stdout_text}")
                
                # Trigger re-index
                await reindex_lock.reindex(store, f"git-pull-{update_count}")
        
        except asyncio.CancelledError:
            logger.info(f"Git pull loop cancelled (pulls: {pull_count}, updates: {update_count})")
            raise
        
        except Exception as e:
            logger.error(f"Error in git pull loop: {e}", exc_info=True)
            # Continue loop despite error


class WorkspaceChangeHandler(FileSystemEventHandler):
    """
    Watchdog event handler for workspace file changes.

    For TypesenseSearchEngine stores: performs per-file upsert/delete so that
    search results are updated within seconds without a full re-index.

    For other stores (e.g. FtsSearchEngine): debounced full re-index (original
    behaviour).

    Ignores changes in common exclude paths (.git, node_modules, etc).
    """

    def __init__(
        self,
        store: SearchStore,
        reindex_lock: ReindexLock,
        workspace_path: str,
        debounce_seconds: float = 5.0,
    ) -> None:
        super().__init__()
        self.store = store
        self.reindex_lock = reindex_lock
        self.workspace_path = workspace_path
        self.debounce_seconds = debounce_seconds
        self.debounce_task: Optional[asyncio.Task[None]] = None
        self.change_count = 0

        # Paths to ignore (relative patterns)
        self.ignore_patterns = {
            ".git/",
            "node_modules/",
            "dist/",
            "build/",
            ".local/",
            ".cache/",
            "__pycache__/",
            ".venv/",
            "venv/",
        }

    @property
    def _is_typesense(self) -> bool:
        """Return True if the backing store supports per-file upsert/delete."""
        try:
            from ..layer1.typesense_engine import TypesenseSearchEngine
            return isinstance(self.store, TypesenseSearchEngine)
        except ImportError:
            return False

    def _should_ignore(self, path: str) -> bool:
        """Check if path should be ignored based on ignore patterns."""
        for pattern in self.ignore_patterns:
            if pattern in path:
                return True
        return False

    def _should_process(self, event: FileSystemEvent) -> bool:
        """Check if event should trigger an update."""
        if event.is_directory:
            return False
        if not event.src_path.endswith(".md"):
            return False
        if self._should_ignore(event.src_path):
            return False
        return True

    def _file_path_for(self, abs_path: str) -> Optional[str]:
        """
        Convert an absolute filesystem path to a collection-prefixed file_path.

        Returns None if the path cannot be mapped to a known collection.
        """
        # The workspace watcher is rooted at workspace_path, so collection = "workspace"
        try:
            rel = os.path.relpath(abs_path, self.workspace_path)
            if not rel.startswith(".."):
                return f"workspace/{rel}"
        except ValueError:
            pass
        return None

    # ------------------------------------------------------------------
    # Per-file Typesense update helpers
    # ------------------------------------------------------------------

    def _upsert_file(self, abs_path: str) -> None:
        """Parse the file and upsert it into Typesense (fire-and-forget)."""
        file_path = self._file_path_for(abs_path)
        if not file_path:
            return
        try:
            content = Path(abs_path).read_text(encoding="utf-8")
            self.store.upsert_document(file_path, content)  # type: ignore[attr-defined]
            logger.debug("Typesense upsert: %s", file_path)
        except Exception as exc:
            logger.warning("Failed to upsert %s: %s", file_path, exc)

    def _delete_file(self, abs_path: str) -> None:
        """Delete a document from Typesense (fire-and-forget)."""
        file_path = self._file_path_for(abs_path)
        if not file_path:
            return
        self.store.delete_document(file_path)  # type: ignore[attr-defined]
        logger.debug("Typesense delete: %s", file_path)

    # ------------------------------------------------------------------
    # Debounced full re-index (FTS5 fallback path)
    # ------------------------------------------------------------------

    async def _debounced_reindex(self) -> None:
        """
        Debounced re-index coroutine.

        Waits for debounce period, then triggers re-index.
        If new changes arrive, this task is cancelled and restarted.
        """
        try:
            await asyncio.sleep(self.debounce_seconds)
            await self.reindex_lock.reindex(self.store, f"workspace-change-{self.change_count}")
        except asyncio.CancelledError:
            pass

    def _trigger_debounced_reindex(self) -> None:
        """Trigger debounced full re-index (used for non-Typesense stores)."""
        if self.debounce_task and not self.debounce_task.done():
            self.debounce_task.cancel()
        loop = asyncio.get_event_loop()
        self.debounce_task = loop.create_task(self._debounced_reindex())

    # ------------------------------------------------------------------
    # Watchdog event handlers
    # ------------------------------------------------------------------

    def on_created(self, event: FileSystemEvent) -> None:
        """Handle file creation events."""
        if not self._should_process(event):
            return
        self.change_count += 1
        logger.debug("Workspace file created: %s", event.src_path)
        if self._is_typesense:
            self._upsert_file(event.src_path)
        else:
            self._trigger_debounced_reindex()

    def on_modified(self, event: FileSystemEvent) -> None:
        """Handle file modification events."""
        if not self._should_process(event):
            return
        self.change_count += 1
        logger.debug("Workspace file modified: %s", event.src_path)
        if self._is_typesense:
            self._upsert_file(event.src_path)
        else:
            self._trigger_debounced_reindex()

    def on_deleted(self, event: FileSystemEvent) -> None:
        """Handle file deletion events."""
        if not self._should_process(event):
            return
        self.change_count += 1
        logger.debug("Workspace file deleted: %s", event.src_path)
        if self._is_typesense:
            self._delete_file(event.src_path)
        else:
            self._trigger_debounced_reindex()


def start_workspace_watcher(
    store: SearchStore,
    workspace_path: str,
    reindex_lock: ReindexLock,
    debounce_seconds: float = 5.0,
) -> Optional[Any]:  # type: ignore[name-defined]
    """
    Start file system watcher for workspace changes.

    For TypesenseSearchEngine: per-file upsert/delete on each markdown event.
    For other stores: debounced full re-index.

    Args:
        store: SearchStore instance for re-indexing
        workspace_path: Path to workspace directory to monitor
        reindex_lock: Shared lock for coordinating re-index operations
        debounce_seconds: Seconds to wait after last change before re-indexing (non-Typesense)

    Returns:
        Observer instance if started successfully, None if workspace doesn't exist
    """
    logger.info("Starting workspace watcher (path: %s, debounce: %ss)", workspace_path, debounce_seconds)

    if not os.path.isdir(workspace_path):
        logger.warning("Workspace path does not exist: %s", workspace_path)
        logger.warning("Workspace watcher will not start until path exists")
        return None

    try:
        event_handler = WorkspaceChangeHandler(
            store=store,
            reindex_lock=reindex_lock,
            workspace_path=workspace_path,
            debounce_seconds=debounce_seconds,
        )

        observer = Observer()
        observer.schedule(event_handler, workspace_path, recursive=True)
        observer.start()

        logger.info("Workspace watcher started successfully")
        return observer

    except Exception as e:
        logger.error("Failed to start workspace watcher: %s", e, exc_info=True)
        return None


async def start_sync_daemon(
    store: SearchStore,
    knowledge_repo_path: str,
    workspace_path: str,
    sync_interval: int,
    debounce_seconds: float = 5.0
) -> tuple[Optional[asyncio.Task[None]], Optional[Any]]:
    """
    Start both sync daemon components.
    
    Convenience function to start git pull loop and workspace watcher together.
    
    Args:
        store: SearchStore instance
        knowledge_repo_path: Path to knowledge repo
        workspace_path: Path to workspace
        sync_interval: Seconds between git pulls
        debounce_seconds: Seconds to debounce workspace changes
    
    Returns:
        Tuple of (git_pull_task, workspace_observer)
        Either component may be None if it failed to start
    """
    logger.info("Starting sync daemon...")
    
    # Create shared reindex lock
    reindex_lock = ReindexLock()
    
    # Start git pull loop as asyncio task
    git_pull_task: asyncio.Task[None] = asyncio.create_task(
        git_pull_loop(store, knowledge_repo_path, sync_interval, reindex_lock)
    )
    
    # Start workspace watcher
    workspace_observer = start_workspace_watcher(
        store, workspace_path, reindex_lock, debounce_seconds
    )
    
    logger.info("Sync daemon started")
    return git_pull_task, workspace_observer


async def stop_sync_daemon(
    git_pull_task: Optional[asyncio.Task[None]],
    workspace_observer: Optional[Any]
) -> None:
    """
    Stop both sync daemon components gracefully.
    
    Args:
        git_pull_task: Git pull loop task (or None)
        workspace_observer: Workspace watcher observer (or None)
    """
    logger.info("Stopping sync daemon...")
    
    # Stop git pull loop
    if git_pull_task and not git_pull_task.done():
        git_pull_task.cancel()
        try:
            await git_pull_task
        except asyncio.CancelledError:
            pass
    
    # Stop workspace watcher
    if workspace_observer:
        workspace_observer.stop()
        workspace_observer.join(timeout=5.0)
    
    logger.info("Sync daemon stopped")
