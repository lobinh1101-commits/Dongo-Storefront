export function getAccountPresentation(user, loading) {
  if (loading) return { status: 'loading' }
  if (!user) return { status: 'anonymous', initial: null, actions: ['login', 'register'] }
  return {
    status: 'authenticated',
    name: user.name,
    email: user.email,
    initial: user.name.trim().charAt(0).toLocaleUpperCase('vi') || null,
  }
}

export function createAuthRevision() {
  let revision = 0

  return {
    next() {
      revision += 1
      return revision
    },
    isCurrent(requestRevision) {
      return revision === requestRevision
    },
  }
}
