import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { aboutGlossary } from '../../src/config/copy'

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(full)
  }
  return out
}

describe('about glossary', () => {
  it('lists the 18 terms with unique ids and the micro sign', () => {
    expect(aboutGlossary).toHaveLength(18)
    expect(new Set(aboutGlossary.map((entry) => entry.id)).size).toBe(18)
    const text = aboutGlossary.map((entry) => `${entry.term} ${entry.definition}`).join(' ')
    expect(text).toContain('µm')
  })
})

describe('encoding', () => {
  it('keeps every source file valid UTF-8 with no replacement characters', () => {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    for (const file of sourceFiles('src')) {
      const text = decoder.decode(readFileSync(file))
      expect(text.includes('�'), file).toBe(false)
    }
  })
})
