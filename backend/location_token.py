from __future__ import annotations

import hashlib
import math

from django.core import signing
from django.core.cache import cache

from config.constants import (
    LOCATION_CLAIM_MAX_ACCURACY_METERS,
    LOCATION_CLAIM_MAX_DRIFT_METERS,
    LOCATION_CLAIM_TTL_SECONDS,
)

_SALT = "location-claim"


def issue_location_claim(
    lat: float,
    lng: float,
    accuracy: float,
    user_id: int | None,
    *,
    unit_identifier: str,
) -> str:
    if accuracy > LOCATION_CLAIM_MAX_ACCURACY_METERS:
        msg = "GPS accuracy too low"
        raise ValueError(msg)
    return signing.dumps(
        {
            "lat": lat,
            "lng": lng,
            "accuracy": accuracy,
            "user_id": user_id,
            "unit_identifier": unit_identifier,
        },
        salt=_SALT,
    )


def verify_location_claim(  # noqa: PLR0913
    token: str,
    user_id: int | None,
    unit_identifier: str,
    submitted_lat: float,
    submitted_lng: float,
    max_drift: int = LOCATION_CLAIM_MAX_DRIFT_METERS,
) -> None:
    try:
        data = signing.loads(token, salt=_SALT, max_age=LOCATION_CLAIM_TTL_SECONDS)
    except signing.SignatureExpired as exc:
        msg = "Location claim has expired"
        raise ValueError(msg) from exc
    except signing.BadSignature as exc:
        msg = "Invalid location claim"
        raise ValueError(msg) from exc

    if data["user_id"] != user_id:
        msg = "Location claim belongs to a different user"
        raise ValueError(msg)

    if data.get("unit_identifier") != unit_identifier:
        msg = "Location claim is for a different unit"
        raise ValueError(msg)

    distance = _haversine_m(data["lat"], data["lng"], submitted_lat, submitted_lng)
    if distance > max_drift:
        msg = f"Submitted location is {distance:.0f}m from claimed GPS position"
        raise ValueError(msg)

    # Single-use: must run after every other check passes, so a failed verify
    # doesn't burn the token. cache.add returns False if the key already exists.
    token_hash = hashlib.sha256(token.encode()).hexdigest()[:32]
    if not cache.add(f"location-claim-used:{token_hash}", 1, LOCATION_CLAIM_TTL_SECONDS):
        msg = "Location claim already used"
        raise ValueError(msg)


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    earth_radius_m = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * earth_radius_m * math.asin(math.sqrt(a))
