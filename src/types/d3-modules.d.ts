/** Minimal types for the d3 modules already in package.json. No extra `@types` dependency. */

declare module 'd3-scale' {
  export interface LinearScale {
    (value: number): number
    invert(value: number): number
    domain(domain: readonly number[]): this
    range(range: readonly number[]): this
    clamp(clamp: boolean): this
    ticks(count?: number): number[]
    tickFormat(count?: number, specifier?: string): (value: number) => string
  }
  export function scaleLinear(): LinearScale
  export function scaleLog(): LinearScale
}

declare module 'd3-array' {
  export function max<T>(
    values: Iterable<T>,
    accessor: (value: T) => number | null | undefined,
  ): number | undefined
  export function extent(values: Iterable<number>): [number, number] | [undefined, undefined]
  export function median(values: Iterable<number | null | undefined>): number | undefined
}

declare module 'd3-format' {
  export interface FormatFn {
    (value: number): string
  }
  export function format(specifier: string): FormatFn
}
