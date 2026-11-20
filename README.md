# NALA Web Dashboard

Web Dashboard untuk monitoring dan visualisasi kondisi kapal NALA pada proyek Autonomous Surface Vehicle (ASV) Barunastra.

Dashboard dibuat menggunakan **React, TypeScript, Vite, dan ROSLIB**. Aplikasi dikemas menggunakan Docker agar mudah dijalankan di komputer anggota tim.

## 1. Requirements

Pastikan komputer sudah memiliki:

- Docker
- Git
- Koneksi jaringan yang sama dengan komputer ROS 2 (jika ROS berjalan di komputer lain)

## 2. Clone Repository

Buka terminal dan jalankan:

```bash
git clone https://github.com/khlaufey/nala-web-dashboard.git
cd nala-web-dashboard
```

## 3. Build Docker Image

Jalankan perintah berikut dari folder `nala-web-dashboard`:

```bash
sudo docker build -t nala-web-dashboard .
```

Tunggu hingga proses build selesai.

## 4. Run Dashboard

Jalankan container dengan perintah:

```bash
sudo docker run --rm -d \
  --name nala-web-dashboard \
  -p 8080:80 \
  nala-web-dashboard
```

Setelah container berjalan, buka browser:

**http://localhost:8080**

Dashboard sekarang dapat diakses melalui browser.

## 5. Menghubungkan Dashboard dengan ROS 2

Dashboard menggunakan ROSLIB melalui WebSocket untuk menerima data dari ROS 2.

Alamat WebSocket yang digunakan saat ini:

```text
ws://localhost:9090
```

Agar komunikasi berjalan, komputer yang menjalankan ROS 2 harus menjalankan `rosbridge_websocket`.

Contoh menjalankan rosbridge pada Ubuntu dengan ROS 2 Jazzy:

```bash
source /opt/ros/jazzy/setup.bash
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

Pastikan rosbridge sudah terpasang dan berjalan pada port `9090`.

**Penting mengenai koneksi antar-komputer:**

- Jika dashboard dan ROS 2 berjalan di komputer yang sama, `localhost` dapat digunakan.
- Jika dashboard dibuka dari laptop lain, `localhost` harus diganti dengan alamat IP komputer yang menjalankan ROS 2.
- Kedua komputer harus dapat saling berkomunikasi melalui jaringan.
- Pastikan port `9090` dapat diakses dari komputer dashboard.

Jika alamat WebSocket perlu diubah, sesuaikan konfigurasi koneksi ROSLIB pada source code dashboard, lalu build ulang Docker image.

## 6. Menghentikan Dashboard

Untuk menghentikan container:

```bash
sudo docker stop nala-web-dashboard
```

Karena container dijalankan dengan opsi `--rm`, container akan otomatis dihapus setelah dihentikan. Docker image tetap tersimpan sehingga tidak perlu build ulang setiap kali menjalankan dashboard.

## 7. Rebuild Setelah Perubahan Source Code

Jika terdapat perubahan pada source code dashboard, jalankan:

```bash
sudo docker build -t nala-web-dashboard .
```

Hentikan container lama jika masih berjalan, kemudian jalankan kembali perintah pada bagian Run Dashboard.

## 8. Catatan Integrasi

Dashboard merupakan bagian visualisasi dan monitoring, bukan pengganti ROS 2, simulator, atau sistem kontrol kapal.

Integrasi data seperti mission state, battery, vessel position, E-STOP, FTP score, activity log, dan camera feed bergantung pada ketersediaan topic, service, dan koneksi ROS 2 yang sesuai.

**Untuk integrasi Camera View:** koordinasikan dengan anggota tim Vision mengenai topic gambar ROS 2, format pesan, dan mekanisme streaming yang digunakan sebelum menghubungkan live camera feed ke dashboard.

---

**Repository:** https://github.com/khlaufey/nala-web-dashboard
