# Hồ sơ bảo vệ đồ án — Dongo Storefront

Bộ tài liệu được lập từ mã nguồn, schema SQLite/MySQL, API, Docker Compose và kết quả kiểm tra thực tế. Những phần chưa chạy hoặc chưa tích hợp thật được đánh dấu rõ, không thay bằng kết quả giả định.

Báo cáo kỹ thuật 10 phần/trang về hạ tầng, vận hành, kết quả kiểm tra và nghiệm thu: [Báo cáo triển khai](../BAO_CAO_TRIEN_KHAI.md).

## Danh mục

1. [Tổng quan và kiến trúc](./01-tong-quan-kien-truc.md)
2. [Sơ đồ cơ sở dữ liệu ERD](./02-erd.md)
3. [Mô tả chức năng và phạm vi](./03-mo-ta-chuc-nang.md)
4. [Bộ test case và bằng chứng](./04-bo-test-case.md)
5. [Kiểm thử giao diện và ảnh chụp](./05-kiem-thu-giao-dien.md)
6. [Hướng dẫn demo trên Windows](./06-huong-dan-demo.md)
7. [Câu hỏi bảo vệ dự kiến](./07-cau-hoi-bao-ve.md)

Thư mục [anh-chup](./anh-chup/) có ảnh trình duyệt trực tiếp. Ảnh quản trị và checkout dùng SQLite `:memory:` cùng dữ liệu giả lập chỉ tồn tại trong tiến trình demo; không dùng database cá nhân hoặc giao dịch thật.

## Cần hoàn thiện trước khi nộp

- Chạy checklist trong tài liệu kiểm thử giao diện trên thiết bị/trình duyệt sẽ dùng khi bảo vệ.
- Bổ sung ảnh cho các kích thước/trạng thái đang ghi “Chưa kiểm tra” sau khi tự thực hiện.
- Chỉ kiểm tra VNPay đầu cuối khi có merchant sandbox và URL IPN HTTPS công khai; test tự động không thay thế giao dịch sandbox.
