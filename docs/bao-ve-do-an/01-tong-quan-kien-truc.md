# 1. Tổng quan và kiến trúc

## Mục tiêu

Dongo Storefront là website bán lẻ trực tuyến phục vụ đồ án, minh họa danh mục sản phẩm, tài khoản khách hàng, giỏ hàng, tạo đơn có kiểm tra phía máy chủ, thanh toán VNPay sandbox và khu vực quản trị. Backend hỗ trợ SQLite cho local/test và MySQL cho stack Docker Compose; dữ liệu của hai chế độ tách biệt.

## Công nghệ

| Lớp | Công nghệ |
|---|---|
| Giao diện | React 19, TypeScript, Vite 8, Oxlint |
| API | Node.js `>=22.5.0`, Express 5 |
| Cơ sở dữ liệu | SQLite qua `node:sqlite` (local/test); MySQL qua `mysql2` (Compose) |
| Xác thực | bcryptjs, JWT trong cookie `HttpOnly` |
| Kiểm tra dữ liệu | Zod |
| Thanh toán | VNPay sandbox, chữ ký HMAC-SHA512 |
| Kiểm thử | Node.js test runner (`node --test`) |
| Vận hành Compose | Docker Compose, Nginx, phpMyAdmin |
| Metrics/logs | Prometheus, Grafana, Loki, Grafana Alloy |

## Sơ đồ thành phần và luồng dữ liệu

```mermaid
flowchart LR
    User[Khách hàng / Quản trị viên]
    Browser[Trình duyệt<br/>React + TypeScript]
    Vite[Vite dev server<br/>proxy /api]
    API[Express API<br/>validation, authentication, authorization]
    DB[(SQLite<br/>node:sqlite)]
    VNPay[VNPay sandbox]

    User --> Browser
    Browser -->|HTTP/HTTPS, JSON, cookie HttpOnly| Vite
    Vite -->|/api trong môi trường local| API
    Browser -->|Production: VITE_API_BASE_URL| API
    API -->|SQL và transaction| DB
    API -->|Tạo URL thanh toán đã ký| VNPay
    VNPay -->|IPN server-to-server| API
    VNPay -->|Return URL trình duyệt| Browser
```

Trong môi trường phát triển Vite proxy `/api` tới backend cổng `3001`. Khi triển khai, frontend và API có thể được host riêng; `VITE_API_BASE_URL`, CORS và cookie HTTPS cần cấu hình theo môi trường.

Return URL chỉ điều hướng trình duyệt. Trạng thái thanh toán được cập nhật bởi IPN sau khi backend kiểm tra chữ ký, mã giao dịch và số tiền. Việc trình duyệt quay về trang không tự chứng minh giao dịch đã thanh toán.

### Chế độ Docker Compose

```mermaid
flowchart LR
    Browser[Trình duyệt]
    Proxy[Nginx :8080]
    Frontend[Frontend container]
    API[Backend container]
    MySQL[(MySQL named volume)]
    Admin[phpMyAdmin :8081]
    Prom[Prometheus :9090]
    Grafana[Grafana :3000]
    Alloy[Grafana Alloy]
    Loki[Loki]
    Browser --> Proxy
    Proxy --> Frontend
    Proxy --> API
    API --> MySQL
    Admin --> MySQL
    API --> Prom
    Prom --> Grafana
    Alloy --> Loki
```

Các cổng host được bind vào loopback. Backend có `/metrics`; Prometheus scrape backend, MySQL exporter, Nginx exporter, cAdvisor và Alloy; Alloy đọc JSON log backend/Nginx từ named volumes read-only và gửi Loki. SQLite local không bị mount/import vào MySQL. Stack là demo HTTP, không phải cấu hình production. Alloy v1.20.1 thay Promtail EOL; canary đã xác minh hai stream và import positions cũ. Cấu hình/volume Promtail vẫn được giữ để rollback.

## Module chính

- `frontend/src/App.tsx`: storefront, tìm kiếm/lọc/sắp xếp, trạng thái tài khoản, giỏ hàng, yêu thích và hộp thoại mua hàng.
- `frontend/src/Admin.tsx`: dashboard, quản trị sản phẩm, tài khoản và đơn hàng.
- `frontend/src/api.ts`: kiểu dữ liệu và hàm gửi request API.
- `frontend/src/ProductImage.tsx`, `frontend/src/product-image.ts`: resolve URL và hiển thị ảnh thống nhất.
- `backend/server/index.js`: nạp môi trường, chọn adapter SQLite/MySQL và lắng nghe HTTP.
- `backend/server/app.js`: endpoint, xác thực/phân quyền, validation, đặt hàng và xử lý callback.
- `backend/server/db.js`, `backend/server/db-mysql.js`: adapter SQLite/MySQL, schema, seed và migration cộng thêm.
- `backend/server/vnpay.js`: tạo URL VNPay, ký và xác minh HMAC-SHA512.

## Nguyên tắc nghiệp vụ

1. API catalog đọc sản phẩm đang hoạt động từ database được cấu hình.
2. Backend tính lại giá từ catalog, kiểm tra số lượng và dữ liệu giao hàng trong transaction; tạo đơn cần `Idempotency-Key`.
3. Đăng ký mới mặc định là `customer`; endpoint quản trị kiểm tra vai trò ở backend.
4. IPN lặp không ghi nhận thanh toán lần nữa. Callback thành công từ attempt cũ hoặc đơn đã được trả bằng attempt khác được đưa vào hàng đợi đối soát; không tự hoàn tiền.
5. SQLite local mặc định ở `backend/data/storefront.sqlite`; MySQL Compose dùng named volume riêng. Không đưa database cá nhân, backup hoặc `.env` thật vào gói nộp.

## Giới hạn đã biết

Chưa có email xác minh/giao dịch, quản lý tồn kho, tích hợp hãng vận chuyển hoặc hoàn tiền tự động. Newsletter lưu email vào database nhưng chưa gửi email. VNPay đầu cuối phụ thuộc merchant sandbox và IPN HTTPS công khai.
