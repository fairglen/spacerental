import type { Locale } from 'date-fns'
import { pt } from 'date-fns/locale'

// date-fns 4 moved `pt` to a Sunday week start (CLDR's territory data for
// Portugal); the product's week runs Monday to Sunday everywhere else
// (bookingWindow, availabilitySpan, the admin range, the browser suite), so
// the calendars take this locale instead of the stock one (D21, #103).
export const ptMonday: Locale = { ...pt, options: { ...pt.options, weekStartsOn: 1 } }
