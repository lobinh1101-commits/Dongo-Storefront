# 3. Mô tả chức năng và phạm vi

## Khách hàng

| Chức năng | Hiện trạng |
|---|---|
| Xem sản phẩm | `GET /api/products` lấy catalog từ database đang cấu hình (SQLite local/test hoặc MySQL Compose); API `GET /api/products/:id` cũng có. |
| Tìm kiếm, lọc, sắp xếp | Có trên storefront; thao tác phía giao diện trên danh sách tải về. |
| Ảnh sản phẩm | Ảnh mẫu cục bộ tại `frontend/public/images/products/`; nguồn ảnh là trường SQLite. Component dùng chung ở storefront, giỏ hàng và admin. |
| Yêu thích | Lưu trong `localStorage`; không đồng bộ tài khoản/thiết bị qua backend. |
| Đăng ký/đăng nhập/đăng xuất | Có; email chuẩn hóa, mật khẩu tối thiểu 8 ký tự và băm bằng bcryptjs; phiên dùng JWT cookie `HttpOnly`. |
| Xác minh email | Chưa có. Tài khoản dùng được sau đăng ký; không có email xác minh. |
| Giỏ hàng | Lưu trên trình duyệt. Backend vẫn kiểm tra mã/số lượng, đọc lại giá và tính tổng. |
| Tạo đơn | Cần đăng nhập; kiểm tra giỏ, số lượng, sản phẩm, người nhận, điện thoại và địa chỉ. Transaction và `Idempotency-Key` chống ghi đơn trùng do retry. |
| Xem đơn | Người dùng chỉ xem danh sách/chi tiết đơn của chính mình. |
| Thanh toán | `POST /api/orders` tạo đơn trực tiếp với `payment_method = 'COD'`, `status = 'PENDING'`, `payment_status = 'pending'`; trả về mã và thông tin đơn hàng. |
| Newsletter | Lưu email duy nhất vào SQLite; chưa có dịch vụ gửi tin/hủy đăng ký. |

## Quản trị viên

| Chức năng | Hiện trạng |
|---|---|
| Dashboard | Thống kê tài khoản, đơn, đơn chờ thanh toán và doanh thu đã thanh toán từ API. |
| Tài khoản/vai trò | Danh sách và đổi vai trò; backend ngăn tự hạ quyền và hạ quyền admin cuối cùng. |
| Đơn hàng | Danh sách, chi tiết, thông tin giao hàng và mặt hàng. |
| Tiến độ giao hàng | Tuần tự `new → processing → shipped → delivered`; chặn bỏ bước; cho phép admin xử lý đơn COD khi chờ thu tiền. |
| Sản phẩm | Thêm, sửa, ngừng/mở bán. Ngừng bán đổi `active`, không xóa bản ghi. Ảnh nhận URL HTTPS, đường dẫn local hoặc mã Unsplash hợp lệ. |
| Dữ liệu thanh toán cũ | Các bảng đối soát có thể còn trong database để bảo toàn dữ liệu lịch sử; checkout COD không tạo giao dịch hoặc callback thanh toán. |

## Bảo vệ và giới hạn

- API tài khoản/đơn cần phiên; API quản trị cần thêm role `admin`. Kiểm tra quyền nằm ở backend.
- Đăng ký không nhận role do người dùng gửi; admin ban đầu được cấp qua lệnh quản trị trên máy có quyền với database.
- Không có tồn kho nên hệ thống không giữ/trừ kho; trạng thái giao hàng do admin nhập thủ công.
- Chưa có hãng vận chuyển, email, thu tiền điện tử hoặc tích hợp cổng thanh toán trực tuyến.
- Cart và yêu thích lưu cục bộ trên thiết bị, có thể mất khi xóa dữ liệu trình duyệt.
