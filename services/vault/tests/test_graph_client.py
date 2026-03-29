"""
Smoke tests for GraphClient.

Unit tests run without a live Neo4j instance.
Integration tests (requiring a running Neo4j) are marked with @pytest.mark.integration
and are skipped unless -m integration is passed to pytest.
"""

from unittest.mock import MagicMock, patch, call

import pytest

from src.graph import GraphClient, GraphConnectionError, GraphError
from src.graph.exceptions import GraphConnectionError, GraphError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_settings(
    uri: str = "bolt://localhost:7687",
    user: str = "neo4j",
    password: str = "test-password",
) -> MagicMock:
    """Return a minimal settings mock with the three neo4j fields."""
    settings = MagicMock()
    settings.neo4j_uri = uri
    settings.neo4j_user = user
    settings.neo4j_password = password
    return settings


# ---------------------------------------------------------------------------
# Unit tests
# ---------------------------------------------------------------------------

class TestGraphClientInstantiation:
    def test_instantiation_stores_settings(self):
        settings = _make_settings()
        client = GraphClient(settings)

        assert client._uri == "bolt://localhost:7687"
        assert client._user == "neo4j"
        assert client._password == "test-password"

    def test_driver_is_none_before_connect(self):
        client = GraphClient(_make_settings())
        assert client._driver is None

    def test_custom_uri_and_credentials(self):
        settings = _make_settings(
            uri="bolt://neo4j:7687",
            user="horus",
            password="secret",
        )
        client = GraphClient(settings)

        assert client._uri == "bolt://neo4j:7687"
        assert client._user == "horus"
        assert client._password == "secret"


class TestGraphClientClose:
    def test_close_is_noop_when_not_connected(self):
        """close() must not raise when driver is None."""
        client = GraphClient(_make_settings())
        client.close()  # should not raise
        assert client._driver is None

    def test_close_calls_driver_close(self):
        client = GraphClient(_make_settings())
        mock_driver = MagicMock()
        client._driver = mock_driver

        client.close()

        mock_driver.close.assert_called_once()
        assert client._driver is None

    def test_close_clears_driver_even_if_driver_close_raises(self):
        client = GraphClient(_make_settings())
        mock_driver = MagicMock()
        mock_driver.close.side_effect = RuntimeError("connection already closed")
        client._driver = mock_driver

        client.close()  # should not propagate the exception

        assert client._driver is None


class TestGraphClientConnect:
    def test_connect_raises_graph_connection_error_on_failure(self):
        """connect() must wrap driver errors in GraphConnectionError."""
        client = GraphClient(_make_settings())

        # Patch GraphDatabase at the module level where client.py imported it
        mock_gdb = MagicMock()
        mock_gdb.driver.side_effect = Exception("refused")
        with patch("src.graph.client.GraphDatabase", mock_gdb):
            with pytest.raises(GraphConnectionError) as exc_info:
                client.connect()

        assert "Failed to connect" in str(exc_info.value)
        assert client._driver is None

    def test_connect_is_noop_when_already_connected(self):
        """Second connect() call must be a no-op."""
        client = GraphClient(_make_settings())
        mock_driver = MagicMock()
        client._driver = mock_driver

        mock_gdb = MagicMock()
        with patch("src.graph.client.GraphDatabase", mock_gdb):
            client.connect()
            mock_gdb.driver.assert_not_called()

    def test_connect_raises_when_neo4j_not_installed(self):
        """connect() raises GraphConnectionError if neo4j is unavailable."""
        client = GraphClient(_make_settings())
        with patch("src.graph.client.GraphDatabase", None):
            with pytest.raises(GraphConnectionError) as exc_info:
                client.connect()
        assert "not installed" in str(exc_info.value)


class TestGraphClientQuery:
    def _make_mock_session(self, records=None):
        """Build a mock session context manager that returns the given records."""
        if records is None:
            records = []
        mock_session = MagicMock()
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)
        mock_session.run.return_value = records
        return mock_session

    def test_query_connects_lazily(self):
        """query() must call connect() when driver is None."""
        client = GraphClient(_make_settings())

        with patch.object(client, "connect") as mock_connect:
            mock_driver = MagicMock()
            mock_session = self._make_mock_session([])
            mock_driver.session.return_value = mock_session

            # connect() sets self._driver as a side effect
            def _set_driver():
                client._driver = mock_driver

            mock_connect.side_effect = _set_driver

            mock_su = MagicMock()
            with patch("src.graph.client.ServiceUnavailable", mock_su):
                result = client.query("RETURN 1 AS n")

        mock_connect.assert_called_once()
        assert isinstance(result, list)

    def test_query_returns_list_of_dicts(self):
        client = GraphClient(_make_settings())
        mock_driver = MagicMock()
        # Simulate two records: each is dict-convertible
        record1 = {"name": "Alice"}
        record2 = {"name": "Bob"}
        mock_session = self._make_mock_session([record1, record2])
        mock_driver.session.return_value = mock_session
        client._driver = mock_driver

        mock_su = MagicMock()
        with patch("src.graph.client.ServiceUnavailable", mock_su):
            results = client.query("MATCH (n) RETURN n.name AS name")

        assert results == [{"name": "Alice"}, {"name": "Bob"}]

    def test_query_passes_params_to_session_run(self):
        client = GraphClient(_make_settings())
        mock_driver = MagicMock()
        mock_session = self._make_mock_session([])
        mock_driver.session.return_value = mock_session
        client._driver = mock_driver

        mock_su = MagicMock()
        with patch("src.graph.client.ServiceUnavailable", mock_su):
            client.query("MATCH (n {id: $id}) RETURN n", params={"id": 42})

        mock_session.run.assert_called_once_with(
            "MATCH (n {id: $id}) RETURN n", parameters={"id": 42}
        )

    def test_query_wraps_service_unavailable(self):
        """ServiceUnavailable from the driver must become GraphConnectionError."""
        client = GraphClient(_make_settings())
        mock_driver = MagicMock()
        mock_session = MagicMock()
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)
        client._driver = mock_driver
        mock_driver.session.return_value = mock_session

        # Create a real exception class to use as ServiceUnavailable substitute
        class FakeServiceUnavailable(Exception):
            pass

        mock_session.run.side_effect = FakeServiceUnavailable("down")

        with patch("src.graph.client.ServiceUnavailable", FakeServiceUnavailable):
            with pytest.raises(GraphConnectionError):
                client.query("RETURN 1")

    def test_query_raises_when_neo4j_not_installed(self):
        """query() raises GraphConnectionError if neo4j ServiceUnavailable is None."""
        client = GraphClient(_make_settings())
        mock_driver = MagicMock()
        client._driver = mock_driver

        with patch("src.graph.client.ServiceUnavailable", None):
            with pytest.raises(GraphConnectionError) as exc_info:
                client.query("RETURN 1")
        assert "not installed" in str(exc_info.value)


class TestExceptionHierarchy:
    def test_graph_connection_error_is_graph_error(self):
        assert issubclass(GraphConnectionError, GraphError)

    def test_graph_error_is_exception(self):
        assert issubclass(GraphError, Exception)


# ---------------------------------------------------------------------------
# Integration tests (skipped unless -m integration)
# ---------------------------------------------------------------------------

@pytest.mark.integration
class TestGraphClientIntegration:
    """
    Requires a running Neo4j instance at bolt://localhost:7687
    with credentials neo4j / horus-neo4j.

    Run with: pytest -m integration
    """

    def test_connect_to_live_neo4j(self):
        settings = _make_settings(
            uri="bolt://localhost:7687",
            user="neo4j",
            password="horus-neo4j",
        )
        client = GraphClient(settings)
        try:
            client.connect()
            assert client._driver is not None
        finally:
            client.close()

    def test_query_returns_results_from_live_neo4j(self):
        settings = _make_settings(
            uri="bolt://localhost:7687",
            user="neo4j",
            password="horus-neo4j",
        )
        client = GraphClient(settings)
        try:
            results = client.query("RETURN 1 AS n")
            assert results == [{"n": 1}]
        finally:
            client.close()
