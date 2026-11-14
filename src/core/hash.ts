/**
 * SHA-256 of file bytes. FRONTEND_SPEC §6.1.
 * Requires `crypto.subtle`, which browsers expose only in a secure context.
 */
import { ContractError } from '../contract/validate'

function toHex(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer)
  let hex = ''
  for (let i = 0; i < view.length; i += 1) {
    const byte = view[i]
    if (byte === undefined) continue
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

function asBufferSource(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bytes instanceof Uint8Array) {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy.buffer
  }
  return bytes
}

/** Lowercase hex SHA-256 of the given bytes. */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new ContractError('integrity_failed', 'A secure context (HTTPS or localhost) is required for SHA-256')
  }
  const digest = await subtle.digest('SHA-256', asBufferSource(bytes))
  return toHex(digest)
}
