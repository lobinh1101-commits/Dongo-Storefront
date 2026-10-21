# Nội dung bảo vệ — Dongo Storefront

## Bài trình bày ngắn

Dongo Storefront là website thương mại điện tử gồm giao diện React/TypeScript/Vite và API Node.js/Express. Chế độ local/test dùng SQLite; Docker Compose chạy backend trên MySQL cùng Nginx reverse proxy, phpMyAdmin, Prometheus/Grafana, Loki và Grafana Alloy. Hai database độc lập và không tự chuyển đổi dữ liệu. Backend là nơi xác thực payload, phân quyền, đọc catalog, tính lại giá và ghi đơn; trình duyệt không được quyết định trạng thái thanh toán.

Để cài đặt trên Windows, cài Node.js từ 22.5.0, giải nén gói và chạy `npm ci` tại root. Tạo `backend/.env` từ `.env.example`, giữ secret riêng ngoài source, rồi `npm run dev`. Kiểm tra giao diện tại `http://localhost:5173` và API tại `/api/health`.

Database SQLite mặc định là `backend/data/storefront.sqlite`; Compose dùng named volume MySQL riêng. Script `Manage-SqliteDatabase.ps1` tạo snapshot SQLite bằng Node, xác minh `PRAGMA quick_check`, và restore chỉ sau khi backend dừng, người vận hành xác nhận, đồng thời giữ safety backup cùng file cũ.

Quyền admin được cấp có kiểm soát cho tài khoản đã đăng ký bằng script backend; API vẫn kiểm tra role. Ở local log ghi stdout/stderr; Compose tập trung log JSON backend/Nginx qua Grafana Alloy vào Loki và lấy metrics qua Prometheus. Alloy v1.20.1 đã được thử canary; file và volume Promtail cũ được giữ để rollback. Khi có sự cố cần kiểm tra port, cấu hình, health, Network tab và đúng database của môi trường nhưng không in secret/token.

Trước bàn giao chạy `npm test`, lint hai workspace và `npm run build`; script ZIP allow-list loại `.env`, DB/backup, logs và `node_modules`, đồng thời audit archive. Checkout hiện tạo đơn COD/PENDING với `payment_status = 'PAID'` trực tiếp trong database; không cần merchant hoặc callback thanh toán.

Giới hạn hiện tại gồm chưa có tồn kho, email xác minh, email/newsletter delivery, hãng vận chuyển hoặc production deployment. Hướng phát triển phù hợp là quy trình xác nhận thu tiền COD có audit trail và kiểm thử UI/accessibility.

## 10 câu hỏi thường gặp

1. **Vì sao dùng cả SQLite và MySQL?** SQLite dễ chạy local/test; Compose minh họa backend kết nối MySQL và các service vận hành. Dữ liệu tách biệt; không tự chuyển database.
2. **Frontend và backend giao tiếp thế nào?** JSON API qua `/api`; Vite proxy khi local.
3. **Mật khẩu được lưu ra sao?** Hash bcryptjs, không lưu plaintext.
4. **Phân quyền admin ở đâu?** Middleware backend kiểm tra session và role, không dựa vào ẩn nút.
5. **Giá đơn do ai tính?** Backend truy vấn catalog rồi tính lại trong transaction.
6. **Idempotency giải quyết gì?** Ngăn retry tạo đơn trùng với cùng key/payload.
7. **Đơn COD được lưu thế nào?** API tạo order có `payment_method = 'COD'`, `status = 'PENDING'`, `payment_status = 'PAID'` và lưu các mặt hàng trong `order_items`.
8. **Đơn COD có thể được giao không?** Admin có thể cập nhật fulfillment theo từng bước.
9. **Sao lưu DB khi app chạy thế nào?** Node `DatabaseSync.serialize()` tạo snapshot SQLite; script verify bằng quick_check, kể cả cấu hình WAL.
10. **Hạn chế triển khai nào?** Chưa có cloud/CI/CD, tồn kho, email, vận chuyển hoặc tích hợp thanh toán trực tuyến. Compose là demo HTTP trên loopback; production còn cần TLS, secrets manager và backup/restore MySQL.
