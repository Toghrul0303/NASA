/** Minimal types for the d3 modules already in package.json. No extra `@types` dependency. */

declare module 'd3-scale' {
  export interface LinearScale {
    (value: number): number
    invert(value: number): number
    domain(domain: readonly number[]): this
    range(range: readonly number[]): this
  }
  export function scaleLinear(): LinearScale
}

declare module 'd3-array' {
  export function max<T>(
    values: Iterable<T>,
    accessor: (value: T) => number | null | undefined,
  ): number | undefined
  export function extent(values: Iterable<number>): [number, number] | [undefined, undefined]
}
