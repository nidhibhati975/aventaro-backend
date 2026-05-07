from __future__ import annotations

import re
import base64
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from uuid import uuid4

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.media import MediaAsset
from app.utils.config import Settings, get_settings


logger = logging.getLogger("aventaro.media")
IMAGE_MIME_TYPES = {
    "image/jpeg": {".jpg", ".jpeg"},
    "image/png": {".png"},
    "image/webp": {".webp"},
    "image/gif": {".gif"},
    "image/heic": {".heic"},
    "image/heif": {".heif"},
}
VIDEO_MIME_TYPES = {
    "video/mp4": {".mp4"},
    "video/quicktime": {".mov"},
    "video/webm": {".webm"},
}
SAFE_FILENAME_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")


class MediaConfigurationError(RuntimeError):
    pass


class MediaValidationError(ValueError):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _require_media_settings(settings: Settings) -> None:
    missing = [
        name
        for name, value in {
            "S3_MEDIA_BUCKET": settings.s3_media_bucket,
            "CLOUDFRONT_MEDIA_DOMAIN": settings.cloudfront_media_domain,
            "CLOUDINARY_CLOUD_NAME": settings.cloudinary_cloud_name,
            "CLOUDINARY_API_KEY": settings.cloudinary_api_key,
            "CLOUDINARY_API_SECRET": settings.cloudinary_api_secret,
        }.items()
        if not value
    ]
    if missing:
        raise MediaConfigurationError(f"Media system is not configured: {', '.join(missing)}")


def _sanitize_filename(filename: str) -> str:
    cleaned = SAFE_FILENAME_PATTERN.sub("_", filename.strip()).strip("._")
    if not cleaned:
        return "media"
    return cleaned[:160]


def _extension(filename: str) -> str:
    if "." not in filename:
        return ""
    return f".{filename.rsplit('.', maxsplit=1)[1].lower()}"


def classify_and_validate_file(
    *,
    filename: str,
    mime_type: str,
    file_size_bytes: int,
    requested_media_type: str | None = None,
    duration_seconds: float | None = None,
) -> str:
    settings = get_settings()
    mime = mime_type.lower().strip()
    ext = _extension(filename)

    if mime in IMAGE_MIME_TYPES:
        media_type = "image"
        if file_size_bytes > settings.media_max_image_bytes:
            raise MediaValidationError("Image exceeds configured upload size limit")
        allowed_extensions = IMAGE_MIME_TYPES[mime]
    elif mime in VIDEO_MIME_TYPES:
        media_type = "video"
        if file_size_bytes > settings.media_max_video_bytes:
            raise MediaValidationError("Video exceeds configured upload size limit")
        if duration_seconds is not None and duration_seconds > settings.media_max_video_duration_seconds:
            raise MediaValidationError("Video exceeds configured duration limit")
        allowed_extensions = VIDEO_MIME_TYPES[mime]
    else:
        raise MediaValidationError("Unsupported media type")

    if requested_media_type and requested_media_type != media_type:
        raise MediaValidationError("Requested media type does not match MIME type")
    if file_size_bytes <= 0:
        raise MediaValidationError("File size must be greater than zero")
    if ext not in allowed_extensions:
        raise MediaValidationError("File extension does not match MIME type")
    return media_type


def _media_s3_client(settings: Settings):
    client_kwargs = {
        "region_name": settings.s3_media_region,
        "config": Config(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"}),
    }
    if settings.aws_access_key_id and settings.aws_secret_access_key:
        client_kwargs["aws_access_key_id"] = settings.aws_access_key_id
        client_kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    return boto3.client("s3", **client_kwargs)


def _cloudfront_url(domain: str, s3_key: str) -> str:
    normalized_domain = domain.strip().rstrip("/")
    if not normalized_domain.startswith(("http://", "https://")):
        normalized_domain = f"https://{normalized_domain}"
    return f"{normalized_domain}/{quote(s3_key, safe='/')}"


def _cloudinary_fetch_url(
    *,
    cloud_name: str,
    media_type: str,
    source_url: str,
) -> str:
    resource_type = "image" if media_type == "image" else "video"
    transformations = "f_auto,q_auto,c_limit,w_1600" if media_type == "image" else "f_auto,q_auto,vc_auto"
    encoded_source = quote(source_url, safe="")
    settings = get_settings()
    unsigned_path = f"{resource_type}/fetch/{transformations}/{encoded_source}"
    if settings.cloudinary_api_secret:
        digest = hashlib.sha1(f"{transformations}/{source_url}{settings.cloudinary_api_secret}".encode("utf-8")).digest()
        signature = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")[:8]
        return f"https://res.cloudinary.com/{cloud_name}/{resource_type}/fetch/s--{signature}--/{transformations}/{encoded_source}"
    return f"https://res.cloudinary.com/{cloud_name}/{unsigned_path}"


def create_presigned_media_upload(
    db: Session,
    *,
    user_id: int,
    filename: str,
    mime_type: str,
    file_size_bytes: int,
    requested_media_type: str | None = None,
    width: int | None = None,
    height: int | None = None,
    duration_seconds: float | None = None,
    checksum_sha256: str | None = None,
) -> tuple[MediaAsset, dict[str, object]]:
    settings = get_settings()
    _require_media_settings(settings)

    safe_filename = _sanitize_filename(filename)
    media_type = classify_and_validate_file(
        filename=safe_filename,
        mime_type=mime_type,
        file_size_bytes=file_size_bytes,
        requested_media_type=requested_media_type,
        duration_seconds=duration_seconds,
    )
    upload_id = uuid4().hex
    now = _utcnow()
    s3_key = f"{settings.media_upload_prefix}/{user_id}/{now:%Y/%m/%d}/{upload_id}/{safe_filename}"
    cdn_url = _cloudfront_url(settings.cloudfront_media_domain or "", s3_key)
    cloudinary_url = _cloudinary_fetch_url(
        cloud_name=settings.cloudinary_cloud_name or "",
        media_type=media_type,
        source_url=cdn_url,
    )

    expires_at = now + timedelta(seconds=settings.s3_presign_expiry_seconds)
    asset = MediaAsset(
        upload_id=upload_id,
        user_id=user_id,
        media_type=media_type,
        original_filename=safe_filename,
        mime_type=mime_type.lower().strip(),
        file_size_bytes=file_size_bytes,
        duration_seconds=duration_seconds,
        width=width,
        height=height,
        s3_bucket=settings.s3_media_bucket or "",
        s3_key=s3_key,
        cdn_url=cdn_url,
        cloudinary_url=cloudinary_url,
        checksum_sha256=checksum_sha256,
        status="pending_upload",
        upload_expires_at=expires_at,
        asset_metadata={
            "storage": "s3",
            "region": settings.s3_media_region,
            "cdn": "cloudfront",
            "transformations": "cloudinary_fetch_signed" if settings.cloudinary_api_secret else "cloudinary_fetch",
        },
    )
    db.add(asset)
    db.flush()

    params: dict[str, object] = {
        "Bucket": settings.s3_media_bucket,
        "Key": s3_key,
        "ContentType": asset.mime_type,
        "Metadata": {
            "upload-id": upload_id,
            "user-id": str(user_id),
            "media-type": media_type,
        },
    }
    if checksum_sha256:
        params["ChecksumSHA256"] = checksum_sha256

    try:
        upload_url = _media_s3_client(settings).generate_presigned_url(
            "put_object",
            Params=params,
            ExpiresIn=settings.s3_presign_expiry_seconds,
            HttpMethod="PUT",
        )
    except (BotoCoreError, ClientError) as exc:
        db.rollback()
        raise MediaConfigurationError("Unable to create S3 presigned upload URL") from exc

    db.commit()
    db.refresh(asset)
    return asset, {
        "upload_url": upload_url,
        "upload_method": "PUT",
        "upload_headers": {
            "Content-Type": asset.mime_type,
            "x-amz-meta-upload-id": upload_id,
            "x-amz-meta-user-id": str(user_id),
            "x-amz-meta-media-type": media_type,
            **({"x-amz-checksum-sha256": checksum_sha256} if checksum_sha256 else {}),
        },
        "expires_at": expires_at,
    }


def complete_media_upload(
    db: Session,
    *,
    user_id: int,
    upload_id: str,
    checksum_sha256: str | None = None,
    width: int | None = None,
    height: int | None = None,
    duration_seconds: float | None = None,
) -> MediaAsset:
    asset = db.scalar(select(MediaAsset).where(MediaAsset.upload_id == upload_id, MediaAsset.user_id == user_id))
    if asset is None:
        raise MediaValidationError("Upload not found")
    if asset.status not in {"pending_upload", "uploaded"}:
        raise MediaValidationError("Upload cannot be completed in its current state")
    if _ensure_aware_utc(asset.upload_expires_at) < _utcnow():
        asset.status = "failed"
        asset.validation_error = "Upload URL expired before completion"
        db.commit()
        raise MediaValidationError("Upload URL expired")

    if checksum_sha256 and asset.checksum_sha256 and checksum_sha256 != asset.checksum_sha256:
        asset.status = "failed"
        asset.validation_error = "Checksum mismatch"
        db.commit()
        raise MediaValidationError("Checksum mismatch")
    try:
        object_head = _media_s3_client(get_settings()).head_object(Bucket=asset.s3_bucket, Key=asset.s3_key)
    except (BotoCoreError, ClientError) as exc:
        raise MediaValidationError("Uploaded object is not available in S3") from exc
    uploaded_size = int(object_head.get("ContentLength") or 0)
    if uploaded_size != asset.file_size_bytes:
        asset.status = "failed"
        asset.validation_error = "Uploaded object size mismatch"
        db.commit()
        raise MediaValidationError("Uploaded object size mismatch")

    asset.checksum_sha256 = checksum_sha256 or asset.checksum_sha256
    asset.width = width or asset.width
    asset.height = height or asset.height
    asset.duration_seconds = duration_seconds or asset.duration_seconds
    classify_and_validate_file(
        filename=asset.original_filename,
        mime_type=asset.mime_type,
        file_size_bytes=asset.file_size_bytes,
        requested_media_type=asset.media_type,
        duration_seconds=asset.duration_seconds,
    )
    asset.status = "uploaded"
    asset.validation_error = None
    asset.completed_at = _utcnow()
    db.commit()
    db.refresh(asset)
    return asset


def get_media_upload_progress(db: Session, *, user_id: int, upload_id: str) -> dict[str, object]:
    asset = db.scalar(select(MediaAsset).where(MediaAsset.upload_id == upload_id, MediaAsset.user_id == user_id))
    if asset is None:
        raise MediaValidationError("Upload not found")
    progress = 100 if asset.status in {"uploaded", "attached"} else 0
    return {
        "upload_id": asset.upload_id,
        "status": asset.status,
        "progress": progress,
        "validation_error": asset.validation_error,
    }


def ensure_s3_lifecycle_policy() -> bool:
    settings = get_settings()
    if not settings.s3_media_bucket:
        raise MediaConfigurationError("S3_MEDIA_BUCKET is not configured")
    client = _media_s3_client(settings)
    prefix = f"{settings.media_upload_prefix.strip('/')}/"
    lifecycle = {
        "Rules": [
            {
                "ID": "aventaro-abandoned-media-upload-cleanup",
                "Status": "Enabled",
                "Filter": {"Prefix": prefix},
                "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1},
                "Expiration": {"Days": 7},
            }
        ]
    }
    try:
        client.put_bucket_lifecycle_configuration(
            Bucket=settings.s3_media_bucket,
            LifecycleConfiguration=lifecycle,
        )
    except (BotoCoreError, ClientError) as exc:
        raise MediaConfigurationError("Unable to configure S3 media lifecycle policy") from exc
    return True


def _delete_s3_object(asset: MediaAsset) -> None:
    try:
        _media_s3_client(get_settings()).delete_object(Bucket=asset.s3_bucket, Key=asset.s3_key)
    except (BotoCoreError, ClientError) as exc:
        logger.warning(
            "media_s3_delete_failed",
            extra={"event_type": "media_s3_delete_failed", "asset_id": asset.id, "error": str(exc)},
        )


def _invalidate_cloudfront(paths: list[str]) -> None:
    settings = get_settings()
    if not settings.cloudfront_distribution_id or not paths:
        return
    try:
        client = boto3.client("cloudfront")
        client.create_invalidation(
            DistributionId=settings.cloudfront_distribution_id,
            InvalidationBatch={
                "Paths": {"Quantity": len(paths), "Items": paths},
                "CallerReference": f"media-cleanup-{uuid4().hex}",
            },
        )
    except (BotoCoreError, ClientError) as exc:
        logger.warning(
            "media_cloudfront_invalidation_failed",
            extra={"event_type": "media_cloudfront_invalidation_failed", "error": str(exc)},
        )


def cleanup_expired_media_uploads(db: Session, *, batch_size: int | None = None) -> dict[str, int]:
    settings = get_settings()
    now = _utcnow()
    limit = batch_size or settings.media_cleanup_batch_size
    orphan_cutoff = now - timedelta(minutes=settings.media_orphan_grace_minutes)
    assets = db.scalars(
        select(MediaAsset)
        .where(
            MediaAsset.status.in_(("pending_upload", "uploaded")),
            (
                (MediaAsset.status == "pending_upload") & (MediaAsset.upload_expires_at <= now)
            )
            | (
                (MediaAsset.status == "uploaded")
                & (MediaAsset.message_id.is_(None))
                & (MediaAsset.completed_at.is_not(None))
                & (MediaAsset.completed_at <= orphan_cutoff)
            ),
        )
        .order_by(MediaAsset.created_at.asc())
        .limit(limit)
        .with_for_update(skip_locked=True)
    ).all()
    expired = 0
    orphaned = 0
    invalidation_paths: list[str] = []
    for asset in assets:
        if asset.status == "pending_upload":
            expired += 1
            asset.status = "failed"
            asset.validation_error = "Upload expired before completion"
        else:
            orphaned += 1
            _delete_s3_object(asset)
            asset.status = "deleted"
            asset.validation_error = "Completed upload was never attached"
            invalidation_paths.append(f"/{asset.s3_key}")
    if assets:
        db.commit()
        _invalidate_cloudfront(invalidation_paths)
    return {"expired": expired, "orphaned": orphaned}
