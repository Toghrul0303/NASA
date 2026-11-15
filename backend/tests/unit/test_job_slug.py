"""Slug identity for POST /api/jobs (DATA_CONTRACT section 11.3). No network."""

import json

from spherex_backend.api import validate_request

# The body that reproduces data/c-a55d19970b4b8fd7. Proper motion is part of the key:
# the same RA and Dec without it is a different slug.
WISE_BODY = {
    "ra_deg": 133.795129,
    "dec_deg": -7.245147,
    "size_deg": 0.1,
    "name": "WISE 0855 coord",
    "pmra_mas_yr": -8120,
    "pmdec_mas_yr": 679,
}

PRESETS = {
    "c-a55d19970b4b8fd7": WISE_BODY,
    "c-843ee254e3d6b9be": {
        "ra_deg": 217.42894,
        "dec_deg": -62.67949,
        "size_deg": 0.1,
        "name": "Proxima Centauri",
    },
    "c-c8a384476c0ae479": {
        "ra_deg": 53.23268,
        "dec_deg": -9.45826,
        "size_deg": 0.1,
        "name": "Epsilon Eridani",
    },
}


def test_stored_tier2_request_normalizes_to_existing_slug():
    request = validate_request(json.dumps(WISE_BODY).encode())
    assert request.slug() == "c-a55d19970b4b8fd7"
    assert request.coord_epoch_year == 2000.0
    assert request.coord_epoch_assumed is True
    assert request.pmra_mas_yr == -8120.0
    assert request.pmdec_mas_yr == 679.0
    assert request.force_refresh is False


def test_preset_bodies_match_their_slugs():
    for slug, body in PRESETS.items():
        assert validate_request(json.dumps(body).encode()).slug() == slug


def test_same_position_without_proper_motion_is_a_different_slug():
    bare = {key: value for key, value in WISE_BODY.items() if not key.startswith("pm")}
    assert validate_request(json.dumps(bare).encode()).slug() != "c-a55d19970b4b8fd7"
