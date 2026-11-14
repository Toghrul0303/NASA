import numpy as np
import pytest

from spherex_backend import binfmt

# DATA_CONTRACT.md section 10.3
VECTOR_BYTES = bytes.fromhex("00 3C 00 BC 00 7E FF 7B FF FB 00 00 00 38 00 40".replace(" ", ""))
VECTOR_VALUES = [1.0, -1.0, np.nan, 65504.0, -65504.0, 0.0, 0.5, 2.0]


def test_vector_is_sixteen_bytes():
    assert len(VECTOR_BYTES) == 16


def test_contract_vector_decodes_little_endian():
    decoded = np.frombuffer(VECTOR_BYTES, dtype="<f2").astype(np.float64)
    expected = np.array(VECTOR_VALUES)
    assert np.array_equal(np.isnan(decoded), np.isnan(expected))
    finite = ~np.isnan(expected)
    assert np.array_equal(decoded[finite], expected[finite])


def test_contract_vector_raw_uint16_values():
    raw = np.frombuffer(VECTOR_BYTES, dtype="<u2").tolist()
    assert raw == [0x3C00, 0xBC00, 0x7E00, 0x7BFF, 0xFBFF, 0x0000, 0x3800, 0x4000]


def test_unpack_item_decodes_contract_vector():
    # 2 planes x 2 x 2: plane 0 = first four values, plane 1 = last four.
    intensity, sigma = binfmt.unpack_item(VECTOR_BYTES, 2, 2)
    assert intensity.dtype == np.float32 and sigma.dtype == np.float32
    assert intensity.shape == (2, 2) and sigma.shape == (2, 2)
    assert intensity[0, 0] == 1.0 and intensity[0, 1] == -1.0
    assert np.isnan(intensity[1, 0]) and intensity[1, 1] == 65504.0
    assert sigma.ravel().tolist() == [-65504.0, 0.0, 0.5, 2.0]


def test_pack_item_writes_contract_special_values():
    intensity = np.array([[1.0, -1.0], [np.nan, 65504.0]])
    sigma = np.array([[0.5, 2.0], [np.nan, 0.0]])
    data, saturated = binfmt.pack_item(intensity, sigma)
    assert saturated == 0
    # plane 0 then plane 1, C-order, little-endian
    assert data[:8] == bytes.fromhex("003C 00BC 007E FF7B".replace(" ", ""))
    assert data[8:] == bytes.fromhex("0038 0040 007E 0000".replace(" ", ""))


def test_pack_item_length_and_layout():
    h, w = 3, 5
    intensity = np.arange(h * w, dtype=np.float32).reshape(h, w)
    sigma = intensity + 100.0
    data, _ = binfmt.pack_item(intensity, sigma)
    assert len(data) == binfmt.item_nbytes(h, w) == 2 * h * w * 2
    flat = np.frombuffer(data, dtype="<f2").reshape(2, h, w)
    assert np.array_equal(flat[0], intensity)
    assert np.array_equal(flat[1], sigma)
    # offset = (((f*2 + p) * H + y) * W + x) * 2 for f = 0
    y, x = 2, 3
    offset = (((0 * 2 + 1) * h + y) * w + x) * 2
    assert np.frombuffer(data[offset : offset + 2], dtype="<f2")[0] == sigma[y, x]


def test_pack_item_row_zero_is_first_row_no_flip():
    intensity = np.zeros((2, 2))
    intensity[0, 0] = 7.0  # y = 0 (southern row), x = 0
    data, _ = binfmt.pack_item(intensity, np.ones((2, 2)))
    assert np.frombuffer(data[:2], dtype="<f2")[0] == 7.0


def test_saturated_values_are_clipped_and_counted_over_both_planes():
    intensity = np.array([[70000.0, -70000.0], [1.0, 2.0]])
    sigma = np.array([[1.0, 1.0], [1e9, 1.0]])
    data, saturated = binfmt.pack_item(intensity, sigma)
    assert saturated == 3
    half = np.frombuffer(data, dtype="<f2").astype(np.float64).reshape(2, 2, 2)
    assert half[0, 0, 0] == 65504.0 and half[0, 0, 1] == -65504.0
    assert half[1, 1, 0] == 65504.0
    assert not np.isinf(half).any()


def test_value_exactly_at_limit_is_not_saturated():
    _, saturated = binfmt.pack_item(np.full((2, 2), 65504.0), np.full((2, 2), -65504.0))
    assert saturated == 0


def test_plane_one_is_nan_exactly_where_plane_zero_is_nan():
    intensity = np.array([[np.nan, 1.0], [2.0, 3.0]])
    sigma = np.array([[1.0, np.nan], [1.0, 1.0]])
    data, _ = binfmt.pack_item(intensity, sigma)
    half = np.frombuffer(data, dtype="<f2").reshape(2, 2, 2)
    assert np.array_equal(np.isnan(half[0]), np.isnan(half[1]))
    assert np.isnan(half[0]).tolist() == [[True, True], [False, False]]


def test_infinity_becomes_nan_in_both_planes():
    intensity = np.array([[np.inf, 1.0], [1.0, 1.0]])
    sigma = np.array([[1.0, -np.inf], [1.0, 1.0]])
    data, saturated = binfmt.pack_item(intensity, sigma)
    half = np.frombuffer(data, dtype="<f2").reshape(2, 2, 2)
    assert not np.isinf(half).any()
    assert np.isnan(half[:, 0, :]).all()
    assert saturated == 0


def test_nan_is_written_as_7e00_little_endian():
    data, _ = binfmt.pack_item(np.full((2, 2), np.nan), np.full((2, 2), np.nan))
    assert data == b"\x00\x7e" * 8


def test_inputs_are_not_modified():
    intensity = np.array([[np.inf, 1.0], [1.0, 1.0]], dtype=np.float32)
    sigma = np.array([[1.0, 1.0], [1.0, 70000.0]], dtype=np.float32)
    i0, s0 = intensity.copy(), sigma.copy()
    binfmt.pack_item(intensity, sigma)
    assert np.array_equal(intensity, i0) and np.array_equal(sigma, s0)


def test_round_trip_through_unpack_item():
    rng = np.random.default_rng(0)
    intensity = rng.normal(size=(6, 4)).astype(np.float32)
    sigma = np.abs(rng.normal(size=(6, 4))).astype(np.float32)
    intensity[1, 2] = np.nan
    data, _ = binfmt.pack_item(intensity, sigma)
    got_i, got_s = binfmt.unpack_item(data, 6, 4)
    assert np.array_equal(np.isnan(got_i), np.isnan(got_s))
    keep = ~np.isnan(got_i)
    assert np.allclose(got_i[keep], intensity[keep], rtol=1e-3, atol=1e-3)
    assert np.allclose(got_s[keep], sigma[keep], rtol=1e-3, atol=1e-3)


def test_round_half_to_even():
    # 2049 is exactly between the float16 neighbours 2048 and 2050.
    data, _ = binfmt.pack_item(np.full((2, 2), 2049.0), np.full((2, 2), 2051.0))
    half = np.frombuffer(data, dtype="<f2").astype(np.float64)
    assert half[0] == 2048.0  # ties to even mantissa
    assert half[4] == 2052.0


def test_expected_nbytes():
    assert binfmt.expected_nbytes(3, 60, 60) == 3 * 2 * 60 * 60 * 2
    assert binfmt.expected_nbytes(0, 60, 60) == 0


def test_decode_array_shape_and_size_check():
    data = b"".join(binfmt.pack_item(np.full((4, 3), float(i)), np.ones((4, 3)))[0] for i in range(2))
    array = binfmt.decode_array(data, 2, 4, 3)
    assert array.shape == (2, 2, 4, 3)
    assert array[1, 0, 0, 0] == 1.0
    with pytest.raises(ValueError):
        binfmt.decode_array(data[:-2], 2, 4, 3)


def test_unpack_item_rejects_wrong_length():
    with pytest.raises(ValueError):
        binfmt.unpack_item(VECTOR_BYTES, 3, 3)


def test_pack_item_rejects_shape_mismatch():
    with pytest.raises(ValueError):
        binfmt.pack_item(np.zeros((2, 2)), np.zeros((2, 3)))
    with pytest.raises(ValueError):
        binfmt.pack_item(np.zeros(4), np.zeros(4))
