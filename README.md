# Dongo Storefront

Dongo là website bán hàng trực tuyến xây dựng cho đồ án, gồm cửa hàng cho khách hàng và trang quản trị. Backend hỗ trợ SQLite cho môi trường local/test và MySQL cho bản Docker Compose; cả hai đều xác thực phiên, quản lý đơn hàng COD mà không tin giá do trình duyệt gửi lên.

Frontend React/TypeScript/Vite và backend Express với adapter SQLite/MySQL được tách thành hai npm workspace độc lập:

```text
storefront/
  frontend/   React, TypeScript, Vite, giao diện cửa hàng và quản trị
  backend/    Express API, adapter SQLite/MySQL và xác thực
```

## Công nghệ

- Frontend: React 19, TypeScript, Vite, Oxlint.
- Backend: Node.js, Express 5, SQLite (`node:sqlite`) hoặc MySQL (`mysql2`), Zod.
- Xác thực: bcryptjs, JWT trong cookie HttpOnly.
- Thanh toán: thanh toán khi nhận hàng (COD).
- Hạ tầng Compose: Nginx reverse proxy, MySQL/phpMyAdmin, Prometheus/Grafana, Loki/Grafana Alloy (cấu hình Promtail cũ được giữ để rollback).
- Kiểm thử: Node.js test runner (`node --test`).

## Yêu cầu

- Node.js 22.5 trở lên (`node:sqlite` được dùng làm cơ sở dữ liệu).
- npm 9 trở lên (hỗ trợ lockfile phiên bản 3 và npm workspaces). Phiên bản npm chưa được ghim riêng; nên dùng npm đi kèm với bản Node.js được hỗ trợ.
- Docker Compose v2 chỉ cần nếu chạy stack container; cấu hình Compose dùng MySQL và không thay thế database SQLite local.

## Cài đặt

Chạy tại thư mục `storefront`:

```powershell
npm ci
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

Đặt `SESSION_SECRET` trong `backend/.env` thành chuỗi ngẫu nhiên riêng dài tối thiểu 32 byte (backend từ chối secret production ngắn hơn). Có thể tạo secret trong PowerShell:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

`backend/.env.example` và `frontend/.env.example` chỉ là file mẫu; hãy tạo file `.env` cục bộ từ các file này và không gửi/đưa file `.env` thật vào Git hoặc gói bàn giao. `SESSION_SECRET` phải được tạo riêng cho từng môi trường.

## Chạy

Chạy cả hai app bằng một lệnh:

```powershell
npm run dev
```

Hoặc chạy riêng trong hai terminal:

```powershell
npm run dev:backend
npm run dev:frontend
```

- Frontend: http://localhost:5173
- Backend health: http://localhost:3001/api/health
- Database: `backend/data/storefront.sqlite` (được Git ignore)
- Vite proxy `/api` đến backend cổng `3001` trong môi trường local.
- Hướng dẫn chi tiết cài đặt, vận hành, xử lý sự cố và sao lưu/khôi phục database: [docs/HUONG_DAN_TRIEN_KHAI_VA_QUAN_TRI.md](./docs/HUONG_DAN_TRIEN_KHAI_VA_QUAN_TRI.md).
- Hướng dẫn kiểm tra, khởi tạo Git và chờ xác nhận trước khi push GitHub: [docs/GITHUB_PUBLISHING.md](./docs/GITHUB_PUBLISHING.md).
- Báo cáo triển khai hạ tầng, kết quả xác minh và bảng nghiệm thu: [docs/BAO_CAO_TRIEN_KHAI.md](./docs/BAO_CAO_TRIEN_KHAI.md).
- Truy vấn log Loki: [docs/LOGQL_QUERIES.md](./docs/LOGQL_QUERIES.md); checklist hardening và hạng mục còn thiếu trước production: [docs/HARDENING_CHECKLIST.md](./docs/HARDENING_CHECKLIST.md).
- Test case và bằng chứng kiểm thử: [docs/bao-ve-do-an/04-bo-test-case.md](./docs/bao-ve-do-an/04-bo-test-case.md).
- Sao lưu/kiểm tra database: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Manage-SqliteDatabase.ps1 -Action Backup`; khôi phục yêu cầu dừng backend, chỉ định `-BackupPath` và xác nhận rõ `-ConfirmRestore RESTORE`. Xem hướng dẫn trước khi khôi phục.
- Danh mục, giá và đường dẫn ảnh sản phẩm được đọc từ database đang cấu hình (SQLite local/test hoặc MySQL Compose) qua `GET /api/products` và `GET /api/products/:id`. Ảnh sản phẩm mẫu được phục vụ cục bộ từ `frontend/public/images/products/`; migration chỉ đổi đúng các mã ảnh seed cũ sang đường dẫn cục bộ, giữ nguyên URL ảnh tùy chỉnh. Khi khởi tạo, backend chỉ thêm các sản phẩm mẫu còn thiếu; dữ liệu sản phẩm đã có không bị ghi đè.
- Khởi tạo bổ sung các cột idempotency và trạng thái xử lý giao hàng, cùng bảng đăng ký nhận tin còn thiếu bằng migration cộng thêm; đơn hàng và chi tiết đơn hiện có được giữ nguyên.
- Đăng ký hiện chưa gửi email xác minh. Tài khoản được dùng ngay sau khi đăng ký; không có trạng thái xác minh email.
- API tạo đơn yêu cầu khóa `Idempotency-Key`; frontend tự tạo khóa để retry cùng một yêu cầu không tạo đơn trùng.

## Chạy stack Docker Compose

Compose chạy frontend, backend kết nối MySQL, Nginx reverse proxy, phpMyAdmin, exporters, Prometheus, Grafana, Loki và Grafana Alloy. MySQL dùng named volume riêng; stack không tự nhập hoặc sửa `backend/data/storefront.sqlite`.

1. Cài Docker Desktop và bảo đảm Docker Engine đang chạy.
2. Tạo file `.env` mới với secrets ngẫu nhiên bằng script an toàn. Script từ chối ghi đè file có sẵn và trên Windows giới hạn ACL cho tài khoản hiện tại. Không in/chia sẻ hoặc commit `.env`.

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/New-ComposeEnv.ps1
   ```

   Script tạo secrets tối thiểu 32 byte; mật khẩu MySQL exporter được sinh dạng hexadecimal. Kiểm tra tên biến/cổng mà không hiển thị giá trị secrets nếu cần.

3. Khởi động và kiểm tra trạng thái:

   ```powershell
   docker compose up -d --build
   docker compose ps
   ```

4. Mở các giao diện trên máy local:
   - Storefront/API qua Nginx: http://localhost:8080 (API health: `/api/health`)
   - phpMyAdmin: http://localhost:8081
   - Prometheus: http://localhost:9090
   - Grafana: http://localhost:3000 (tài khoản `admin`, mật khẩu từ `.env`)

   Đổi cổng bằng `HTTP_PORT`, `PHPMYADMIN_PORT`, `PROMETHEUS_PORT` hoặc `GRAFANA_PORT` trong `.env` nếu cổng mặc định đã được dùng. Các cổng quản trị được bind vào loopback `127.0.0.1`; đây là cấu hình demo HTTP, không phải cấu hình production.

5. Dashboard Grafana `Dongo Operations` được provision sẵn. Prometheus lấy metrics từ backend, MySQL exporter, Nginx exporter, cAdvisor và Alloy; trên Docker Desktop, cAdvisor có thể chỉ nhìn thấy VM Linux thay vì từng container. Alloy chuyển log JSON backend/Nginx vào Loki và nhập vị trí đọc Promtail nếu volume cũ có file positions; volume mới sẽ bắt đầu đọc log hiện có. Trong Grafana Explore có thể thử `{job="backend"} | json` và `{job="nginx"} | json | status="200"`.
6. Đăng ký tài khoản trên storefront rồi, nếu cần quyền quản trị trong stack Compose, cấp quyền cho đúng email đã đăng ký:

   ```powershell
   docker compose exec -T backend node backend/server/promote-admin.js admin@example.com
   ```

   Đăng xuất/đăng nhập lại để tải role mới. Không có tài khoản admin mặc định.
7. Dừng stack nhưng giữ nguyên dữ liệu:

   ```powershell
   docker compose down
   ```

   Không dùng `docker compose down -v` nếu muốn giữ database và dữ liệu quan sát trong named volumes. SQLite hiện có và MySQL Compose là hai dữ liệu độc lập; không có migration/import SQLite tự động.

Grafana Alloy được pin `v1.20.1`; canary chuyển đổi từ Promtail đã được kiểm tra với Loki thật. File cấu hình và volume positions Promtail cũ vẫn được giữ để rollback; xem [hướng dẫn vận hành](./docs/HUONG_DAN_TRIEN_KHAI_VA_QUAN_TRI.md). Promtail đã EOL từ 2/3/2026; xem [tài liệu Grafana](https://grafana.com/docs/loki/latest/send-data/promtail/).

## Chức năng hiện có

- Khách hàng đăng ký, đăng nhập, đăng xuất và xem đơn hàng của chính mình.
- Danh mục sản phẩm lấy từ database đang cấu hình (SQLite local/test hoặc MySQL trong Compose); tìm kiếm, lọc, sắp xếp và giỏ hàng hoạt động ở frontend.
- Backend xác thực dữ liệu đơn và tính lại giá theo catalog trong database; đơn hàng có khóa idempotency.
- Quản trị viên xem thống kê, tài khoản, danh sách/chi tiết đơn, thông tin giao nhận và các mặt hàng trong đơn.
- Đơn COD được tạo với phương thức `COD`, trạng thái `PENDING` và trạng thái thanh toán `PAID`. Admin có thể cập nhật tiến độ giao hàng theo thứ tự mới → đang xử lý → đang giao → đã giao.
- Admin có thể thêm/sửa/ngừng bán/mở bán sản phẩm. Ngừng bán là ẩn sản phẩm, không xóa bản ghi hay ảnh hưởng dữ liệu đơn lịch sử.
- Form nhận tin kiểm tra và lưu email duy nhất vào database đang cấu hình; hiện chưa có dịch vụ gửi email hoặc hủy đăng ký tự phục vụ.

## Mô hình dữ liệu chính

- `users`: tài khoản và vai trò (`customer`/`admin`).
- `products`: catalog, giá và cờ `active` để ngừng bán theo cách mềm.
- `orders`: chủ đơn, thông tin giao hàng, tổng tiền, `payment_method` (`COD`), `status` (`PENDING`) và `payment_status` (`PAID` khi checkout thành công).
- `order_items`: bản chụp tên, đơn giá và số lượng tại thời điểm tạo đơn; `product_id` được giữ như tham chiếu lịch sử.
- Schema vẫn giữ `payment_attempts` và `payment_reconciliations` để tương thích dữ liệu lịch sử; checkout COD không tạo hoặc ghi vào các bảng này.
- `newsletter_subscribers`: email nhận tin, duy nhất không phân biệt hoa thường.

Migration giữ dữ liệu đơn hiện có, cập nhật ràng buộc trạng thái đơn, bổ sung cột cần thiết và seed các sản phẩm còn thiếu mà không ghi đè catalog. SQLite local mặc định là `backend/data/storefront.sqlite`; MySQL Compose lưu trong named volume riêng.

Mỗi workspace cũng có thể được điều khiển độc lập bằng `npm run dev --workspace=frontend` hoặc `npm run dev --workspace=backend`.

## Vai trò Admin

Tài khoản đăng ký mới luôn có vai trò `customer`; API không nhận role từ form đăng ký. Để tạo admin đầu tiên:

1. Đăng ký tài khoản bình thường trên website.
2. Tại thư mục `storefront`, nâng email đã đăng ký bằng lệnh:

```powershell
npm run admin:promote --workspace=backend -- admin@example.com
```

3. Đăng nhập lại rồi mở http://localhost:5173/admin.

Dashboard admin xem đơn hàng/thống kê, quản lý sản phẩm và thay đổi vai trò tài khoản. Backend kiểm tra quyền trên API quản trị; customer gọi `/api/admin/*` sẽ nhận `403`. Lệnh nâng quyền chỉ chạy được trên máy có quyền truy cập database, không có đăng ký admin công khai.

Trong Docker Compose, backend dùng MySQL của stack; sau khi đăng ký tài khoản, có thể cấp quyền bằng `docker compose exec -T backend node backend/server/promote-admin.js admin@example.com`.

## Deploy riêng

- Build và host thư mục `frontend/dist` trên web host/CDN; đặt `VITE_API_BASE_URL` trước khi build để trỏ tới domain backend.
- Chạy `backend` trên API host. Đặt `CORS_ORIGINS` thành origin frontend được phép.
- Với frontend/backend khác site, cấu hình HTTPS cho cả hai, `COOKIE_SECURE=true` và `SESSION_COOKIE_SAME_SITE=none`. Không dùng cấu hình này trên HTTP local.
- Không để backend phục vụ thư mục frontend; hai tiến trình có thể phát hành và scale độc lập.

## Kiểm tra

```powershell
npm test
npm run lint
npm run build
npm run lint --workspace=backend
```

`npm test` chạy cả backend và frontend. Bộ test backend bao gồm xác thực, phân quyền, tạo đơn COD, trạng thái vận chuyển, quản lý catalog, nhận tin và migration dữ liệu cũ. Frontend có unit tests cho trạng thái phiên tài khoản. Có thể chạy riêng:

```powershell
npm test --workspace=backend
npm test --workspace=frontend
```

## Đóng gói bản bàn giao an toàn

Tại thư mục gốc `storefront`, tạo ZIP bàn giao bằng script allow-list:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/New-HandoffZip.ps1
```

Mặc định script tạo `Dongo-Storefront-handoff-final.zip` ở thư mục cha của workspace. Script dựng và kiểm tra archive tạm (nội dung bắt buộc, 8 ảnh sản phẩm và không có file nhạy cảm) trước; chỉ sau khi đạt mới cài đặt hoặc thay thế ZIP đích. Nếu quá trình tạo/kiểm tra thất bại, ZIP cũ được giữ nguyên. Có thể chỉ định đường dẫn đầu ra khác khi thật sự cần:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/New-HandoffZip.ps1 -OutputPath "G:\path\Dongo-Storefront-handoff.zip"
```

Gói chỉ chứa mã nguồn frontend/backend, test, ảnh sản phẩm, tài liệu, cấu hình mẫu và các manifest/lockfile dependencies. Script từ chối `.env` thật, SQLite/backup, log, khóa/chứng thư, `node_modules`, thư mục build và archive lồng nhau; sau khi tạo, script quét và liệt kê nội dung ZIP. Không gửi ZIP cũ hoặc database local có dữ liệu cá nhân; nếu một archive cũ đã được chia sẻ công khai, thu hồi/xóa bản công khai và thay các credential liên quan theo quy trình vận hành.

## Phạm vi và giới hạn

- Chưa có quản lý tồn kho; sản phẩm không có số lượng tồn nên hệ thống không giữ/trừ/hoàn kho.
- Trạng thái giao hàng được admin cập nhật thủ công; chưa tích hợp hãng vận chuyển.
- Form nhận tin mới lưu email, chưa gửi newsletter và chưa có luồng unsubscribe; nội dung giao diện nêu rõ giới hạn này.
- Chưa có email xác minh tài khoản hoặc email giao dịch.
- Không có tài khoản demo cố định; tạo tài khoản customer rồi dùng lệnh promote để cấp admin theo hướng dẫn.
