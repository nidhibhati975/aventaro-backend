from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session


EARTH_RADIUS_KM = 6371.0088
MAX_RADIUS_KM = 500.0


@dataclass(frozen=True)
class RadiusSearch:
    latitude: float
    longitude: float
    radius_km: float

    @property
    def radius_meters(self) -> float:
        return self.radius_km * 1000.0


def normalize_coordinate_pair(latitude: float | None, longitude: float | None) -> tuple[float | None, float | None]:
    if latitude is None and longitude is None:
        return None, None
    if latitude is None or longitude is None:
        raise ValueError("Both latitude and longitude are required")
    normalized_latitude = round(float(latitude), 6)
    normalized_longitude = round(((float(longitude) + 180.0) % 360.0) - 180.0, 6)
    if normalized_latitude < -90 or normalized_latitude > 90:
        raise ValueError("Latitude must be between -90 and 90")
    return normalized_latitude, normalized_longitude


def validate_coordinates(latitude: float | None, longitude: float | None, radius_km: float | None = None) -> RadiusSearch | None:
    normalized_latitude, normalized_longitude = normalize_coordinate_pair(latitude, longitude)
    if normalized_latitude is None and normalized_longitude is None:
        return None
    radius = radius_km if radius_km is not None else 50.0
    if radius <= 0 or radius > MAX_RADIUS_KM:
        raise ValueError(f"Radius must be greater than 0 and at most {MAX_RADIUS_KM} km")
    return RadiusSearch(latitude=normalized_latitude, longitude=normalized_longitude, radius_km=radius)


def validate_postgis_mapping(connection: Connection) -> None:
    result = connection.execute(
        text(
            """
            SELECT
                EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS has_postgis,
                EXISTS(
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'app_profiles' AND column_name = 'location_geog'
                ) AS has_profile_geog,
                EXISTS(
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'app_trips' AND column_name = 'location_geog'
                ) AS has_trip_geog
            """
        )
    ).mappings().first()
    if not result or not result["has_postgis"]:
        raise RuntimeError("PostGIS extension is not available")
    if not result["has_profile_geog"] or not result["has_trip_geog"]:
        raise RuntimeError("Geospatial generated columns are missing")


def ensure_geospatial_ready(db: Session) -> None:
    try:
        connection = db.connection()
        if connection.dialect.name != "postgresql":
            raise RuntimeError("Geospatial search requires PostgreSQL/PostGIS")
        validate_postgis_mapping(connection)
    except (SQLAlchemyError, RuntimeError) as exc:
        raise RuntimeError("PostGIS geospatial mapping is not ready") from exc


def profile_radius_condition(search: RadiusSearch):
    return text(
        "app_profiles.location_geog IS NOT NULL "
        "AND ST_DWithin("
        "app_profiles.location_geog, "
        "ST_SetSRID(ST_MakePoint(:geo_longitude, :geo_latitude), 4326)::geography, "
        ":geo_radius_meters"
        ")"
    ).bindparams(
        geo_longitude=search.longitude,
        geo_latitude=search.latitude,
        geo_radius_meters=search.radius_meters,
    )


def trip_radius_condition(search: RadiusSearch):
    return text(
        "app_trips.location_geog IS NOT NULL "
        "AND ST_DWithin("
        "app_trips.location_geog, "
        "ST_SetSRID(ST_MakePoint(:geo_longitude, :geo_latitude), 4326)::geography, "
        ":geo_radius_meters"
        ")"
    ).bindparams(
        geo_longitude=search.longitude,
        geo_latitude=search.latitude,
        geo_radius_meters=search.radius_meters,
    )


def profile_distance_order(search: RadiusSearch):
    return text(
        "ST_Distance("
        "app_profiles.location_geog, "
        "ST_SetSRID(ST_MakePoint(:geo_longitude, :geo_latitude), 4326)::geography"
        ") ASC"
    ).bindparams(geo_longitude=search.longitude, geo_latitude=search.latitude)


def trip_distance_order(search: RadiusSearch):
    return text(
        "ST_Distance("
        "app_trips.location_geog, "
        "ST_SetSRID(ST_MakePoint(:geo_longitude, :geo_latitude), 4326)::geography"
        ") ASC"
    ).bindparams(geo_longitude=search.longitude, geo_latitude=search.latitude)
