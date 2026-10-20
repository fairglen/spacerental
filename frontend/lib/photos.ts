import { t } from '@/lib/i18n'

/**
 * The upload limits, mirrored from `backend/app/media.py` so an operator gets
 * the answer before the round trip. The API remains the authority: it judges a
 * file by its content, which a browser's `file.type` (derived from the name)
 * cannot.
 */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024
export const MAX_PHOTOS = 10
export const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// B65: getters, so each message is read from the catalog of the moment it is
// shown (an upload is a client event) and the callers keep `PHOTO_MESSAGES.x`.
export const PHOTO_MESSAGES = {
  get type() { return t('photos.error_type') },
  get size() { return t('photos.error_size') },
  get limit() { return t('photos.error_limit') },
  get throttled() { return t('photos.error_throttled') },
  get generic() { return t('photos.error_generic') },
}

/** Why this file cannot be uploaded, or null if it can be tried. */
export function photoFileProblem(file: File): string | null {
  if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) return PHOTO_MESSAGES.type
  if (file.size > MAX_PHOTO_BYTES) return PHOTO_MESSAGES.size
  return null
}

export function photoUploadErrorMessage(status: number | undefined): string {
  switch (status) {
    case 415: return PHOTO_MESSAGES.type
    case 413: return PHOTO_MESSAGES.size
    case 409: return PHOTO_MESSAGES.limit
    case 429: return PHOTO_MESSAGES.throttled
    default: return PHOTO_MESSAGES.generic
  }
}
