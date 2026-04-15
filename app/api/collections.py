from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.social import MediaType
from app.models.user import User
from app.services.auth import get_current_user
from app.services.rate_limit import rate_limit
from app.services.social import add_post_to_collection, create_collection, list_collections


router = APIRouter(prefix="/collections")


class CollectionCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Collection name cannot be blank")
        return normalized


class CollectionAddPostRequest(BaseModel):
    post_id: int = Field(gt=0)


class CollectionPostRead(BaseModel):
    id: int
    caption: str | None = None
    media_url: str
    media_type: MediaType
    created_at: object


class CollectionRead(BaseModel):
    id: int
    name: str
    created_at: object
    posts_count: int
    posts: list[CollectionPostRead]


class CollectionListResponse(BaseModel):
    items: list[CollectionRead]
    limit: int
    offset: int
    total: int


@router.post("/create", response_model=CollectionRead, status_code=status.HTTP_201_CREATED)
def create_collection_endpoint(
    payload: CollectionCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("collections_create", 40, 3600)),
) -> CollectionRead:
    try:
        collection = create_collection(db=db, user_id=current_user.id, name=payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return CollectionRead.model_validate(collection)


@router.post("/{collection_id}/add-post", response_model=CollectionRead)
def add_post_to_collection_endpoint(
    collection_id: int,
    payload: CollectionAddPostRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(rate_limit("collections_add_post", 120, 3600)),
) -> CollectionRead:
    try:
        collection = add_post_to_collection(
            db=db,
            collection_id=collection_id,
            post_id=payload.post_id,
            current_user_id=current_user.id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return CollectionRead.model_validate(collection)


@router.get("", response_model=CollectionListResponse)
def get_collections(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CollectionListResponse:
    items, total = list_collections(db=db, user_id=current_user.id, limit=limit, offset=offset)
    return CollectionListResponse(
        items=[CollectionRead.model_validate(item) for item in items],
        limit=limit,
        offset=offset,
        total=total,
    )
