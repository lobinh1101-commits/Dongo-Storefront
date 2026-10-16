import { startTransition, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Heart,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  Trash2,
  X,
  UserRound,
} from 'lucide-react'
import './Storefront.css'
import { apiRequest, type Product, type User } from './api'
import { createAuthRevision, getAccountPresentation } from './auth-state.js'
import { ProductImage } from './ProductImage'
import { handleImageError } from './product-image'

const money = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
})

function loadFavorites(): number[] {
  try {
    const storedFavorites = localStorage.getItem('dongo-favorites')
    if (!storedFavorites) return []
    const parsed: unknown = JSON.parse(storedFavorites)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter(
      (id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
    ))]
  } catch {
    return []
  }
}

function loadCart(): Record<number, number> {
  try {
    const storedCart = localStorage.getItem('dongo-cart')
    if (!storedCart) return {}
    const parsed: unknown = JSON.parse(storedCart)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(([id, quantity]) =>
        /^\d+$/.test(id) && Number(id) > 0 &&
        typeof quantity === 'number' && Number.isInteger(quantity) && quantity > 0,
      ),
    )
  } catch {
    return {}
  }
}

function normalizeCart(cart: Record<number, number>, catalog: Product[]) {
  const availableIds = new Set(catalog.map(({ id }) => id))
  return Object.fromEntries(
    Object.entries(cart).flatMap(([id, quantity]) => {
      const productId = Number(id)
      if (!availableIds.has(productId) || !Number.isInteger(quantity) || quantity <= 0) return []
      return [[productId, Math.min(quantity, 20)]]
    }),
  )
}

function App() {
  const [products, setProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [productsError, setProductsError] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('featured')
  const [cart, setCart] = useState<Record<number, number>>(loadCart)
  const [favorites, setFavorites] = useState<number[]>(loadFavorites)
  const [cartOpen, setCartOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [email, setEmail] = useState('')
  const [newsletterBusy, setNewsletterBusy] = useState(false)
  const [newsletterMessage, setNewsletterMessage] = useState('')
  const [newsletterError, setNewsletterError] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutAfterAuth, setCheckoutAfterAuth] = useState(false)
  const [pendingOrderId, setPendingOrderId] = useState('')
  const [pendingOrderTotal, setPendingOrderTotal] = useState<number | null>(null)
  const [shipping, setShipping] = useState({ name: '', phone: '', address: '' })
  const [authRevision] = useState(createAuthRevision)
  const checkoutRequestId = useRef('')
  const handledPaymentReturn = useRef(false)
  const dialogOpenerRef = useRef<HTMLElement | null>(null)
  const dialogOpenerScrollRef = useRef<number | null>(null)
  const dialogEnvironmentRef = useRef<{
    scrollY: number
    bodyOverflow: string
    htmlOverflow: string
    bodyPosition: string
    bodyTop: string
    bodyLeft: string
    bodyRight: string
    bodyWidth: string
    htmlScrollBehavior: string
    backgroundElements: HTMLElement[]
    previousInert: boolean[]
  } | null>(null)
  const checkoutBusyRef = useRef(checkoutBusy)
  const activeDialogType = checkoutOpen ? 'checkout' : authModalOpen ? 'auth' : cartOpen ? 'cart' : null
  const activeDialogTypeRef = useRef(activeDialogType)

  useLayoutEffect(() => {
    activeDialogTypeRef.current = activeDialogType
    checkoutBusyRef.current = checkoutBusy
  }, [activeDialogType, checkoutBusy])

  const handleProductsResponse = (request: Promise<{ products: Product[] }>) => {
    void request
      .then(({ products: catalog }) => {
        setProducts(catalog)
        setCart((current) => normalizeCart(current, catalog))
        setProductsError('')
      })
      .catch((error) => {
        setProductsError(error instanceof Error ? error.message : 'Không thể tải danh sách sản phẩm.')
      })
      .finally(() => setProductsLoading(false))
  }

  const loadProducts = () => {
    setProductsLoading(true)
    setProductsError('')
    handleProductsResponse(apiRequest<{ products: Product[] }>('/api/products'))
  }

  useEffect(() => {
    const revision = authRevision.next()
    void apiRequest<{ user: User | null }>('/api/auth/me')
      .then(({ user: currentUser }) => {
        if (authRevision.isCurrent(revision)) setUser(currentUser)
      })
      .catch(() => {
        if (authRevision.isCurrent(revision)) setUser(null)
      })
      .finally(() => {
        if (authRevision.isCurrent(revision)) setSessionLoading(false)
      })

    return () => { authRevision.next() }
  }, [authRevision])

  useEffect(() => {
    handleProductsResponse(apiRequest<{ products: Product[] }>('/api/products'))
  }, [])

  useEffect(() => {
    if (handledPaymentReturn.current) return
    const query = new URLSearchParams(window.location.search)
    const paymentResult = query.get('payment')
    if (!paymentResult) return
    handledPaymentReturn.current = true
    const orderId = query.get('order')
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)

    if (paymentResult !== 'returned' || !orderId) {
      startTransition(() => setToast('Không thể xác minh kết quả thanh toán. Vui lòng liên hệ cửa hàng.'))
      return
    }

    void (async () => {
      try {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const result = await apiRequest<{ order: { paymentStatus: string } }>(`/api/orders/${orderId}`)
          if (result.order.paymentStatus === 'paid') {
            setCart({})
            setToast('Thanh toán thành công. Cảm ơn bạn đã mua hàng!')
            return
          }
          if (result.order.paymentStatus === 'failed') {
            setToast('Giao dịch chưa thành công. Bạn có thể thử thanh toán lại.')
            return
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1500))
        }
        setToast('Đơn hàng đang chờ VNPay xác nhận. Vui lòng kiểm tra lại sau.')
      } catch {
        setToast('Không thể tải trạng thái đơn hàng. Vui lòng đăng nhập để kiểm tra.')
      }
    })()
  }, [])

  useEffect(() => {
    localStorage.setItem('dongo-cart', JSON.stringify(cart))
  }, [cart])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!activeDialogType) return

    const selector = activeDialogType === 'cart'
      ? '.cart-drawer[role="dialog"]'
      : activeDialogType === 'auth'
        ? '.account-modal[role="dialog"]'
        : '.checkout-modal[role="dialog"]'
    const dialog = document.querySelector<HTMLElement>(selector)
    if (!dialog) return

    if (!dialogEnvironmentRef.current) {
      const backgroundElements = Array.from(
        document.querySelectorAll<HTMLElement>('.storefront > .announcement, .storefront > .site-header, .storefront > main, .storefront > footer'),
      )
      const environment = {
        scrollY: dialogOpenerScrollRef.current ?? window.scrollY,
        bodyOverflow: document.body.style.overflow,
        htmlOverflow: document.documentElement.style.overflow,
        bodyPosition: document.body.style.position,
        bodyTop: document.body.style.top,
        bodyLeft: document.body.style.left,
        bodyRight: document.body.style.right,
        bodyWidth: document.body.style.width,
        htmlScrollBehavior: document.documentElement.style.scrollBehavior,
        backgroundElements,
        previousInert: backgroundElements.map((element) => element.inert),
      }
      dialogEnvironmentRef.current = environment
      backgroundElements.forEach((element) => { element.inert = true })
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.top = `-${environment.scrollY}px`
      document.body.style.left = '0'
      document.body.style.right = '0'
      document.body.style.width = '100%'
      document.documentElement.style.overflow = 'hidden'
    }

    const initialFocus = activeDialogType === 'cart'
      ? dialog.querySelector<HTMLElement>('.drawer-close')
      : activeDialogType === 'auth'
        ? dialog.querySelector<HTMLElement>(authMode === 'register' ? '[name="name"]' : '[name="email"]')
          ?? dialog.querySelector<HTMLElement>('.drawer-close')
        : dialog.querySelector<HTMLElement>('[autocomplete="name"]') ?? dialog.querySelector<HTMLElement>('.drawer-close')
    const focusFrame = window.requestAnimationFrame(() => (initialFocus ?? dialog).focus({ preventScroll: true }))

    const getFocusableElements = () => Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (activeDialogType === 'checkout' && checkoutBusyRef.current) return
        if (activeDialogType === 'cart') setCartOpen(false)
        if (activeDialogType === 'auth') {
          setAuthModalOpen(false)
          setCheckoutAfterAuth(false)
        }
        if (activeDialogType === 'checkout') setCheckoutOpen(false)
        return
      }
      if (event.key !== 'Tab') return

      const focusableElements = getFocusableElements()
      if (!focusableElements.length) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusableElements[0]
      const last = focusableElements[focusableElements.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      if (activeDialogTypeRef.current !== null) return

      const environment = dialogEnvironmentRef.current
      if (!environment) return

      environment.backgroundElements.forEach((element, index) => { element.inert = environment.previousInert[index] })
      document.body.style.overflow = environment.bodyOverflow
      document.body.style.position = environment.bodyPosition
      document.body.style.top = environment.bodyTop
      document.body.style.left = environment.bodyLeft
      document.body.style.right = environment.bodyRight
      document.body.style.width = environment.bodyWidth
      document.documentElement.style.overflow = environment.htmlOverflow
      document.documentElement.style.scrollBehavior = 'auto'
      window.scrollTo(0, environment.scrollY)
      document.documentElement.style.scrollBehavior = environment.htmlScrollBehavior
      dialogEnvironmentRef.current = null

      const opener = dialogOpenerRef.current
      dialogOpenerRef.current = null
      dialogOpenerScrollRef.current = null
      if (opener?.isConnected && !opener.inert) opener.focus({ preventScroll: true })
    }
  }, [activeDialogType, authMode])

  const rememberDialogOpener = (opener: HTMLElement) => {
    if (activeDialogTypeRef.current === null && !dialogOpenerRef.current) {
      dialogOpenerRef.current = opener
      dialogOpenerScrollRef.current = window.scrollY
    }
  }

  const closeAuthModal = () => {
    setAuthModalOpen(false)
    setCheckoutAfterAuth(false)
  }

  const normalizedSearch = search
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  const categories = [
    { label: 'Tất cả', key: 'all' },
    ...Array.from(new Map(products.map(({ category, categoryKey }) => [categoryKey, category])).entries())
      .map(([key, label]) => ({ label, key })),
  ]

  const visibleProducts = products
    .filter((product) => activeCategory === 'all' || product.categoryKey === activeCategory)
    .filter((product) => {
      const searchableName = `${product.name} ${product.category}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
      return searchableName.includes(normalizedSearch)
    })
    .sort((first, second) => {
      if (sort === 'price-asc') return first.price - second.price
      if (sort === 'price-desc') return second.price - first.price
      return first.id - second.id
    })

  const cartItems = products.filter((product) => cart[product.id])
  const cartCount = Object.values(cart).reduce((total, quantity) => total + quantity, 0)
  const accountPresentation = getAccountPresentation(user, sessionLoading)
  const subtotal = cartItems.reduce(
    (total, product) => total + product.price * cart[product.id],
    0,
  )

  const addToCart = (productId: number) => {
    if ((cart[productId] ?? 0) >= 20) {
      setToast('Mỗi sản phẩm chỉ được đặt tối đa 20 chiếc trong một đơn hàng.')
      return
    }
    setCart((current) => ({ ...current, [productId]: (current[productId] ?? 0) + 1 }))
    const product = products.find(({ id }) => id === productId)
    setToast(`${product?.name ?? 'Sản phẩm'} đã được thêm vào giỏ hàng.`)
  }

  const updateQuantity = (productId: number, amount: number) => {
    setCart((current) => {
      const quantity = (current[productId] ?? 0) + amount
      if (quantity <= 0) {
        const nextCart = { ...current }
        delete nextCart[productId]
        return nextCart
      }
      return { ...current, [productId]: Math.min(quantity, 20) }
    })
  }

  const toggleFavorite = (productId: number) => {
    const nextFavorites = favorites.includes(productId)
      ? favorites.filter((favoriteId) => favoriteId !== productId)
      : [...favorites, productId]
    setFavorites(nextFavorites)
    try {
      localStorage.setItem('dongo-favorites', JSON.stringify(nextFavorites))
    } catch {
      setToast('Không thể lưu mục yêu thích trên thiết bị này; danh sách chỉ còn trong phiên hiện tại.')
    }
  }

  const showAllProducts = () => {
    setSearch('')
    setActiveCategory('all')
    setSort('featured')
    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const openAccount = (opener: HTMLElement) => {
    rememberDialogOpener(opener)
    setAuthError('')
    setAuthMode('login')
    setAuthModalOpen(true)
  }

  const openRegistration = (opener: HTMLElement) => {
    rememberDialogOpener(opener)
    setAuthError('')
    setAuthMode('register')
    setAuthModalOpen(true)
  }

  const openCart = (opener: HTMLElement) => {
    rememberDialogOpener(opener)
    setCartOpen(true)
  }

  const startCheckout = () => {
    if (!user) {
      setAuthError('Đăng nhập hoặc tạo tài khoản để tiếp tục thanh toán.')
      setAuthMode('login')
      setCheckoutAfterAuth(true)
      setCartOpen(false)
      setAuthModalOpen(true)
      return
    }
    if (!pendingOrderId) setShipping({ name: user.name, phone: '', address: '' })
    if (!pendingOrderId) checkoutRequestId.current = crypto.randomUUID()
    setCheckoutError('')
    setCartOpen(false)
    setCheckoutOpen(true)
  }

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthError('')
    setAuthBusy(true)
    const revision = authRevision.next()
    const form = new FormData(event.currentTarget)
    const payload = {
      name: String(form.get('name') ?? ''),
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    }
    try {
      const result = await apiRequest<{ user: User }>(`/api/auth/${authMode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (!authRevision.isCurrent(revision)) return
      setUser(result.user)
      setSessionLoading(false)
      setAuthModalOpen(false)
      setToast(`Xin chào, ${result.user.name}!`)
      if (checkoutAfterAuth) {
        if (!pendingOrderId) checkoutRequestId.current = crypto.randomUUID()
        if (!pendingOrderId) setShipping({ name: result.user.name, phone: '', address: '' })
        setCheckoutError('')
        setCheckoutOpen(true)
        setCheckoutAfterAuth(false)
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Không thể đăng nhập lúc này.')
    } finally {
      setAuthBusy(false)
    }
  }

  const handleLogout = async () => {
    authRevision.next()
    setUser(null)
    setSessionLoading(false)
    setAuthModalOpen(false)
    setCheckoutAfterAuth(false)
    setCheckoutOpen(false)
    setPendingOrderId('')
    setPendingOrderTotal(null)
    setShipping({ name: '', phone: '', address: '' })
    checkoutRequestId.current = ''
    try {
      await apiRequest<void>('/api/auth/logout', { method: 'POST' })
      setToast('Bạn đã đăng xuất.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể kết nối máy chủ.'
      setToast(`Đã xóa thông tin tài khoản trên giao diện nhưng không xác nhận được phiên máy chủ: ${message}`)
    }
  }

  const handleNewsletterSubmit = async () => {
    setNewsletterMessage('')
    setNewsletterError(false)
    setNewsletterBusy(true)
    try {
      await apiRequest<{ subscribed: boolean }>('/api/newsletter', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      setNewsletterMessage(`Đã đăng ký nhận tin với ${email.trim()}.`)
      setEmail('')
    } catch (error) {
      setNewsletterMessage(error instanceof Error ? error.message : 'Không thể đăng ký nhận tin lúc này.')
      setNewsletterError(true)
    } finally {
      setNewsletterBusy(false)
    }
  }

  const handleCheckout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user) {
      setCheckoutOpen(false)
      setCheckoutAfterAuth(true)
      setAuthModalOpen(true)
      return
    }
    setCheckoutError('')
    setCheckoutBusy(true)
    try {
      let orderId = pendingOrderId
      if (!orderId) {
        const order = await apiRequest<{ orderId: string; totalAmount: number }>('/api/orders', {
          method: 'POST',
          headers: { 'Idempotency-Key': checkoutRequestId.current },
          body: JSON.stringify({
            items: cartItems.map((product) => ({ productId: product.id, quantity: cart[product.id] })),
            shipping,
          }),
        })
        orderId = order.orderId
        setPendingOrderId(orderId)
        setPendingOrderTotal(order.totalAmount)
      }
      const payment = await apiRequest<{ paymentUrl: string }>('/api/payments/vnpay/create', {
        method: 'POST',
        body: JSON.stringify({ orderId }),
      })
      window.location.assign(payment.paymentUrl)
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'Không thể tạo thanh toán lúc này.')
    } finally {
      setCheckoutBusy(false)
    }
  }

  return (
    <div className="storefront">
      <div className="announcement">
        <span>GIAO HÀNG MIỄN PHÍ CHO ĐƠN TỪ 1.000.000Đ</span>
        <span className="announcement__note">Một chút vui cho ngày của bạn <Sparkles size={13} /></span>
      </div>

      <header className="site-header">
        <div className="masthead page-width">
          <a className="wordmark" href="#home" aria-label="Dongo, về đầu trang">
            dongo<span>.</span>
          </a>
          <nav className="primary-nav" aria-label="Điều hướng chính">
            <a href="#products">Cửa hàng</a>
            <a href="#about">Câu chuyện</a>
            <a href="#newsletter">Tạp chí</a>
          </nav>
          <label className="searchbox">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                document.getElementById('products')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              placeholder="Tìm món đồ bạn thích"
              aria-label="Tìm sản phẩm"
            />
            <kbd>/</kbd>
          </label>
          <div className={`header-actions${accountPresentation.status === 'anonymous' ? ' header-actions--anonymous' : ''}`}>
            {accountPresentation.status === 'loading' ? (
              <span className="account-session-loading" role="status" aria-label="Đang kiểm tra phiên đăng nhập">
                <UserRound size={16} aria-hidden="true" />
              </span>
            ) : accountPresentation.status === 'authenticated' ? (
              <button
                className="icon-button account-button"
                type="button"
                aria-label={`Tài khoản ${accountPresentation.name}`}
                onPointerDown={(event) => rememberDialogOpener(event.currentTarget)}
                onClick={(event) => openAccount(event.currentTarget)}
              >
                <span className="account-mark">{accountPresentation.initial ?? <UserRound size={15} aria-hidden="true" />}</span>
              </button>
            ) : (
              <div className="account-auth-actions">
                <button className="account-auth-button" type="button" onPointerDown={(event) => rememberDialogOpener(event.currentTarget)} onClick={(event) => openAccount(event.currentTarget)}>Đăng nhập</button>
                <button className="account-auth-button account-auth-button--register" type="button" onPointerDown={(event) => rememberDialogOpener(event.currentTarget)} onClick={(event) => openRegistration(event.currentTarget)}>Đăng ký</button>
              </div>
            )}
            <button
              className="icon-button bag-button"
              type="button"
              aria-label={`Mở giỏ hàng, ${cartCount} sản phẩm`}
              onPointerDown={(event) => rememberDialogOpener(event.currentTarget)}
              onClick={(event) => openCart(event.currentTarget)}
            >
              <ShoppingBag size={20} strokeWidth={1.7} />
              <span className="bag-count">{cartCount}</span>
            </button>
          </div>
        </div>
      </header>

      <main id="home">
        <section className="hero page-width" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><span className="eyebrow-dot" /> TUYỂN CHỌN CHO NHỊP SỐNG MỚI</p>
            <h1 id="hero-title">Đồ tốt<br />cho ngày <em>thường.</em></h1>
            <p className="hero-description">
              Những món đồ hữu ích, có gu và được làm ra để ở lại thật lâu bên bạn.
            </p>
            <a className="button button--lime" href="#products">
              Khám phá bộ sưu tập <ArrowRight size={17} />
            </a>
            <div className="hero-footnote"><span>01 / 03</span><span>ĐỒ DÙNG CÓ CHỦ ĐÍCH</span></div>
          </div>
          <div className="hero-visual">
            <img
              src="https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=1500&q=88"
              alt="Góc làm việc ấm áp với đèn bàn và những món đồ được tuyển chọn"
              onError={handleImageError}
            />
            <div className="hero-image-shade" />
            <div className="hero-caption"><span>GÓC NHỎ, NIỀM VUI LỚN</span><ArrowDown size={16} /></div>
            <div className="hero-sticker"><span>GOOD<br />THINGS</span><span>ONLY</span></div>
          </div>
        </section>

        <section className="benefits page-width" aria-label="Lợi ích mua sắm">
          <div className="benefit"><span className="benefit-number">01</span><p>Chọn lọc kỹ<br /><strong>chất lượng trước tiên</strong></p></div>
          <div className="benefit"><span className="benefit-number">02</span><p>Đóng gói chỉn chu<br /><strong>trao tay thật vui</strong></p></div>
          <div className="benefit"><span className="benefit-number">03</span><p>Đổi trả dễ dàng<br /><strong>trong vòng 7 ngày</strong></p></div>
          <a className="benefits-link" href="#about">Tìm hiểu về Dongo <ArrowRight size={15} /></a>
        </section>

        <section className="shop-section page-width" id="products" aria-labelledby="products-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow section-eyebrow">NHỮNG MÓN ĐỒ ĐANG ĐƯỢC YÊU THÍCH</p>
              <h2 id="products-title">Tìm thấy <em>điều hay.</em></h2>
            </div>
            <button className="text-link desktop-link show-all-button" type="button" onClick={showAllProducts}>Xem tất cả sản phẩm <ArrowRight size={16} /></button>
          </div>

          <div className="shop-toolbar">
            <div className="category-tabs" role="tablist" aria-label="Lọc theo danh mục">
              {categories.map((category) => (
                <button
                  className={`category-tab${activeCategory === category.key ? ' is-active' : ''}`}
                  key={category.key}
                  type="button"
                  role="tab"
                  aria-selected={activeCategory === category.key}
                  onClick={() => setActiveCategory(category.key)}
                >
                  {category.label}
                </button>
              ))}
            </div>
            <label className="sort-select">
              <span>Sắp xếp:</span>
              <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sắp xếp sản phẩm">
                <option value="featured">Nổi bật</option>
                <option value="price-asc">Giá tăng dần</option>
                <option value="price-desc">Giá giảm dần</option>
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </label>
          </div>

          {productsLoading ? (
            <div className="product-load-state" role="status">Đang tải sản phẩm...</div>
          ) : productsError ? (
            <div className="empty-results">
              <p role="alert">{productsError}</p>
              <button type="button" onClick={loadProducts}>Thử tải lại</button>
            </div>
          ) : visibleProducts.length > 0 ? (
            <div className="product-grid">
              {visibleProducts.map((product, index) => (
                <article className="product-card" key={product.id} style={{ animationDelay: `${index * 45}ms` }}>
                  <div className="product-image" style={{ backgroundColor: product.color }}>
                    <ProductImage
                      image={product.image}
                      width={900}
                      quality={82}
                      alt={product.name}
                      loading="lazy"
                    />
                    {product.badge && <span className={`product-badge${product.badge.startsWith('−') ? ' product-badge--sale' : ''}`}>{product.badge}</span>}
                    <button
                      className={`favorite-button${favorites.includes(product.id) ? ' is-favorite' : ''}`}
                      type="button"
                      aria-label={favorites.includes(product.id) ? `Bỏ yêu thích ${product.name}` : `Yêu thích ${product.name}`}
                      aria-pressed={favorites.includes(product.id)}
                      onClick={() => toggleFavorite(product.id)}
                    >
                      <Heart size={18} fill={favorites.includes(product.id) ? 'currentColor' : 'none'} />
                    </button>
                    <button className="quick-add" type="button" onClick={() => addToCart(product.id)} disabled={(cart[product.id] ?? 0) >= 20}>
                      <Plus size={16} /> Thêm vào giỏ
                    </button>
                  </div>
                  <div className="product-details">
                    <div className="product-meta"><span>{product.category}</span><span className="product-rating">★ {product.rating} <small>({product.reviews})</small></span></div>
                    <h3>{product.name}</h3>
                    <div className="product-prices"><strong>{money.format(product.price)}</strong>{product.oldPrice && <del>{money.format(product.oldPrice)}</del>}</div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-results">
              <Search size={25} />
              <p>Chưa tìm thấy món đồ phù hợp.</p>
              <button type="button" onClick={() => { setSearch(''); setActiveCategory('all') }}>Xóa bộ lọc</button>
            </div>
          )}
          <button className="text-link mobile-link show-all-button" type="button" onClick={showAllProducts}>Xem tất cả sản phẩm <ArrowRight size={16} /></button>
        </section>

        <section className="story-band" id="about">
          <div className="story-inner page-width">
            <div className="story-image">
              <img src="https://images.unsplash.com/photo-1490312278390-ab64016e0aa9?auto=format&fit=crop&w=1200&q=85" alt="Không gian sống tối giản với những món đồ thân thuộc" loading="lazy" onError={handleImageError} />
              <span className="story-image-note">SỐNG CHẬM, CHỌN KỸ</span>
            </div>
            <div className="story-copy">
              <p className="eyebrow"><span className="eyebrow-dot" /> ÍT HƠN, NHƯNG TỐT HƠN</p>
              <h2>Không cần nhiều.<br />Chỉ cần <em>đúng món.</em></h2>
              <p>Dongo tin rằng một món đồ tốt không chỉ đẹp lúc mới mua. Nó cần hữu ích mỗi ngày, bền bỉ theo thời gian và khiến bạn vui mỗi khi chạm vào.</p>
              <a className="text-link" href="#newsletter">Đọc câu chuyện của chúng mình <ArrowRight size={16} /></a>
              <div className="story-scribble">choose<br />with care<span>↗</span></div>
            </div>
          </div>
        </section>

        <section className="newsletter page-width" id="newsletter">
          <div>
            <p className="eyebrow section-eyebrow">THƯ TỪ DONGO</p>
            <h2>Một chút cảm hứng,<br /><em>gửi đến bạn.</em></h2>
          </div>
          <form className="newsletter-form" onSubmit={(event) => {
            event.preventDefault()
            void handleNewsletterSubmit()
          }}>
            <label htmlFor="newsletter-email">Nhận tin về sản phẩm mới và những điều hay ho.</label>
            <div className="newsletter-input-wrap">
              <input id="newsletter-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Địa chỉ email của bạn" required disabled={newsletterBusy} />
              <button type="submit" aria-label="Đăng ký nhận tin" disabled={newsletterBusy}><ArrowRight size={19} /></button>
            </div>
            <small>Email được lưu để đăng ký nhận tin. Hệ thống hiện chưa gửi email tự động.</small>
            {newsletterMessage && <p className={`newsletter-message${newsletterError ? ' newsletter-message--error' : ''}`} role={newsletterError ? 'alert' : 'status'}>{newsletterMessage}</p>}
          </form>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-main page-width">
          <div className="footer-brand"><a className="wordmark" href="#home">dongo<span>.</span></a><p>Những món đồ tốt<br />cho những ngày bình thường.</p></div>
          <div className="footer-column"><h3>Khám phá</h3><a href="#products">Tất cả sản phẩm</a><a href="#products">Bộ sưu tập mới</a><a href="#about">Câu chuyện Dongo</a></div>
          <div className="footer-column"><h3>Hỗ trợ</h3><a href="mailto:hello@dongo.vn?subject=Giao%20h%C3%A0ng%20v%C3%A0%20%C4%91%E1%BB%95i%20tr%E1%BA%A3">Giao hàng & đổi trả · liên hệ hỗ trợ</a><a href="mailto:hello@dongo.vn?subject=C%C3%A2u%20h%E1%BB%8Fi%20th%C6%B0%E1%BB%9Dng%20g%E1%BA%B7p">Câu hỏi thường gặp · liên hệ hỗ trợ</a><a href="mailto:hello@dongo.vn">hello@dongo.vn</a></div>
          <div className="footer-note"><span>MADE FOR EVERYDAY</span><span>© 2026 DONGO STUDIO</span></div>
        </div>
        <div className="footer-bottom page-width"><span>Chọn điều tốt. Dùng thật lâu.</span><span>Việt Nam · VND ₫</span></div>
      </footer>

      {cartOpen && (
        <div className="drawer-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false) }}>
          <aside className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title" tabIndex={-1}>
            <div className="drawer-heading">
              <div><p className="eyebrow section-eyebrow">DONGO BAG</p><h2 id="cart-title">Giỏ hàng <span>({cartCount})</span></h2></div>
              <button className="icon-button drawer-close" type="button" aria-label="Đóng giỏ hàng" onClick={() => setCartOpen(false)}><X size={21} /></button>
            </div>
            {cartItems.length > 0 ? (
              <>
                <div className="cart-items">
                  {cartItems.map((product) => (
                    <div className="cart-item" key={product.id}>
                      <ProductImage image={product.image} width={240} quality={75} alt="" />
                      <div className="cart-item-info"><span>{product.category}</span><h3>{product.name}</h3><strong>{money.format(product.price)}</strong>
                        <div className="quantity-control" aria-label={`Số lượng ${product.name}`}>
                          <button type="button" aria-label="Giảm số lượng" onClick={() => updateQuantity(product.id, -1)}><Minus size={13} /></button>
                          <span>{cart[product.id]}</span>
                          <button type="button" aria-label="Tăng số lượng" disabled={cart[product.id] >= 20} onClick={() => updateQuantity(product.id, 1)}><Plus size={13} /></button>
                        </div>
                      </div>
                      <button className="remove-item" type="button" aria-label={`Xóa ${product.name}`} onClick={() => setCart((current) => { const nextCart = { ...current }; delete nextCart[product.id]; return nextCart })}><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
                <div className="drawer-summary"><div><span>Tạm tính</span><strong>{money.format(subtotal)}</strong></div><p>Thanh toán an toàn qua cổng VNPay.</p><button className="button button--dark checkout-button" type="button" onClick={startCheckout}>Tiếp tục đặt hàng <ArrowRight size={17} /></button><button className="continue-shopping" type="button" onClick={() => setCartOpen(false)}><ArrowLeft size={15} /> Tiếp tục mua sắm</button></div>
              </>
            ) : (
              <div className="empty-cart"><div className="empty-cart-icon"><ShoppingBag size={24} /></div><h3>Giỏ hàng đang trống</h3><p>Món đồ yêu thích tiếp theo đang chờ bạn khám phá.</p><button className="button button--dark" type="button" onClick={() => setCartOpen(false)}>Khám phá cửa hàng <ArrowRight size={16} /></button></div>
            )}
            <div className="drawer-perk"><Check size={15} /> Miễn phí giao hàng từ 1.000.000đ</div>
          </aside>
        </div>
      )}

      {authModalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAuthModal() }}>
        <section className="flow-modal account-modal" role="dialog" aria-modal="true" aria-labelledby="account-title" tabIndex={-1}>
            <div className="flow-modal-heading">
              <div><p className="eyebrow section-eyebrow">DONGO ACCOUNT</p><h2 id="account-title">{user ? 'Tài khoản của bạn' : authMode === 'register' ? 'Tạo tài khoản.' : 'Chào bạn trở lại.'}</h2></div>
              <button className="icon-button drawer-close" type="button" aria-label="Đóng hộp thoại tài khoản" onClick={closeAuthModal}><X size={21} /></button>
            </div>
            {user ? (
              <div className="account-summary">
                <div className="account-avatar">{user.name.charAt(0).toUpperCase()}</div>
                <h3>{user.name}</h3>
                <p>{user.email}</p>
                {user.role === 'admin' && <a className="button button--dark modal-submit admin-entry" href="/admin">Mở trang quản trị <ArrowRight size={16} /></a>}
                {authError && <p className="form-error" role="alert">{authError}</p>}
                <button className="button button--dark modal-submit" type="button" onClick={handleLogout}>Đăng xuất <ArrowRight size={16} /></button>
              </div>
            ) : (
              <>
                <p className="modal-intro">{authMode === 'register' ? 'Tạo tài khoản để theo dõi đơn hàng và thanh toán dễ dàng.' : 'Đăng nhập để tiếp tục với giỏ hàng của bạn.'}</p>
                <form className="flow-form" onSubmit={handleAuth}>
                  {authMode === 'register' && <label>Họ và tên<input name="name" type="text" autoComplete="name" minLength={2} maxLength={80} placeholder="Tên của bạn" required /></label>}
                  <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} placeholder="ban@email.com" required /></label>
                  <label>Mật khẩu<input name="password" type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} minLength={authMode === 'register' ? 8 : 1} maxLength={72} placeholder={authMode === 'register' ? 'Ít nhất 8 ký tự' : 'Mật khẩu của bạn'} required /></label>
                  {authError && <p className="form-error" role="alert">{authError}</p>}
                  <button className="button button--dark modal-submit" type="submit" disabled={authBusy}>{authBusy ? 'Đang xử lý...' : authMode === 'register' ? 'Tạo tài khoản' : 'Đăng nhập'} <ArrowRight size={16} /></button>
                </form>
                <p className="auth-switch">{authMode === 'register' ? 'Đã có tài khoản?' : 'Chưa có tài khoản?'} <button type="button" onClick={() => { setAuthMode(authMode === 'register' ? 'login' : 'register'); setAuthError('') }}>{authMode === 'register' ? 'Đăng nhập' : 'Đăng ký'}</button></p>
                <p className="modal-privacy">Mật khẩu được mã hóa trước khi lưu trữ.</p>
              </>
            )}
          </section>
        </div>
      )}

      {checkoutOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !checkoutBusy) setCheckoutOpen(false) }}>
        <section className="flow-modal checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title" tabIndex={-1}>
            <div className="flow-modal-heading">
              <div><p className="eyebrow section-eyebrow">BƯỚC CUỐI CÙNG</p><h2 id="checkout-title">Thông tin giao hàng.</h2></div>
              <button className="icon-button drawer-close" type="button" aria-label="Đóng thanh toán" disabled={checkoutBusy} onClick={() => setCheckoutOpen(false)}><X size={21} /></button>
            </div>
            <p className="modal-intro">Đơn hàng của bạn được thanh toán bảo mật qua VNPay.</p>
            <form className="flow-form" onSubmit={handleCheckout}>
              <label>Người nhận<input type="text" autoComplete="name" minLength={2} maxLength={80} value={shipping.name} onChange={(event) => setShipping({ ...shipping, name: event.target.value })} disabled={Boolean(pendingOrderId)} required /></label>
              <label>Số điện thoại<input type="tel" autoComplete="tel" minLength={8} maxLength={20} value={shipping.phone} onChange={(event) => setShipping({ ...shipping, phone: event.target.value })} placeholder="09xx xxx xxx" disabled={Boolean(pendingOrderId)} required /></label>
              <label>Địa chỉ giao hàng<textarea autoComplete="street-address" minLength={8} maxLength={240} value={shipping.address} onChange={(event) => setShipping({ ...shipping, address: event.target.value })} placeholder="Số nhà, đường, phường/xã, tỉnh/thành" rows={3} disabled={Boolean(pendingOrderId)} required /></label>
              {checkoutError && <p className="form-error" role="alert">{checkoutError}</p>}
              <div className="checkout-total"><span>{pendingOrderId ? 'Đơn hàng chờ thanh toán' : `Tạm tính · ${cartCount} sản phẩm`}</span><strong>{money.format(pendingOrderTotal ?? subtotal)}</strong></div>
              <button className="button button--dark modal-submit" type="submit" disabled={checkoutBusy || (!pendingOrderId && cartCount === 0)}>{checkoutBusy ? 'Đang tạo giao dịch...' : pendingOrderId ? 'Thử kết nối thanh toán lại' : 'Thanh toán qua VNPay'} <ArrowRight size={16} /></button>
              <p className="modal-privacy">Thông tin thanh toán được xử lý bởi VNPay. Dongo không lưu dữ liệu thẻ.</p>
            </form>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status"><Check size={17} />{toast}<button type="button" aria-label="Đóng thông báo" onClick={() => setToast('')}><X size={15} /></button></div>}
    </div>
  )
}

export default App
