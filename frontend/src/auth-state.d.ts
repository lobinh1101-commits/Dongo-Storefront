export type AccountPresentation =
  | { status: 'loading' }
  | { status: 'anonymous'; initial: null; actions: ['login', 'register'] }
  | { status: 'authenticated'; name: string; email: string; initial: string | null }

export function getAccountPresentation(
  user: { name: string; email: string } | null,
  loading: boolean,
): AccountPresentation

export function createAuthRevision(): {
  next(): number
  isCurrent(requestRevision: number): boolean
}
