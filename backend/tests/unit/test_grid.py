import math

import numpy as np
import pytest

from spherex_backend.grid import PIXEL_SCALE_ARCSEC, Grid

CENTERS = [(210.80227, 54.34895), (150.7818, 3.3502), (0.01, -80.0), (133.795129, -7.245147)]


@pytest.mark.parametrize(("size", "width"), [(0.05, 30), (0.1, 60), (0.2, 118)])
def test_widths(size, width):
    grid = Grid.build(size, 180.0, 10.0)
    assert grid.width == width and grid.height == width


def test_grid_constants():
    grid = Grid.build(0.1, 123.4, -5.6)
    assert PIXEL_SCALE_ARCSEC == 6.15
    assert grid.crval1_deg == 123.4 and grid.crval2_deg == -5.6
    assert grid.crpix1 == grid.crpix2 == 60 / 2 + 0.5
    assert grid.cdelt1_deg == pytest.approx(-6.15 / 3600)
    assert grid.cdelt2_deg == pytest.approx(+6.15 / 3600)


def test_invalid_size_rejected():
    with pytest.raises(ValueError):
        Grid.build(0.15, 10.0, 10.0)


@pytest.mark.parametrize(("ra", "dec"), CENTERS)
def test_centre_pixel(ra, dec):
    grid = Grid.build(0.1, ra, dec)
    x, y = grid.world_to_pixel(ra, dec)
    assert x == pytest.approx(grid.width / 2 - 0.5, abs=1e-9)
    assert y == pytest.approx(grid.height / 2 - 0.5, abs=1e-9)
    assert isinstance(x, float) and isinstance(y, float)


def test_north_up_east_left():
    grid = Grid.build(0.1, 180.0, 0.0)
    x0, y0 = grid.world_to_pixel(180.0, 0.0)
    x_e, _ = grid.world_to_pixel(180.0 + 0.01, 0.0)  # east: larger RA
    _, y_n = grid.world_to_pixel(180.0, 0.01)  # north: larger Dec
    assert x_e < x0  # east at low x
    assert y_n > y0  # north at high y (y = 0 is the southern row)


def test_pixel_scale_is_6p15_arcsec():
    grid = Grid.build(0.1, 50.0, 20.0)
    _, y0 = grid.world_to_pixel(50.0, 20.0)
    _, y1 = grid.world_to_pixel(50.0, 20.0 + PIXEL_SCALE_ARCSEC / 3600)
    assert y1 - y0 == pytest.approx(1.0, abs=1e-6)
    x0, _ = grid.world_to_pixel(50.0, 20.0)
    x1, _ = grid.world_to_pixel(50.0 + PIXEL_SCALE_ARCSEC / 3600 / math.cos(math.radians(20.0)), 20.0)
    assert x0 - x1 == pytest.approx(1.0, abs=1e-3)


@pytest.mark.parametrize(("ra", "dec"), CENTERS)
@pytest.mark.parametrize("size", [0.05, 0.1, 0.2])
def test_matches_astropy_wcs_to_1e6_px(ra, dec, size):
    grid = Grid.build(size, ra, dec)
    wcs = grid.to_astropy_wcs()
    ys, xs = np.mgrid[0 : grid.height : 4, 0 : grid.width : 4]
    xs = xs.ravel().astype(float)
    ys = ys.ravel().astype(float)
    world_ra, world_dec = wcs.all_pix2world(xs, ys, 0)
    ours_x, ours_y = grid.world_to_pixel(world_ra, world_dec)
    ref_x, ref_y = wcs.all_world2pix(world_ra, world_dec, 0)
    assert np.max(np.abs(ours_x - ref_x)) < 1e-6
    assert np.max(np.abs(ours_y - ref_y)) < 1e-6
    # and the inverse agrees with astropy's pixel->world
    inv_ra, inv_dec = grid.pixel_to_world(xs, ys)
    d_ra = (inv_ra - world_ra + 180.0) % 360.0 - 180.0
    assert np.max(np.abs(d_ra * np.cos(np.radians(world_dec)))) * 3600 < 1e-6
    assert np.max(np.abs(inv_dec - world_dec)) * 3600 < 1e-6


@pytest.mark.parametrize(("ra", "dec"), CENTERS)
def test_round_trip(ra, dec):
    grid = Grid.build(0.2, ra, dec)
    xs = np.array([0.0, 10.5, 58.5, 117.0])
    ys = np.array([0.0, 3.25, 59.0, 117.0])
    world = grid.pixel_to_world(xs, ys)
    back_x, back_y = grid.world_to_pixel(*world)
    assert np.allclose(back_x, xs, atol=1e-6)
    assert np.allclose(back_y, ys, atol=1e-6)


def test_pixel_to_world_centre_and_scalar():
    grid = Grid.build(0.1, 359.999, 45.0)
    ra, dec = grid.pixel_to_world(grid.width / 2 - 0.5, grid.height / 2 - 0.5)
    assert isinstance(ra, float) and isinstance(dec, float)
    assert ra == pytest.approx(359.999, abs=1e-9)
    assert dec == pytest.approx(45.0, abs=1e-9)


def test_ra_wraps_into_0_360():
    grid = Grid.build(0.2, 359.99, 0.0)
    xs = np.array([0.0, 117.0])
    ras, _ = grid.pixel_to_world(xs, np.array([58.0, 58.0]))
    assert ((ras >= 0.0) & (ras < 360.0)).all()


def test_astropy_wcs_is_tan_north_up():
    wcs = Grid.build(0.1, 10.0, 20.0).to_astropy_wcs()
    assert list(wcs.wcs.ctype) == ["RA---TAN", "DEC--TAN"]
    assert wcs.wcs.crpix.tolist() == [30.5, 30.5]
