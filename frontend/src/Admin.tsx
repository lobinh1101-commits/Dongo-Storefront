import { useEffect, useState, type ChangeEvent } from 'react'
import { ArrowLeft, Eye, EyeOff, Pencil, RefreshCw, ShieldCheck, ShoppingBag, Users } from 'lucide-react'
import { apiRequest, type Product, type User, type UserRole } from './api'
import { ProductImage } from './ProductImage'
import './Storefront.css'

type Overview = {
  userCount: number
  orderCount: number
  pendingOrders: number
  paidRevenue: number
}

type AdminUser = User & { createdAt: string }

type AdminOrder = {
  id: string
  customerName: string
  customerEmail: string
  status: string
  paymentMethod: string
  paymentStatus: 'pending' | 'paid' | 'failed'
  fulfillmentStatus: 'new' | 'processing' | 'shipped' | 'delivered'
  totalAmount: number
  createdAt: string
  updatedAt: string
}

type AdminOrderDetails = AdminOrder & {
  customerName: string
  customerEmail: string
  shippingName: string
  shippingPhone: string
  shippingAddress: string
  items: { productId: number; name: string; unitPrice: number; quantity: number }[]
}

type AdminProduct = Product & { active: number }
type ProductDraft = {
  name: string
  category: string
  categoryKey: string
  price: string
  oldPrice: string
  badge: string
  image: string
  color: string
}

const emptyProductDraft: ProductDraft = {
  name: '',
  category: '',
  categoryKey: '',
  price: '',
  oldPrice: '',
  badge: '',
  image: '',
  color: '#e8e2d5',
}

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })
const dateTime = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' })
const fulfillmentLabels = { new: 'Mới', processing: 'Đang xử lý', shipped: 'Đang giao', delivered: 'Đã giao' }
const nextFulfillment: Partial<Record<AdminOrder['fulfillmentStatus'], AdminOrder['fulfillmentStatus']>> = {
  new: 'processing',
  processing: 'shipped',
  shipped: 'delivered',
}

function formatDate(value: string) {
  return dateTime.format(new Date(`${value.replace(' ', 'T')}Z`))
}

export default function Admin() {
  const [user, setUser] = useState<User | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [section, setSection] = useState<'orders' | 'users' | 'products'>('orders')
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [changingUserId, setChangingUserId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<AdminOrderDetails | null>(null)
  const [orderDetailLoading, setOrderDetailLoading] = useState(false)
  const [updatingOrderId, setUpdatingOrderId] = useState('')
  const [productDraft, setProductDraft] = useState<ProductDraft>(emptyProductDraft)
  const [editingProductId, setEditingProductId] = useState<number | null>(null)
  const [savingProduct, setSavingProduct] = useState(false)

  useEffect(() => {
    void apiRequest<{ user: User | null }>('/api/auth/me')
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch(() => setUser(null))
      .finally(() => setSessionReady(true))
  }, [])

  useEffect(() => {
    if (!sessionReady || user?.role !== 'admin') return
    let active = true
    void Promise.all([
      apiRequest<Overview>('/api/admin/overview'),
      apiRequest<{ users: AdminUser[] }>('/api/admin/users'),
      apiRequest<{ orders: AdminOrder[] }>('/api/admin/orders'),
      apiRequest<{ products: AdminProduct[] }>('/api/admin/products'),
    ])
      .then(([nextOverview, nextUsers, nextOrders, nextProducts]) => {
        if (!active) return
        setOverview(nextOverview)
        setUsers(nextUsers.users)
        setOrders(nextOrders.orders)
        setProducts(nextProducts.products)
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Không tải được dữ liệu quản trị.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [sessionReady, user?.role, refreshKey])

  const changeRole = async (userId: number, event: ChangeEvent<HTMLSelectElement>) => {
    const role = event.currentTarget.value as UserRole
    setChangingUserId(userId)
    setError('')
    setNotice('')
    try {
      const result = await apiRequest<{ user: AdminUser }>(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      })
      setUsers((current) => current.map((account) => account.id === userId ? { ...account, ...result.user } : account))
      setNotice(`Đã cập nhật vai trò của ${result.user.email}.`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không thể cập nhật vai trò.')
    } finally {
      setChangingUserId(null)
    }
  }

  const openOrder = async (orderId: string) => {
    setSelectedOrder(null)
    setOrderDetailLoading(true)
    setError('')
    try {
      const result = await apiRequest<{ order: AdminOrderDetails }>(`/api/admin/orders/${orderId}`)
      setSelectedOrder(result.order)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không tải được chi tiết đơn hàng.')
    } finally {
      setOrderDetailLoading(false)
    }
  }

  const advanceOrder = async (order: AdminOrder) => {
    const fulfillmentStatus = nextFulfillment[order.fulfillmentStatus]
    if (!fulfillmentStatus) return
    setUpdatingOrderId(order.id)
    setError('')
    setNotice('')
    try {
      const result = await apiRequest<{ order: Pick<AdminOrder, 'id' | 'fulfillmentStatus' | 'updatedAt'> }>(
        `/api/admin/orders/${order.id}/fulfillment`,
        { method: 'PATCH', body: JSON.stringify({ fulfillmentStatus }) },
      )
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, ...result.order } : item))
      setSelectedOrder((current) => current?.id === order.id ? { ...current, ...result.order } : current)
      setNotice(`Đã chuyển trạng thái đơn sang "${fulfillmentLabels[fulfillmentStatus]}".`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không thể cập nhật trạng thái đơn hàng.')
    } finally {
      setUpdatingOrderId('')
    }
  }

  const editProduct = (product: AdminProduct) => {
    setEditingProductId(product.id)
    setProductDraft({
      name: product.name,
      category: product.category,
      categoryKey: product.categoryKey,
      price: String(product.price),
      oldPrice: product.oldPrice === null ? '' : String(product.oldPrice),
      badge: product.badge || '',
      image: product.image,
      color: product.color,
    })
  }

  const saveProduct = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSavingProduct(true)
    setError('')
    setNotice('')
    const payload = {
      ...productDraft,
      price: Number(productDraft.price),
      oldPrice: productDraft.oldPrice ? Number(productDraft.oldPrice) : null,
      badge: productDraft.badge.trim() || null,
    }
    try {
      const result = editingProductId === null
        ? await apiRequest<{ product: AdminProduct }>('/api/admin/products', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        : await apiRequest<{ product: AdminProduct }>(`/api/admin/products/${editingProductId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      setProducts((current) => editingProductId === null
        ? [...current, result.product].sort((first, second) => first.id - second.id)
        : current.map((product) => product.id === result.product.id ? result.product : product))
      setNotice(editingProductId === null ? 'Đã thêm sản phẩm.' : 'Đã cập nhật sản phẩm.')
      setEditingProductId(null)
      setProductDraft(emptyProductDraft)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không thể lưu sản phẩm.')
    } finally {
      setSavingProduct(false)
    }
  }

  const toggleProduct = async (product: AdminProduct) => {
    setError('')
    setNotice('')
    try {
      const result = await apiRequest<{ product: AdminProduct }>(`/api/admin/products/${product.id}/active`, {
        method: 'PATCH',
        body: JSON.stringify({ active: product.active !== 1 }),
      })
      setProducts((current) => current.map((item) => item.id === product.id ? result.product : item))
      setNotice(result.product.active ? 'Đã mở bán sản phẩm.' : 'Đã ngừng kinh doanh sản phẩm.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không thể cập nhật sản phẩm.')
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-topbar">
        <a className="wordmark" href="/" aria-label="Dongo storefront">dongo<span>.</span></a>
        <div className="admin-topbar-actions">
          {user && <span className="admin-identity"><ShieldCheck size={16} /> {user.name}</span>}
          <a className="admin-store-link" href="/"><ArrowLeft size={15} /> Về cửa hàng</a>
        </div>
      </header>

      <main className="admin-main">
        {!sessionReady ? (
          <div className="admin-access-state">Đang kiểm tra phiên đăng nhập...</div>
        ) : !user ? (
          <div className="admin-access-state"><ShieldCheck size={30} /><h1>Cần đăng nhập</h1><p>Đăng nhập tài khoản quản trị tại cửa hàng để tiếp tục.</p><a className="button button--dark" href="/">Về cửa hàng</a></div>
        ) : user.role !== 'admin' ? (
          <div className="admin-access-state"><ShieldCheck size={30} /><h1>Không có quyền truy cập</h1><p>Tài khoản này chưa được cấp vai trò quản trị.</p><a className="button button--dark" href="/">Về cửa hàng</a></div>
        ) : (
          <>
            <div className="admin-heading-row">
              <div><p className="eyebrow section-eyebrow">DONGO / ADMINISTRATION</p><h1>Quản trị hệ thống</h1><p>Quản lý sản phẩm, tài khoản và đơn hàng.</p></div>
              <button className="admin-refresh" type="button" onClick={() => { setError(''); setNotice(''); setLoading(true); setRefreshKey((current) => current + 1) }} aria-label="Làm mới dữ liệu"><RefreshCw size={16} /> Làm mới</button>
            </div>

            {overview && <section className="admin-stats" aria-label="Tổng quan">
              <div><span>Tài khoản</span><strong>{overview.userCount}</strong></div>
              <div><span>Tổng đơn hàng</span><strong>{overview.orderCount}</strong></div>
              <div><span>Chờ thanh toán</span><strong>{overview.pendingOrders}</strong></div>
              <div><span>Doanh thu đã thanh toán</span><strong>{money.format(overview.paidRevenue)}</strong></div>
            </section>}

            <div className="admin-toolbar">
              <div className="admin-tabs" role="tablist" aria-label="Khu vực quản trị">
                <button className={section === 'orders' ? 'is-active' : ''} type="button" role="tab" aria-selected={section === 'orders'} onClick={() => setSection('orders')}><ShoppingBag size={15} /> Đơn hàng <span>{orders.length}</span></button>
                <button className={section === 'users' ? 'is-active' : ''} type="button" role="tab" aria-selected={section === 'users'} onClick={() => setSection('users')}><Users size={15} /> Tài khoản <span>{users.length}</span></button>
                <button className={section === 'products' ? 'is-active' : ''} type="button" role="tab" aria-selected={section === 'products'} onClick={() => setSection('products')}>Sản phẩm <span>{products.length}</span></button>
              </div>
              <span className="admin-result-note">{section === 'orders' ? '100 đơn gần nhất' : section === 'users' ? '200 tài khoản gần nhất' : 'Danh mục SQLite'}</span>
            </div>

            {error && <p className="admin-message admin-message--error" role="alert">{error}</p>}
            {notice && <p className="admin-message" role="status">{notice}</p>}
            {loading ? <div className="admin-loading">Đang tải dữ liệu...</div> : section === 'orders' ? (
              <div className="admin-table-wrap" role="region" aria-label="Bảng đơn hàng, cuộn ngang để xem toàn bộ cột" tabIndex={0}>
                <table className="admin-table">
                  <thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Ngày tạo</th><th>Thanh toán</th><th>Giao hàng</th><th className="align-right">Tổng tiền</th><th></th></tr></thead>
                  <tbody>
                    {orders.map((order) => <tr key={order.id}>
                      <td><span className="admin-order-id">{order.id.slice(0, 8).toUpperCase()}</span></td>
                      <td><strong>{order.customerName}</strong><small>{order.customerEmail}</small></td>
                      <td>{formatDate(order.createdAt)}</td>
                      <td><span className={`admin-status admin-status--${order.paymentStatus}`}>{order.paymentMethod === 'COD' ? 'COD · Chờ thu tiền' : order.paymentStatus === 'paid' ? 'Đã thanh toán' : order.paymentStatus === 'failed' ? 'Thất bại' : 'Chờ thanh toán'}</span></td>
                      <td>{fulfillmentLabels[order.fulfillmentStatus]}</td>
                      <td className="align-right">{money.format(order.totalAmount)}</td>
                      <td className="admin-order-actions">
                        <button type="button" onClick={() => void openOrder(order.id)}>Chi tiết</button>
                        {(order.paymentStatus === 'paid' || order.paymentMethod === 'COD') && nextFulfillment[order.fulfillmentStatus] !== undefined && <button type="button" disabled={updatingOrderId === order.id} onClick={() => void advanceOrder(order)}>{updatingOrderId === order.id ? 'Đang lưu…' : 'Cập nhật giao hàng'}</button>}
                      </td>
                    </tr>)}
                    {orders.length === 0 && <tr><td className="admin-empty" colSpan={7}>Chưa có đơn hàng.</td></tr>}
                  </tbody>
                </table>
              </div>
            ) : section === 'users' ? (
              <div className="admin-table-wrap" role="region" aria-label="Bảng tài khoản, cuộn ngang để xem toàn bộ cột" tabIndex={0}>
                <table className="admin-table">
                  <thead><tr><th>Tài khoản</th><th>Email</th><th>Ngày tạo</th><th>Vai trò</th></tr></thead>
                  <tbody>
                    {users.map((account) => <tr key={account.id}>
                      <td><strong>{account.name}</strong>{account.id === user.id && <small>Tài khoản hiện tại</small>}</td>
                      <td>{account.email}</td>
                      <td>{formatDate(account.createdAt)}</td>
                      <td><select className="role-select" value={account.role} disabled={changingUserId === account.id || account.id === user.id} onChange={(event) => void changeRole(account.id, event)} aria-label={`Vai trò ${account.email}`}>
                        <option value="customer">Khách hàng</option><option value="admin">Admin</option>
                      </select></td>
                    </tr>)}
                    {users.length === 0 && <tr><td className="admin-empty" colSpan={4}>Chưa có tài khoản.</td></tr>}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="admin-products-section">
                <form className="admin-product-form" onSubmit={(event) => void saveProduct(event)}>
                  <h2>{editingProductId === null ? 'Thêm sản phẩm' : `Sửa sản phẩm #${editingProductId}`}</h2>
                  <div className="admin-product-fields">
                    <label>Tên sản phẩm<input required minLength={2} maxLength={120} value={productDraft.name} onChange={(event) => setProductDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                    <label>Danh mục<input required maxLength={60} value={productDraft.category} onChange={(event) => setProductDraft((current) => ({ ...current, category: event.target.value }))} /></label>
                    <label>Mã danh mục<input required pattern="[_A-Za-z0-9\-]{2,40}" value={productDraft.categoryKey} onChange={(event) => setProductDraft((current) => ({ ...current, categoryKey: event.target.value }))} /></label>
                    <label>Giá bán (₫)<input required type="number" min="1" step="1" value={productDraft.price} onChange={(event) => setProductDraft((current) => ({ ...current, price: event.target.value }))} /></label>
                    <label>Giá gốc (₫)<input type="number" min="1" step="1" value={productDraft.oldPrice} onChange={(event) => setProductDraft((current) => ({ ...current, oldPrice: event.target.value }))} /></label>
                    <label>Nhãn (không bắt buộc)<input maxLength={40} value={productDraft.badge} onChange={(event) => setProductDraft((current) => ({ ...current, badge: event.target.value }))} /></label>
                    <label>Đường dẫn ảnh cục bộ, mã Unsplash hoặc URL HTTPS<input required maxLength={2048} value={productDraft.image} onChange={(event) => setProductDraft((current) => ({ ...current, image: event.target.value }))} placeholder="/images/products/ten-san-pham.jpg" /></label>
                    <label>Màu nền (#RRGGBB)<input required pattern="#[A-Fa-f0-9]{6}" value={productDraft.color} onChange={(event) => setProductDraft((current) => ({ ...current, color: event.target.value }))} /></label>
                  </div>
                  <div className="admin-product-image-preview">
                    <ProductImage
                      image={productDraft.image}
                      width={360}
                      quality={78}
                      alt={productDraft.name ? `Xem trước ảnh ${productDraft.name}` : 'Xem trước ảnh sản phẩm'}
                    />
                    <span>Xem trước ảnh sản phẩm</span>
                  </div>
                  <div className="admin-product-form-actions">
                    <button className="button button--dark" type="submit" disabled={savingProduct}>{savingProduct ? 'Đang lưu…' : editingProductId === null ? 'Thêm sản phẩm' : 'Lưu thay đổi'}</button>
                    {editingProductId !== null && <button className="admin-refresh" type="button" onClick={() => { setEditingProductId(null); setProductDraft(emptyProductDraft) }}>Hủy sửa</button>}
                  </div>
                </form>
                <div className="admin-table-wrap" role="region" aria-label="Bảng sản phẩm, cuộn ngang để xem toàn bộ cột" tabIndex={0}>
                  <table className="admin-table">
                    <thead><tr><th>Sản phẩm</th><th>Danh mục</th><th className="align-right">Giá</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
                    <tbody>{products.map((product) => <tr key={product.id}>
                      <td>
                        <div className="admin-product-cell">
                          <ProductImage image={product.image} width={120} quality={72} alt="" loading="lazy" />
                          <div><strong>{product.name}</strong><small>#{product.id}</small></div>
                        </div>
                      </td>
                      <td>{product.category}</td>
                      <td className="align-right">{money.format(product.price)}</td>
                      <td>{product.active ? 'Đang bán' : 'Đã ẩn'}</td>
                      <td className="admin-order-actions">
                        <button type="button" onClick={() => editProduct(product)}><Pencil size={13} /> Sửa</button>
                        <button type="button" onClick={() => void toggleProduct(product)}>{product.active ? <><EyeOff size={13} /> Ẩn</> : <><Eye size={13} /> Mở bán</>}</button>
                      </td>
                    </tr>)}
                    {products.length === 0 && <tr><td className="admin-empty" colSpan={5}>Chưa có sản phẩm.</td></tr>}</tbody>
                  </table>
                </div>
              </div>
            )}
            {section === 'orders' && (orderDetailLoading || selectedOrder) && (
              <section className="admin-order-detail" aria-label="Chi tiết đơn hàng">
                {orderDetailLoading ? <p>Đang tải chi tiết đơn hàng…</p> : selectedOrder && <>
                  <div className="admin-order-detail-heading"><h2>Đơn hàng {selectedOrder.id.slice(0, 8).toUpperCase()}</h2><button className="admin-refresh" type="button" onClick={() => setSelectedOrder(null)}>Đóng</button></div>
                  <p><strong>Người nhận:</strong> {selectedOrder.shippingName} · {selectedOrder.shippingPhone}</p>
                  <p><strong>Địa chỉ:</strong> {selectedOrder.shippingAddress}</p>
                  <p><strong>Khách hàng:</strong> {selectedOrder.customerName} ({selectedOrder.customerEmail})</p>
                  <div className="admin-table-wrap" role="region" aria-label="Chi tiết sản phẩm trong đơn hàng, cuộn ngang để xem toàn bộ cột" tabIndex={0}><table className="admin-table">
                    <thead><tr><th>Sản phẩm</th><th>Số lượng</th><th className="align-right">Đơn giá</th></tr></thead>
                    <tbody>{selectedOrder.items.map((item) => <tr key={`${selectedOrder.id}-${item.productId}`}><td>{item.name}</td><td>{item.quantity}</td><td className="align-right">{money.format(item.unitPrice)}</td></tr>)}</tbody>
                    <tfoot><tr><th colSpan={2}>Tổng cộng</th><th className="align-right">{money.format(selectedOrder.totalAmount)}</th></tr></tfoot>
                  </table></div>
                  <p className="admin-footnote">Thanh toán: {selectedOrder.paymentMethod === 'COD' ? 'COD · Thu tiền khi giao hàng' : selectedOrder.paymentStatus === 'paid' ? 'Đã thanh toán' : selectedOrder.paymentStatus === 'failed' ? 'Thất bại' : 'Đang chờ'} · Giao hàng: {fulfillmentLabels[selectedOrder.fulfillmentStatus]} · Cập nhật: {formatDate(selectedOrder.updatedAt)}</p>
                </>}
              </section>
            )}
            <p className="admin-footnote">Vai trò được kiểm tra ở backend. Không thể hạ quyền tài khoản admin cuối cùng.</p>
          </>
        )}
      </main>
    </div>
  )
}
