'use client'
import type { ClipboardEvent } from 'react'
import type { FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { parseCoordinatePair } from '@/lib/location'
import type { LocationFormValues } from '@/lib/spaceLocationForm'

interface SpaceLocationFieldsProps {
  // The host forms carry more fields than these; only the location slice is
  // touched here, so the form helpers are narrowed to it.
  register: UseFormRegister<LocationFormValues>
  setValue: UseFormSetValue<LocationFormValues>
  errors: FieldErrors<LocationFormValues>
  /** Distinguishes the ids when the new-space form and the edit dialog coexist. */
  idPrefix: string
}

/** Postcode and coordinates for the admin space forms (new + edit). */
export function SpaceLocationFields({ register, setValue, errors, idPrefix }: SpaceLocationFieldsProps) {
  // A maps app copies "38.755723, -9.279799" as one string; take the pair
  // wherever it lands instead of making the operator split it by hand.
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pair = parseCoordinatePair(event.clipboardData.getData('text'))
    if (!pair) return
    event.preventDefault()
    setValue('latitude', pair[0], { shouldValidate: true, shouldDirty: true })
    setValue('longitude', pair[1], { shouldValidate: true, shouldDirty: true })
  }

  const field = (name: keyof LocationFormValues) => `${idPrefix}-${name}`
  const error = (name: keyof LocationFormValues) =>
    errors[name] && (
      <p role="alert" id={`${field(name)}-error`} className="text-xs text-red-500 mt-1">
        {errors[name]?.message}
      </p>
    )
  const describedBy = (name: keyof LocationFormValues) => (errors[name] ? `${field(name)}-error` : undefined)

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={field('postal_code')}>Código postal</Label>
        <Input
          id={field('postal_code')}
          {...register('postal_code')}
          className="mt-1"
          placeholder="ex: 2745-841"
          autoComplete="postal-code"
          aria-invalid={!!errors.postal_code}
          aria-describedby={describedBy('postal_code')}
        />
        {error('postal_code')}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor={field('latitude')}>Latitude</Label>
          <Input
            id={field('latitude')}
            {...register('latitude')}
            onPaste={handlePaste}
            className="mt-1"
            inputMode="decimal"
            placeholder="ex: 38.755723"
            aria-invalid={!!errors.latitude}
            aria-describedby={describedBy('latitude')}
          />
          {error('latitude')}
        </div>
        <div>
          <Label htmlFor={field('longitude')}>Longitude</Label>
          <Input
            id={field('longitude')}
            {...register('longitude')}
            onPaste={handlePaste}
            className="mt-1"
            inputMode="decimal"
            placeholder="ex: -9.279799"
            aria-invalid={!!errors.longitude}
            aria-describedby={describedBy('longitude')}
          />
          {error('longitude')}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Pode copiar as coordenadas de uma app de mapas: toque e mantenha o dedo (ou clique com o botão direito) no
        local e copie os números. Se colar o par num dos campos, preenchemos os dois. Sem coordenadas, os
        clientes veem só a morada, sem mapa.
      </p>
    </div>
  )
}
