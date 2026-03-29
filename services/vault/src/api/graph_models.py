"""
Pydantic models for Vault Knowledge Service graph edge API endpoints.
"""

from pydantic import BaseModel, field_validator
from typing import Optional
from ..layer2.graph_edges import EdgeType


class EdgePropertiesModel(BaseModel):
    mechanism: Optional[str] = None
    role: Optional[str] = None


class CreateEdgeRequest(BaseModel):
    source_id: str
    target_id: str
    edge_type: str
    properties: EdgePropertiesModel = EdgePropertiesModel()

    @field_validator("edge_type")
    @classmethod
    def validate_edge_type(cls, v: str) -> str:
        EdgeType.from_str(v)  # raises ValueError if invalid
        return v.upper()


class EdgeResponse(BaseModel):
    source_id: str
    target_id: str
    edge_type: str
    properties: dict = {}


class GetEdgesRequest(BaseModel):
    page_id: str
    edge_type: Optional[str] = None


class GetEdgesResponse(BaseModel):
    page_id: str
    edges: list[EdgeResponse]


class DeleteEdgeRequest(BaseModel):
    source_id: str
    target_id: str
    edge_type: str


class TraverseGraphRequest(BaseModel):
    start_page_id: str
    edge_types: Optional[list[str]] = None
    max_depth: int = 3

    @field_validator("max_depth")
    @classmethod
    def validate_depth(cls, v: int) -> int:
        if not 1 <= v <= 10:
            raise ValueError("max_depth must be between 1 and 10")
        return v


class TraverseGraphResponse(BaseModel):
    start_page_id: str
    pages: list[dict]
    depth: int
