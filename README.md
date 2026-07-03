# MonTV Web Player

MonTV Web Player là trình phát truyền hình trực tuyến (IPTV) tối ưu trên trình duyệt Web, được phát triển trên nền tảng **React**, **TypeScript** và **Vite**. Dự án được thiết kế đồng bộ với hệ thống dữ liệu kênh và lịch phát sóng của phiên bản MonTV Android TV, đồng thời tinh chỉnh giao diện người dùng hiện đại, tinh tế và tối ưu cho môi trường duyệt web.

## 🚀 Tính Năng Nổi Bật

- 📺 **Giao Diện Hiện Đại & Cao Cấp**: Bố cục Sidebar danh mục toàn chiều cao (bên trái), kết hợp khu vực xem trước (Preview + EPG) và danh sách kênh dạng lưới kính mờ (glassmorphism) ở bên phải.
- ⚡ **Xem Trước Nhanh (Debounced MiniPlayer)**: Tự động chạy thử kênh ở dạng tắt tiếng trên khung preview sau 1.5 giây chọn kênh, giúp duyệt tìm nội dung trực quan.
- 🛡️ **Giải Quyết Lỗi Phát Web (Iframe & DRM)**: Tự động phát hiện và chuyển các luồng phát nhúng/DRM ClearKey (như nhóm kênh VTV, SCTV, Cinemaworld, HBO) sang thẻ `<iframe>` để xử lý giải mã trực tiếp trong môi trường sandbox của trình duyệt.
- 🔗 **Tự Động Nâng Cấp HTTPS**: Tự động chuyển đổi giao thức của luồng phát từ `http://` sang `https://` nếu máy chủ web đang chạy trên HTTPS, loại bỏ triệt để lỗi Mixed Content.
- 🔄 **Chuyển Nguồn Dự Phòng Thông Minh**: Tự động chuyển đổi qua lại giữa các nguồn phát phụ nếu nguồn chính bị gián đoạn hoặc tải quá 10 giây.
- 🔒 **Khóa Nguồn Ổn Định**: Lưu trữ và khóa nguồn phát hoạt động tốt nhất vào `localStorage` của trình duyệt làm mặc định cho các lần truy cập sau.
- 📅 **Lịch Phát Sóng EPG**: Tích hợp EPG chi tiết của ngày hiện tại, tự động hiển thị chương trình đang phát dưới dạng thanh tiến trình (progress bar) trực quan.

## 🛠️ Hướng Dẫn Cài Đặt & Phát Triển Cục Bộ

1. **Cài đặt các gói phụ thuộc**:
   ```bash
   npm install
   ```

2. **Chạy máy chủ phát triển cục bộ với HTTPS**:
   Dự án sử dụng plugin tự tạo chứng chỉ SSL (`@vitejs/plugin-basic-ssl`) giúp kích hoạt giao thức HTTPS cục bộ nhằm hỗ trợ đầy đủ các tính năng EME/DRM trên trình duyệt:
   ```bash
   npm run dev
   ```
   Sau khi chạy, truy cập địa chỉ: `https://localhost:5173`

3. **Xây dựng phiên bản Production**:
   ```bash
   npm run build
   ```

## 🌐 Cấu Hình Triển Khai Trên Vercel

Dự án đã được cấu hình hoàn chỉnh sẵn sàng để triển khai trực tiếp lên **Vercel** thông qua hệ thống **Vercel Serverless Functions**:

- **Bypass CORS & Cloudflare**: Máy chủ Vercel đóng vai trò là một proxy trung gian gửi các yêu cầu lấy danh sách kênh (`/api-playlist`) và lịch phát sóng (`/api-epg`), tự động đè header `User-Agent: OkHttp/4.9.2` và `Referer` để vượt qua tường lửa Cloudflare của nhà cung cấp.
- **Tập tin cấu hình**: Xem cấu hình định tuyến tại `vercel.json` và mã nguồn proxy tại thư mục `api/`.
