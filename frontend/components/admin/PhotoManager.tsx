'use client'
import { useRef, useState, type DragEvent } from 'react'
import { ArrowDown, ArrowUp, Trash2, Upload } from 'lucide-react'
import { adminApi, type PhotoOwner } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { statusOf } from '@/lib/httpError'
import { ACCEPTED_PHOTO_TYPES, MAX_PHOTOS, PHOTO_MESSAGES, photoFileProblem, photoUploadErrorMessage } from '@/lib/photos'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Photo } from '@/types'

interface PhotoManagerProps {
  kind: PhotoOwner
  entityId: string
  /** For labels only: "Sala Calma", "Espaço Calmo". */
  entityName: string
  photos: Photo[]
  /** The server's new list after every successful change. */
  onChange: (photos: Photo[]) => void
}

type UploadRow = { key: string; name: string; state: 'waiting' | 'uploading' | 'done' | 'error'; progress: number; error?: string }

/**
 * The "Fotografias" section of the admin room and space forms (C15): a grid in
 * display order (the first is the cover), reorder by drag or by buttons, delete
 * with a confirm step, and an upload control that sends one file per request.
 *
 * Never optimistic: the list shown is always the last one the server returned,
 * so a refused reorder or a failed upload leaves the screen telling the truth.
 */
export function PhotoManager({ kind, entityId, entityName, photos, onChange }: PhotoManagerProps) {
  const api = useApi()
  const input = useRef<HTMLInputElement>(null)
  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [busy, setBusy] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [doomed, setDoomed] = useState<Photo | null>(null)
  const [dragged, setDragged] = useState<string | null>(null)
  const [overZone, setOverZone] = useState(false)

  const full = photos.length >= MAX_PHOTOS
  const patch = (key: string, change: Partial<UploadRow>) =>
    setUploads((rows) => rows.map((r) => (r.key === key ? { ...r, ...change } : r)))

  async function reorder(order: string[]) {
    setListError(null)
    setBusy(true)
    try {
      onChange(await adminApi.reorderPhotos(kind, entityId, order, api))
    } catch (error) {
      // 409: the list here is stale (a photo was added or removed elsewhere).
      setListError(
        statusOf(error) === 409
          ? 'A lista de fotografias mudou entretanto. Atualiza a página e tenta de novo.'
          : 'Não foi possível alterar a ordem. Tenta novamente.',
      )
    } finally {
      setBusy(false)
    }
  }

  function move(index: number, by: -1 | 1) {
    const order = photos.map((p) => p.id)
    const [id] = order.splice(index, 1)
    order.splice(index + by, 0, id)
    void reorder(order)
  }

  function dropOn(targetId: string) {
    if (!dragged || dragged === targetId) return
    const order = photos.map((p) => p.id).filter((id) => id !== dragged)
    order.splice(order.indexOf(targetId), 0, dragged)
    setDragged(null)
    void reorder(order)
  }

  async function remove(photo: Photo) {
    setListError(null)
    setBusy(true)
    try {
      onChange(await adminApi.deletePhoto(kind, entityId, photo.id, api))
      setDoomed(null)
    } catch {
      setListError('Não foi possível apagar a fotografia. Tenta novamente.')
      setDoomed(null)
    } finally {
      setBusy(false)
    }
  }

  // One request at a time, in the order picked: the API takes one file per
  // request, and a sequential queue keeps the order (and the cover) predictable.
  async function send(files: File[]) {
    if (files.length === 0) return
    const room = Math.max(0, MAX_PHOTOS - photos.length)
    const rows: UploadRow[] = files.map((file, i) => {
      const problem = photoFileProblem(file)
      const key = `${Date.now()}-${i}-${file.name}`
      if (problem) return { key, name: file.name, state: 'error', progress: 0, error: problem }
      return { key, name: file.name, state: 'waiting', progress: 0 }
    })
    // Only as many as fit; the rest are told why, without a pointless request.
    let slots = room
    for (const row of rows) {
      if (row.state !== 'waiting') continue
      if (slots > 0) slots -= 1
      else Object.assign(row, { state: 'error', error: PHOTO_MESSAGES.limit })
    }
    setUploads(rows)

    setBusy(true)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (row.state !== 'waiting') continue
      patch(row.key, { state: 'uploading' })
      try {
        const next = await adminApi.uploadPhoto(kind, entityId, files[i], api, (progress) => patch(row.key, { progress }))
        patch(row.key, { state: 'done', progress: 100 })
        onChange(next)
      } catch (error) {
        patch(row.key, { state: 'error', error: photoUploadErrorMessage(statusOf(error)) })
      }
    }
    setBusy(false)
    if (input.current) input.current.value = ''
  }

  function onZoneDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setOverZone(false)
    if (!full) void send(Array.from(event.dataTransfer.files))
  }

  return (
    <section aria-labelledby={`photos-${entityId}`} className="space-y-3">
      <h3 id={`photos-${entityId}`} className="text-sm font-semibold text-foreground">Fotografias</h3>

      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {entityName} ainda não tem fotografias. Os clientes veem um marcador no lugar delas.
        </p>
      ) : (
        <ol className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map((photo, index) => (
            <li
              key={photo.id}
              data-photo-id={photo.id}
              draggable={!busy}
              onDragStart={() => setDragged(photo.id)}
              onDragEnd={() => setDragged(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); dropOn(photo.id) }}
              className={cn(
                'relative overflow-hidden rounded-lg border border-border bg-white',
                dragged === photo.id && 'opacity-50',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- operator-uploaded files on the API's own origin; next/image would need every deployment's host allow-listed */}
              <img
                src={photo.thumb_url}
                alt={`Fotografia ${index + 1} de ${entityName}`}
                width={photo.width ?? 480}
                height={photo.height ?? 360}
                className="aspect-[4/3] w-full object-cover"
              />
              {index === 0 && (
                <span className="absolute left-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground">
                  Capa
                </span>
              )}
              <div className="flex items-center justify-between gap-1 p-1">
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={busy || index === 0}
                    aria-label={`Subir fotografia ${index + 1}`} onClick={() => move(index, -1)}>
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={busy || index === photos.length - 1}
                    aria-label={`Descer fotografia ${index + 1}`} onClick={() => move(index, 1)}>
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500" disabled={busy}
                  aria-label={`Apagar fotografia ${index + 1}`} onClick={() => setDoomed(photo)}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {photos.length > 1 && (
        <p className="text-xs text-muted-foreground">
          A primeira é a capa. Arrasta para mudar a ordem, ou usa as setas.
        </p>
      )}
      {listError && <p role="alert" className="text-sm text-red-600">{listError}</p>}

      <div
        data-testid="photo-dropzone"
        onDragOver={(e) => { e.preventDefault(); setOverZone(true) }}
        onDragLeave={() => setOverZone(false)}
        onDrop={onZoneDrop}
        className={cn(
          'rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground',
          overZone && !full && 'border-primary bg-accent/50',
        )}
      >
        <input
          ref={input}
          id={`photo-input-${entityId}`}
          type="file"
          multiple
          accept={ACCEPTED_PHOTO_TYPES.join(',')}
          disabled={full || busy}
          className="sr-only"
          onChange={(e) => void send(Array.from(e.target.files ?? []))}
        />
        <label
          htmlFor={`photo-input-${entityId}`}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 font-medium text-foreground',
            full || busy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accent',
          )}
        >
          <Upload className="h-4 w-4" aria-hidden /> Adicionar fotografias
        </label>
        <p className="mt-2 text-xs">
          {full
            ? 'Máximo de 10 fotografias. Apaga uma para adicionar outra.'
            : 'Ou larga aqui os ficheiros. JPEG, PNG ou WebP, até 8 MB cada, máximo de 10.'}
        </p>
      </div>

      {uploads.length > 0 && (
        <ul className="space-y-1 text-sm">
          {uploads.map((row) => (
            <li key={row.key}>
              {row.state === 'error' ? (
                <p role="alert" className="text-red-600">{row.name}: {row.error}</p>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="truncate">{row.name}</span>
                  {row.state === 'done' ? (
                    <span className="text-primary">enviada</span>
                  ) : (
                    <div
                      role="progressbar"
                      aria-label={`A enviar ${row.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={row.progress}
                      className="h-1.5 w-24 shrink-0 overflow-hidden rounded bg-accent"
                    >
                      <div className="h-full bg-primary transition-[width]" style={{ width: `${row.progress}%` }} />
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!doomed} onOpenChange={(open) => !open && setDoomed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apagar esta fotografia?</DialogTitle>
            <DialogDescription>
              Deixa de aparecer aos clientes e o ficheiro é removido. Não é possível desfazer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setDoomed(null)} disabled={busy}>Cancelar</Button>
            <Button type="button" className="bg-red-600 hover:bg-red-700" onClick={() => doomed && void remove(doomed)} disabled={busy}>
              Apagar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
