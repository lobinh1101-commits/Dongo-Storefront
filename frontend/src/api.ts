export type UserRole = 'customer' | 'admin'

export type User = {
  id: number
  name: string
  email: string
  role: UserRole
}

export type Product = {
  id: number
  name: string
  category: string
  categoryKey: string
  price: number
  oldPrice: number | null
  badge: string | null
  rating: string
  reviews: number
  image: string
  color: string
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${apiBaseUrl}${url}`, { ...options, credentials: 'include', headers })
  const payload: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload
      ? String(payload.error)
      : 'Không thể kết nối máy chủ. Vui lòng thử lại.'
    throw new Error(message)
  }
  return payload as T
}
