# 6. Hướng dẫn cài đặt và demo trên Windows

## Yêu cầu

- Windows PowerShell, Node.js `>=22.5.0`, npm hỗ trợ workspaces.
- Kết nối internet để tải dependencies lần đầu.

## Cài đặt

Mở PowerShell tại thư mục gốc:

```powershell
npm ci
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

Đặt `SESSION_SECRET` trong `backend/.env` thành chuỗi riêng ngẫu nhiên ít nhất 32 byte. VNPay có thể chưa cấu hình cho demo giao diện; khi đó yêu cầu tạo URL thanh toán trả lỗi dịch vụ chưa sẵn sàng. Không commit/gửi `.env` thật hoặc database cá nhân.

## Chạy

```powershell
npm run dev
```

- Storefront: `http://localhost:5173`
- Health API: `http://localhost:3001/api/health`
- Database mặc định: `backend/data/storefront.sqlite`

Có thể chạy riêng ở hai terminal tại thư mục gốc:

```powershell
npm run dev:backend
```

```powershell
npm run dev:frontend
```

Dừng tiến trình bằng `Ctrl+C`.

## Demo stack Docker Compose (MySQL và observability)

Đây là chế độ demo riêng với SQLite local ở trên. Cần Docker Desktop/Compose v2. Tại thư mục gốc, tạo `.env` mới bằng script sinh secret:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/New-ComposeEnv.ps1
docker compose config -q
docker compose up -d --build
docker compose ps
```

Script từ chối ghi đè `.env` đã có; nếu file tồn tại, không xóa file để chạy lại. Hãy giữ file secrets riêng tư. Để dùng cổng khác, sửa các biến port trong `.env` mà không sao chép hay in các giá trị credential.

Mở storefront tại `http://localhost:8080`, phpMyAdmin tại `http://localhost:8081`, Prometheus tại `http://localhost:9090` và Grafana tại `http://localhost:3000`. Dashboard Grafana `Dongo Operations` hiển thị metrics; Grafana Alloy gửi log JSON backend/Nginx vào Loki. Grafana Explore có thể chạy `{job="backend"} | json` và `{job="nginx"} | json | status="200"` để xem log.

Đăng ký tài khoản qua storefront. Để demo admin trên database MySQL của stack, cấp role cho email vừa đăng ký bằng:

```powershell
docker compose exec -T backend node backend/server/promote-admin.js admin@example.com
```

Đăng nhập lại rồi trình bày dashboard. Kết thúc bằng `docker compose down` để dừng container mà giữ named volumes; không dùng `down -v`. Stack không nhập SQLite local vào MySQL và cấu hình HTTP hiện tại chỉ dành cho demo trên máy phát triển. Alloy v1.20.1 là collector mặc định; cấu hình Promtail cũ được giữ để rollback.

## Admin an toàn với DB demo riêng

Để tránh ghi vào database cá nhân, chỉ định DB demo độc lập tại terminal backend:

```powershell
$env:DATABASE_PATH = Join-Path (Get-Location) 'backend\data\demo.sqlite'
npm run dev:backend
```

Terminal thứ hai:

```powershell
npm run dev:frontend
```

Đăng ký tài khoản qua website. Ở terminal thứ ba đặt **cùng đường dẫn tuyệt đối** rồi cấp admin cho email đã đăng ký:

```powershell
$env:DATABASE_PATH = Join-Path (Get-Location) 'backend\data\demo.sqlite'
npm run admin:promote --workspace=backend -- ten-email-da-dang-ky@example.com
```

Đăng xuất/đăng nhập lại rồi mở `http://localhost:5173/admin`. Lệnh nâng cấp tài khoản đã tồn tại; không có tài khoản admin công khai/cố định.

DB demo được giữ lại giữa các lần chạy. Không xóa database mặc định. Chỉ dọn file demo do mình tạo sau khi chắc chắn không còn cần dữ liệu.

## Luồng trình diễn

1. Mở cửa hàng; chỉ ra danh mục, giá và ảnh lấy từ API/SQLite.
2. Tìm/chọn sản phẩm, thêm giỏ; quan sát toast, số giỏ và tổng tiền.
3. Mở checkout, giải thích trường giao hàng bắt buộc và việc backend tự tính giá.
4. Không cấu hình sandbox thì dừng trước bước thanh toán; không nói rằng order đã paid.
5. Đăng nhập admin, trình bày dashboard, đơn, tài khoản và quản lý sản phẩm trên DB demo.
6. Giải thích quyền admin được kiểm tra ở backend.

Muốn demo VNPay cần merchant sandbox riêng và IPN HTTPS có thể truy cập công khai. IPN hợp lệ mới cập nhật paid; callback cũ được đưa vào đối soát, không tự hoàn tiền.

## Lệnh kiểm tra

```powershell
npm test
npm run lint
npm run lint --workspace=backend
npm run build
```

Các lệnh này đã chạy Pass trong phiên lập hồ sơ.
