# 7. Câu hỏi bảo vệ dự kiến

### 1. Mục tiêu của Dongo Storefront?

Minh họa quy trình bán hàng web: catalog từ database, xác thực, giỏ hàng, tạo đơn COD có kiểm tra backend và trang quản trị.

### 2. Vì sao chọn React và TypeScript?

React chia UI thành component và quản lý tương tác; TypeScript ràng buộc kiểu cho user, product và request. Vite phục vụ phát triển và build frontend.

### 3. Vì sao Express?

Express tổ chức API auth, products, orders và admin. Middleware thực hiện kiểm tra phiên/quyền, giới hạn request và xử lý lỗi; Zod kiểm tra payload.

### 4. Vì sao có cả SQLite và MySQL?

SQLite qua `node:sqlite` dễ chạy local và thuận tiện cho test in-memory. Stack Docker Compose dùng MySQL server qua adapter `mysql2`, có named volume riêng. Hai database độc lập, không có tự động chuyển dữ liệu. Lựa chọn DB server hữu ích để minh họa cấu hình nhiều dịch vụ, nhưng không tự bảo đảm production readiness.

### 5. Mật khẩu và phiên được bảo vệ thế nào?

Mật khẩu băm bằng bcryptjs. Backend phát JWT cookie `HttpOnly`; API đọc phiên và tải role từ database. Logout xóa cookie. Secret production cấu hình ngoài source và cần đủ độ dài.

### 6. Vì sao backend không tin giá từ trình duyệt?

Request chỉ đưa product ID và quantity; server kiểm tra catalog trong DB đang cấu hình và tự tính tổng, sau đó lưu tên/đơn giá snapshot trong order item.

### 7. Idempotency-Key dùng làm gì?

Retry cùng user/key/fingerprint trả lại đơn đã có thay vì tạo đơn mới. Tái dùng key với payload khác bị trả 409.

### 8. Vì sao order item lưu tên và giá?

Để giữ lịch sử tại thời điểm mua dù sản phẩm sau đó đổi tên/giá. `product_id` hiện không có foreign key, nên không phải ràng buộc tham chiếu được DB bảo đảm.

### 9. Đơn COD được tạo và lưu như thế nào?

Checkout gửi thông tin giỏ hàng và giao nhận tới `POST /api/orders`. Backend tự đọc giá catalog và tạo `orders` với `payment_method = 'COD'`, `status = 'PENDING'`, `payment_status = 'pending'`, rồi lưu snapshot sản phẩm vào `order_items`.

### 10. Làm thế nào tránh tạo đơn trùng khi client retry?

`Idempotency-Key` cùng fingerprint của dữ liệu được lưu theo user. Retry cùng key/payload trả lại đơn trước đó; dùng lại key cho payload khác bị từ chối.

### 11. Customer có thể gọi API admin không?

Không. API admin chạy `authenticate` và `requireAdmin`; anonymous nhận 401, customer nhận 403. Role được tải từ database; đăng ký không nhận role từ client.

### 12. Migration giữ dữ liệu cũ thế nào?

SQLite và MySQL dùng migration idempotent, thêm schema/cột còn thiếu và không ghi đè catalog hiện có. Migration ảnh chỉ đổi URL seed cũ đã nhận diện và giữ URL tùy chỉnh. Test legacy hiện chạy trên SQLite; Compose/MySQL đã được smoke-test riêng qua API.

### 13. Các giới hạn nghiệp vụ?

Chưa có tồn kho, hãng vận chuyển, email xác minh/newsletter hoặc tích hợp thanh toán điện tử. Giao hàng được cập nhật thủ công; yêu thích/cart lưu trên thiết bị.

### 14. Đã kiểm thử những gì?

Các test tự động, lint và build được chạy trước khi bàn giao; kiểm tra COD bao gồm tạo đơn, phương thức/thời trạng thái lưu trong database, order items, retry idempotent và cập nhật fulfillment. Stack Compose có thể kiểm tra riêng qua API MySQL, phpMyAdmin và monitoring. Chưa xác minh mọi viewport, thiết bị thật hoặc toàn bộ keyboard flow.

### 15. Hướng phát triển tiếp theo?

Hoàn thiện quy trình xác nhận đã thu tiền COD có audit trail, tăng test UI/accessibility, rồi xem xét email/tồn kho/vận chuyển theo yêu cầu nghiệp vụ.
