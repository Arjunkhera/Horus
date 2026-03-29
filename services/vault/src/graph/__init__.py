"""
graph — Neo4j connection layer for Vault.

Public API:
    GraphClient        — driver wrapper with lazy connect and query()
    GraphError         — base exception
    GraphConnectionError — raised when the server is unreachable
"""

from .client import GraphClient
from .exceptions import GraphConnectionError, GraphError

__all__ = ["GraphClient", "GraphError", "GraphConnectionError"]
