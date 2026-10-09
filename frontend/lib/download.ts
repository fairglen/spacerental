// Hand the browser a file the API answered with a Bearer token (I06): a
// plain link could not carry the token, so the bytes come through axios and
// leave through an object URL.

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
