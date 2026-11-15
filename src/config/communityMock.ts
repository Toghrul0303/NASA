/**
 * Sample content for the Community concept preview. Nothing here is real user data:
 * the author is a fixed placeholder and no counts of any kind are kept.
 * Each sample points at a Tier 1 dataset; centres are from that dataset's meta.json.
 */
import type { ToolId } from './tools'

export interface CommunitySample {
  id: string
  title: string
  target: string
  slug: string
  tool: Exclude<ToolId, 'map'>
  /** Map view for the permalink: ICRS degrees and field of view in degrees. */
  view: { ra: number; dec: number; fov: number }
  note: string
  author: string
}

export const SAMPLE_AUTHOR = 'Sample author'

export const communitySamples: readonly CommunitySample[] = [
  {
    id: 'sample-barnard-blink',
    title: 'Does Barnard’s Star move between epochs?',
    target: 'Barnard’s Star',
    slug: 'barnards-star',
    tool: 'blink',
    view: { ra: 269.44623, dec: 4.768703, fov: 0.5 },
    note: 'Blink the epochs and watch the fixed stars stay still while one star shifts.',
    author: SAMPLE_AUTHOR,
  },
  {
    id: 'sample-wise-sed',
    title: 'A cold brown dwarf across the colours',
    target: 'WISE 0855-0714',
    slug: 'wise-0855',
    tool: 'sed',
    view: { ra: 133.736346, dec: -7.240271, fov: 0.5 },
    note: 'Read its brightness at each colour and see where the cold object stands out.',
    author: SAMPLE_AUTHOR,
  },
  {
    id: 'sample-eps-indi-diff',
    title: 'A mover in a difference image',
    target: 'Epsilon Indi B',
    slug: 'eps-indi-b',
    tool: 'diff',
    view: { ra: 331.096714, dec: -56.800686, fov: 0.5 },
    note: 'Subtract one epoch from another: fixed sources cancel and a mover leaves a plus and minus pair.',
    author: SAMPLE_AUTHOR,
  },
  {
    id: 'sample-rw-aur-rgb',
    title: 'A young star in false colour',
    target: 'RW Aurigae',
    slug: 'rw-aur',
    tool: 'rgb',
    view: { ra: 76.95656, dec: 30.401247, fov: 0.5 },
    note: 'Assign infrared colours to red, green and blue and compare the star with its surroundings.',
    author: SAMPLE_AUTHOR,
  },
]
