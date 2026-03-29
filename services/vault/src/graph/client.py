"""
GraphClient — thin wrapper around the Neo4j Python driver.

Responsibilities:
- Lazy connection: the driver is created on the first query call if not already connected.
- query() executes a Cypher statement and returns results as a list of plain dicts.
- ServiceUnavailable errors from the driver are re-raised as GraphConnectionError.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from .exceptions import GraphConnectionError

logger = logging.getLogger(__name__)


class GraphClient:
    """Manages a Neo4j driver connection and exposes a simple query interface."""

    def __init__(self, settings: Any) -> None:
        """
        Initialise the client from VaultSettings.

        The driver is NOT created here; connection is deferred to the first
        call to connect() or query().

        Args:
            settings: VaultSettings instance (must expose neo4j_uri, neo4j_user,
                      neo4j_password).
        """
        self._uri: str = settings.neo4j_uri
        self._user: str = settings.neo4j_user
        self._password: str = settings.neo4j_password
        self._driver: Optional[Any] = None

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    def connect(self) -> None:
        """
        Open the Neo4j driver.

        Safe to call multiple times — a no-op if already connected.

        Raises:
            GraphConnectionError: if the driver cannot be created or the
                                  server is unreachable.
        """
        if self._driver is not None:
            return

        try:
            from neo4j import GraphDatabase  # type: ignore[import-untyped]
            from neo4j.exceptions import ServiceUnavailable  # type: ignore[import-untyped]
        except ImportError as exc:
            raise GraphConnectionError(
                "neo4j package is not installed. Add neo4j to requirements.txt."
            ) from exc

        try:
            logger.info("Connecting to Neo4j at %s", self._uri)
            self._driver = GraphDatabase.driver(
                self._uri, auth=(self._user, self._password)
            )
            # Verify connectivity immediately so failures surface at startup.
            self._driver.verify_connectivity()
            logger.info("Neo4j connection established")
        except Exception as exc:
            self._driver = None
            raise GraphConnectionError(
                f"Failed to connect to Neo4j at {self._uri}: {exc}"
            ) from exc

    def close(self) -> None:
        """
        Close the Neo4j driver and release resources.

        Safe to call when not connected — a no-op in that case.
        """
        if self._driver is not None:
            try:
                self._driver.close()
                logger.info("Neo4j connection closed")
            except Exception as exc:
                logger.warning("Error while closing Neo4j driver: %s", exc)
            finally:
                self._driver = None

    # ------------------------------------------------------------------
    # Query interface
    # ------------------------------------------------------------------

    def query(self, cypher: str, params: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
        """
        Execute a Cypher query and return the results as a list of record dicts.

        Connects lazily on the first call.

        Args:
            cypher: Cypher query string.
            params: Optional parameter dict for the query.

        Returns:
            List of records, each serialised as a plain ``dict[str, Any]``.

        Raises:
            GraphConnectionError: if the server is unreachable.
        """
        if self._driver is None:
            self.connect()

        try:
            from neo4j.exceptions import ServiceUnavailable  # type: ignore[import-untyped]
        except ImportError as exc:
            raise GraphConnectionError(
                "neo4j package is not installed."
            ) from exc

        try:
            with self._driver.session() as session:
                result = session.run(cypher, parameters=params or {})
                return [dict(record) for record in result]
        except ServiceUnavailable as exc:
            raise GraphConnectionError(
                f"Neo4j service unavailable during query: {exc}"
            ) from exc
        except Exception as exc:
            raise GraphConnectionError(
                f"Neo4j query failed: {exc}"
            ) from exc
