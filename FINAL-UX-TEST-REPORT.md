# Báo cáo kiểm thử cuối — Dongo Storefront

Ngày kiểm thử: 2026-10-11

Ghi chú: Đây là báo cáo lịch sử trước khi checkout được chuyển sang COD; các nhận xét về thanh toán VNPay trong nội dung bên dưới không mô tả luồng hiện tại.

## 1. Phạm vi và môi trường

- Đọc scripts trong `package.json` gốc và hai workspace trước khi chạy lệnh.
- Workspace yêu cầu Node.js `>=22.5.0`; phiên bản môi trường đã xác nhận trước đó là Node.js 26.5.1 và npm 11.17.0.
- Kiểm tra giao diện bằng trình duyệt tại `http://localhost:5173`, với API/catalog và dữ liệu quản trị giả lập qua route interception. Không dùng dữ liệu đơn hàng thật.
- Không thực hiện giao dịch VNPay thật. Luồng thanh toán dùng URL giả lập; URL placeholder trả về 404, vì vậy đây không phải xác nhận tích hợp VNPay đầu cuối.

## 2. Danh sách file đã sửa trong các đợt hoàn thiện

- `backend/server/app.js` — xác thực, API nghiệp vụ, quyền truy cập và luồng đặt hàng/thanh toán.
- `backend/server/db.js` — khởi tạo/migration dữ liệu và catalog SQLite.
- `backend/server/app.test.js` — kiểm thử backend nghiệp vụ, phân quyền, dữ liệu và callback.
- `frontend/src/App.tsx` — trạng thái phiên, tìm kiếm, yêu thích, giỏ hàng, modal và biểu mẫu.
- `frontend/src/api.ts` — lớp gọi API frontend.
- `frontend/src/auth-state.js` — trạng thái hiển thị tài khoản và revision chống phản hồi phiên cũ.
- `frontend/src/auth-state.d.ts` — kiểu TypeScript cho helper trạng thái auth.
- `frontend/src/auth-state.test.js` — kiểm thử trạng thái anonymous, authenticated, loading và logout.
- `frontend/src/Storefront.css` — responsive, khả năng đọc, vùng chạm, focus và bảng quản trị.
- `frontend/src/index.css` — thay kiểu mặc định Vite bằng CSS nền phù hợp giao diện Dongo.
- `frontend/src/Admin.tsx` — nhãn truy cập và vùng cuộn có thể focus cho các bảng.
- `frontend/src/package.json` — scripts/cấu hình kiểm thử frontend.
- `package.json` — scripts workspace dùng chung.
- `README.md` — mô tả cài đặt, chạy, kiểm tra và phạm vi chức năng.
- Đã xóa `frontend/src/App.css` sau khi xác nhận không còn import và chỉ chứa style template Vite cũ.
- `FINAL-UX-TEST-REPORT.md` — báo cáo này.

## 3. Cải tiến đã hoàn thành

- Trạng thái tài khoản phân biệt rõ đang khôi phục phiên, chưa đăng nhập và đã đăng nhập; tránh khôi phục lại dữ liệu user cũ sau logout.
- Tìm kiếm chỉ lọc khi nhập; Enter mới cuộn tới danh sách. Bỏ từ khóa khôi phục danh sách đầy đủ.
- Yêu thích lưu trong `localStorage`; nút thông báo trạng thái đã thích/chưa thích và ảnh lỗi có nội dung thay thế.
- Header mobile có các hàng riêng cho logo/tài khoản, tìm kiếm và điều hướng.
- Modal hỗ trợ focus ban đầu, focus trap, Escape, khôi phục focus và khóa cuộn/nền.
- Bảng admin giữ chiều rộng tối thiểu 720px và cuộn trong vùng chứa riêng; toàn trang không bị tràn ngang.
- CSS nền không còn dark mode/viền/root sizing mặc định gây xung đột với giao diện Dongo.

## 4. Kiểm thử và kết quả

### Kiểm thử tự động

| Lệnh | Kết quả |
|---|---|
| `npm test` | **11 pass, 0 fail** — backend 7/7; frontend 4/4 |
| `npm run lint` | Pass — Oxlint frontend |
| `npm run lint --workspace=backend` | Pass — `node --check` backend |
| `npm run build` | Pass — `tsc -b` và Vite build |

Build tạo bundle frontend thành công với Vite 8.3.2. Backend test có log lỗi DB được chủ ý mô phỏng (`database is not open` và lỗi transaction); test xác nhận lỗi được xử lý và vẫn pass, không phải test thất bại.

### Responsive trên trình duyệt

Đã đo storefront và trang admin tại **320, 360, 390, 430, 768, 1024 và 1440px**.

- Storefront: không phát hiện tràn ngang tài liệu; header không chồng lấn; ba liên kết điều hướng hiện diện; tìm kiếm nằm ở hàng riêng; hero và footer nằm trong chiều rộng; tên sản phẩm giới hạn hai dòng.
- Lưới sản phẩm có 2 cột ở 320–430px, 3 cột ở 768–1024px và 4 cột ở 1440px.
- Admin: không phát hiện tràn ngang toàn trang. Bảng có `min-width: 720px`; ở mobile phần tràn nằm trong `.admin-table-wrap`. Vùng bảng có role/accessible name và nhận focus bằng bàn phím.
- Đã chụp/kiểm tra trực quan storefront tại 320px; các kích thước còn lại được kiểm tra bằng số đo DOM/layout trong trình duyệt.
- Modal tài khoản ở 320px nằm trong viewport sau khi hiệu ứng mở kết thúc; không làm rộng tài liệu theo chiều ngang.

### Luồng và khả năng truy cập

- Tìm kiếm: khớp “đèn” trả 1 sản phẩm; từ khóa không khớp trả trạng thái rỗng; xóa từ khóa khôi phục 8 sản phẩm; focus vẫn ở ô nhập; Enter cuộn tới danh sách.
- Danh mục “Nhà cửa” trả đúng 2 sản phẩm khi không còn từ khóa tìm kiếm. Giá tăng dần/giảm dần cho thứ tự đúng.
- Yêu thích: cập nhật `aria-pressed`, ghi `localStorage` và vẫn giữ trạng thái sau reload trong tab kiểm thử sạch.
- Giỏ hàng: thêm 2 lần cập nhật số lượng, thông báo thêm sản phẩm xuất hiện; tăng số lượng và xóa sản phẩm hoạt động; trạng thái giỏ trống hiện rõ.
- Modal: focus chuyển vào modal, Tab/Shift+Tab không thoát nền, Escape đóng modal, focus quay lại nút mở; nền inert và khóa cuộn được gỡ khi đóng.
- Đăng ký/đăng nhập: nhãn form được nhận diện; email sai định dạng và mật khẩu đăng ký dưới 8 ký tự bị trình duyệt chặn theo thuộc tính validation.
- Checkout: khách được yêu cầu đăng nhập; sau đăng nhập giả lập form giao hàng xuất hiện; các trường bắt buộc/ràng buộc độ dài được kiểm tra. Request order và chuyển tiếp thanh toán dùng mock, không xác nhận thanh toán thật.
- Admin: dashboard, tab đơn hàng/tài khoản/sản phẩm, chi tiết đơn, nhãn biểu mẫu và vùng cuộn bảng được kiểm tra bằng dữ liệu giả lập.
- Ảnh sản phẩm không tải được chuyển sang alt text dự phòng; nút biểu tượng kiểm tra được có accessible name.

## 5. Vấn đề còn tồn tại / chưa xác minh

- Chưa thực hiện VNPay sandbox end-to-end/IPN thực tế. Cần merchant sandbox hợp lệ và URL HTTPS công khai để kiểm tra callback.
- API được giả lập trong QA trình duyệt; các số liệu giao diện admin và thao tác tạo đơn trong phần browser QA không đại diện dữ liệu backend đang chạy.
- Chưa kiểm tra trên thiết bị vật lý, trình duyệt khác hoặc với công nghệ hỗ trợ thực tế; chỉ xác minh bằng trình duyệt tích hợp và số đo DOM.
- Dự án hiện không gửi email xác minh/nhận tin; không có tồn kho hay tích hợp đơn vị vận chuyển. Đây là giới hạn chức năng được mô tả trong README, không được giả định là đã kiểm thử.
- Các chức năng đăng ký/đăng nhập được kiểm tra validation phía giao diện và mock checkout; các trường hợp nghiệp vụ backend được bao phủ bởi bộ test backend, không phải bằng giao dịch trực tiếp trên trình duyệt.

## 6. Kiểm thử thủ công trước khi nộp

1. Khởi động với database local và kiểm tra tài khoản khách: đăng ký, đăng nhập, refresh, logout và trạng thái header.
2. Kiểm tra tìm kiếm, danh mục, sắp xếp, yêu thích sau reload, giỏ hàng và các trạng thái rỗng/lỗi.
3. Kiểm tra checkout bằng dữ liệu hợp lệ/không hợp lệ; xác nhận giá/tổng tiền phía server và idempotency của đơn.
4. Đăng nhập admin, kiểm tra quyền customer/admin, thống kê, quản lý sản phẩm, chi tiết đơn và tiến độ giao hàng.
5. Dùng thiết bị thật hoặc DevTools kiểm tra 320–1440px, đặc biệt modal, bảng cuộn ngang, focus bàn phím và thao tác chạm.
6. Chỉ kiểm tra VNPay thật sau khi cấu hình merchant sandbox, callback/IPN HTTPS và xác nhận rõ môi trường sandbox.

## 7. Hướng dẫn chạy

Tại thư mục gốc `storefront`:

```powershell
npm ci
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

Thiết lập `SESSION_SECRET` trong `backend/.env` thành secret riêng dài tối thiểu 32 byte. Không chia sẻ secret hoặc commit file `.env`.

```powershell
npm run dev
```

- Website: http://localhost:5173
- Health API: http://localhost:3001/api/health
- Kiểm tra: `npm test`, `npm run lint`, `npm run lint --workspace=backend`, `npm run build`
- Để tạo admin, đăng ký tài khoản trước rồi chạy `npm run admin:promote --workspace=backend -- admin@example.com`.

Việc kiểm thử trên trình duyệt trong báo cáo này không thay thế xác minh dữ liệu thật, quyền truy cập trên môi trường triển khai hoặc thanh toán sandbox đầu cuối.
