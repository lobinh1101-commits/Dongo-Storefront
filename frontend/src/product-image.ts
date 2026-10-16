import type { SyntheticEvent } from 'react'

const fallbackImage = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 630"><rect width="600" height="630" fill="#eeede5"/><circle cx="300" cy="275" r="78" fill="#d9f46a"/><path d="M263 265h74l-7 87h-60z" fill="none" stroke="#203a32" stroke-width="9" stroke-linejoin="round"/><path d="M279 266v-14a21 21 0 0 1 42 0v14" fill="none" stroke="#203a32" stroke-width="9" stroke-linecap="round"/><text x="300" y="440" fill="#203a32" font-family="Arial,sans-serif" font-size="32" font-weight="700" text-anchor="middle">dongo.</text></svg>',
)

export function productImageUrl(image: string, width: number, quality: number) {
  if (typeof image !== 'string' || !image.trim()) return fallbackImage
  const reference = image.trim()

  if (reference.startsWith('/') && !reference.startsWith('//') && !reference.includes('\\')) {
    try {
      if (new URL(reference, window.location.origin).origin === window.location.origin) return reference
    } catch {
      return fallbackImage
    }
  }

  if (/^photo-[\w-]+$/.test(reference)) {
    return `https://images.unsplash.com/${reference}?auto=format&fit=crop&w=${width}&q=${quality}`
  }

  try {
    const url = new URL(reference)
    if (url.protocol === 'https:' && !url.username && !url.password) return reference
  } catch {
    return fallbackImage
  }

  return fallbackImage
}

export function handleImageError(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget
  if (image.dataset.fallback === 'true' || image.src === fallbackImage) {
    image.dataset.fallback = 'true'
    return
  }
  image.dataset.fallback = 'true'
  if (image.alt) image.alt = 'Hình ảnh tạm thời không khả dụng'
  image.src = fallbackImage
}
