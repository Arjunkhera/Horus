"""
Exceptions for the graph (Neo4j) connection layer.
"""


class GraphError(Exception):
    """Base exception for all graph-related errors."""


class GraphConnectionError(GraphError):
    """Raised when the graph database is unreachable or the connection fails."""
