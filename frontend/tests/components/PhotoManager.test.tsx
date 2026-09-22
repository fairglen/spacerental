import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PhotoManager } from '@/components/admin/PhotoManager'
import { adminApi } from '@/lib/api'
import type { Photo } from '@/types'

vi.mock('@/lib/hooks/useApi', () => ({ useApi: () => ({}) }))
vi.mock('@/lib/api', () => ({
  adminApi: { uploadPhoto: vi.fn(), deletePhoto: vi.fn(), reorderPhotos: vi.fn() },
}))

const photo = (id: string): Photo => ({
  id, url: `http://api/media/rooms/r/${id}.webp`, thumb_url: `http://api/media/rooms/r/${id}_thumb.webp`,
  width: 1600, height: 1200,
})
const three = [photo('a'), photo('b'), photo('c')]
const file = (name: string, type = 'image/jpeg', size = 1024) => {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

function renderManager(photos: Photo[] = three, onChange = vi.fn()) {
  render(<PhotoManager kind="rooms" entityId="room-1" entityName="Sala Calma" photos={photos} onChange={onChange} />)
  return { onChange }
}

const order = () => screen.getAllByRole('listitem').map((li) => li.getAttribute('data-photo-id'))

beforeEach(() => vi.clearAllMocks())

describe('PhotoManager — states', () => {
  it('says so when there are no photos yet, and still offers the upload', () => {
    renderManager([])
    expect(screen.getByText(/ainda não tem fotografias/i)).toBeVisible()
    expect(screen.getByLabelText(/adicionar fotografias/i)).toBeEnabled()
  })

  it('shows thumbnails in order and labels only the first as the cover', () => {
    renderManager()
    expect(order()).toEqual(['a', 'b', 'c'])
    const items = screen.getAllByRole('listitem')
    expect(within(items[0]).getByText('Capa')).toBeVisible()
    expect(within(items[1]).queryByText('Capa')).toBeNull()
    expect(within(items[0]).getByRole('img')).toHaveAttribute('src', three[0].thumb_url)
  })

  it('stops offering uploads at the limit of 10, and says why', () => {
    renderManager(Array.from({ length: 10 }, (_, i) => photo(`p${i}`)))
    expect(screen.getByLabelText(/adicionar fotografias/i)).toBeDisabled()
    expect(screen.getByText(/máximo de 10/i)).toBeVisible()
  })
})

describe('PhotoManager — reorder', () => {
  it('moves a photo up with the keyboard-friendly buttons and sends the full order', async () => {
    vi.mocked(adminApi.reorderPhotos).mockResolvedValue([three[1], three[0], three[2]])
    const { onChange } = renderManager()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Subir fotografia 2' }))

    await waitFor(() => expect(adminApi.reorderPhotos).toHaveBeenCalledWith('rooms', 'room-1', ['b', 'a', 'c'], expect.anything()))
    expect(onChange).toHaveBeenCalledWith([three[1], three[0], three[2]])
  })

  it('cannot move the first up or the last down', () => {
    renderManager()
    expect(screen.getByRole('button', { name: 'Subir fotografia 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Descer fotografia 3' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Descer fotografia 1' })).toBeEnabled()
  })

  it('reorders by drag and drop too', async () => {
    vi.mocked(adminApi.reorderPhotos).mockResolvedValue([three[2], three[0], three[1]])
    renderManager()
    const items = screen.getAllByRole('listitem')
    fireEvent.dragStart(items[2])
    fireEvent.dragOver(items[0])
    fireEvent.drop(items[0])
    await waitFor(() => expect(adminApi.reorderPhotos).toHaveBeenCalledWith('rooms', 'room-1', ['c', 'a', 'b'], expect.anything()))
  })

  it('keeps the old order and explains when the server refuses', async () => {
    vi.mocked(adminApi.reorderPhotos).mockRejectedValue({ response: { status: 409 } })
    const { onChange } = renderManager()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Descer fotografia 1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/atualiza a página/i)
    expect(onChange).not.toHaveBeenCalled()
    expect(order()).toEqual(['a', 'b', 'c'])
  })
})

describe('PhotoManager — delete', () => {
  it('asks first, and does nothing on cancel', async () => {
    const user = userEvent.setup()
    renderManager()
    await user.click(screen.getByRole('button', { name: 'Apagar fotografia 2' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/apagar esta fotografia/i)
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(adminApi.deletePhoto).not.toHaveBeenCalled()
  })

  it('deletes after confirmation', async () => {
    vi.mocked(adminApi.deletePhoto).mockResolvedValue([three[0], three[2]])
    const user = userEvent.setup()
    const { onChange } = renderManager()
    await user.click(screen.getByRole('button', { name: 'Apagar fotografia 2' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Apagar' }))
    await waitFor(() => expect(adminApi.deletePhoto).toHaveBeenCalledWith('rooms', 'room-1', 'b', expect.anything()))
    expect(onChange).toHaveBeenCalledWith([three[0], three[2]])
  })
})

describe('PhotoManager — upload', () => {
  const pick = (files: File[]) => fireEvent.change(screen.getByLabelText(/adicionar fotografias/i), { target: { files } })

  it('refuses a wrong type or an oversize file before any request, naming the file', async () => {
    renderManager()
    pick([file('notas.pdf', 'application/pdf'), file('enorme.jpg', 'image/jpeg', 9 * 1024 * 1024)])
    const errors = await screen.findAllByRole('alert')
    expect(errors.map((e) => e.textContent).join(' ')).toMatch(/notas\.pdf.*JPEG, PNG ou WebP/)
    expect(errors.map((e) => e.textContent).join(' ')).toMatch(/enorme\.jpg.*8 MB/)
    expect(adminApi.uploadPhoto).not.toHaveBeenCalled()
  })

  it('uploads several files one request at a time, with progress', async () => {
    let finishFirst: (photos: Photo[]) => void = () => {}
    vi.mocked(adminApi.uploadPhoto)
      .mockImplementationOnce((_k, _id, _file, _api, onProgress) => {
        onProgress?.(40)
        return new Promise<Photo[]>((resolve) => { finishFirst = resolve })
      })
      .mockResolvedValueOnce([...three, photo('d'), photo('e')])
    const { onChange } = renderManager()
    pick([file('um.jpg'), file('dois.png', 'image/png')])

    await waitFor(() => expect(adminApi.uploadPhoto).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('progressbar', { name: /um\.jpg/ })).toHaveAttribute('aria-valuenow', '40')
    // The second waits for the first: one request at a time.
    expect(adminApi.uploadPhoto).toHaveBeenCalledTimes(1)

    finishFirst([...three, photo('d')])
    await waitFor(() => expect(adminApi.uploadPhoto).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([...three, photo('d'), photo('e')]))
  })

  it.each([
    [415, /JPEG, PNG ou WebP/],
    [413, /8 MB/],
    [409, /máximo de 10/i],
    [429, /aguarda/i],
    [500, /não foi possível enviar/i],
  ])('explains a %i from the server next to the file, and carries on with the next one', async (status, message) => {
    vi.mocked(adminApi.uploadPhoto)
      .mockRejectedValueOnce({ response: { status } })
      .mockResolvedValueOnce([...three, photo('d')])
    renderManager()
    pick([file('falha.jpg'), file('boa.jpg')])
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('falha.jpg')
    expect(alert).toHaveTextContent(message)
    await waitFor(() => expect(adminApi.uploadPhoto).toHaveBeenCalledTimes(2))
  })

  it('accepts files dropped on the drop zone', async () => {
    vi.mocked(adminApi.uploadPhoto).mockResolvedValue([...three, photo('d')])
    renderManager()
    fireEvent.drop(screen.getByTestId('photo-dropzone'), { dataTransfer: { files: [file('largada.webp', 'image/webp')] } })
    await waitFor(() => expect(adminApi.uploadPhoto).toHaveBeenCalledTimes(1))
  })

  it('only sends as many files as there is room for', async () => {
    vi.mocked(adminApi.uploadPhoto).mockResolvedValue([])
    renderManager(Array.from({ length: 9 }, (_, i) => photo(`p${i}`)))
    pick([file('cabe.jpg'), file('nao-cabe.jpg')])
    await waitFor(() => expect(adminApi.uploadPhoto).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('alert')).toHaveTextContent(/nao-cabe\.jpg.*máximo de 10/i)
  })
})
