# Auto-Cad-Claude

Clone CAD 2D ringkas yang berjalan terus dalam browser (TypeScript + Vite + HTML5 Canvas). Tiada backend.

## Jalankan

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit test (geometri, command input, DXF/SVG/JSON)
npm run build    # typecheck + build production ke dist/
```

## Ciri

- **Lukis:** Line, Polyline, Rectangle, Circle, Arc (3 titik), Text
- **Edit:** Select (klik / window / crossing), Move, Copy, Rotate, Scale, Erase
- **Mirror (`MI`):** pilih objek, klik 2 titik untuk garis cermin. Objek asal kekal. Arc dan polyline turut dicerminkan, text kekal boleh dibaca
- **Array (`AR`):** `R` = rectangular (taip `baris,lajur` lalu `jarak-baris,jarak-lajur`), `P` = polar (pusat, bilangan, sudut). Satu langkah undo
- **Fillet (`F`) / Chamfer (`CHA`):** pilih dua line (klik di sisi yang nak dikekalkan). Taip nombor untuk tukar radius / jarak (`d` atau `d1,d2`). Radius 0 = sambung dua line di sudut. Untuk rectangle / polyline, guna `X` (Explode) dulu
- **Explode (`X`):** pecahkan polyline terpilih jadi line
- **Dimension:** `DLI` linear (mengufuk / mencancang ikut kedudukan klik), `DAL` aligned, `DRA` radius (taip `D` untuk diameter). Dibina daripada line, anak panah dan text pada layer `DIM`, jadi ia boleh dieksport ke mana-mana. Saiz text ikut `TH`. Dimension tidak "hidup": ia tak berubah bila objek diedit
- **Text boleh diputar** (Rotate, dan disimpan/dieksport ke DXF & SVG)
- **Trim (`TR`):** klik bahagian objek yang nak dibuang. Semua objek lain jadi cutting edge. Line, arc, circle (perlu 2 persilangan) dan polyline (diletupkan jadi line)
- **Extend (`EX`):** klik hujung line, arc atau polyline terbuka. Ia dipanjangkan sampai objek lain yang pertama
- **Offset (`O`):** letak jarak (taip nombor, klik 2 titik, atau Enter), klik objek, klik sisi. Line, circle, arc, polyline (sudut mitre)
- **Ukur:** Distance (jarak, sudut, ΔX, ΔY)
- **Snap:** endpoint, midpoint, center, quadrant, grid snap, ortho
- **Layer:** warna, show/hide, lock, tukar layer untuk objek terpilih
- **Command line gaya AutoCAD:** `L`, `PL`, `REC`, `C`, `A`, `T`, `M`, `CO`, `RO`, `SC`, `MI`, `AR`, `TR`, `EX`, `O`, `F`, `CHA`, `X`, `DLI`, `DAL`, `DRA`, `E`, `DI`, `U`, `REDO`, `ZE`, `TH <saiz>`, `LAYER <nama>`
- **Input koordinat:** `10,20` (mutlak), `@5,0` (relatif), `50<45` (polar), `40` (jarak ke arah kursor / jejari)
- **Undo / Redo**, autosave ke localStorage
- **Fail:** simpan/buka `.json`, buka & eksport `.dxf` (LINE, CIRCLE, ARC, POLYLINE/LWPOLYLINE, TEXT), eksport `.svg` dan `.png`

## Kekunci

| Kekunci | Fungsi |
|---|---|
| Wheel | Zoom |
| Middle-drag / Alt+drag | Pan |
| Klik kanan / Space / Enter | Enter (tamat arahan) |
| Esc | Batal |
| F3 / F7 / F8 / F9 | Object snap / Grid / Ortho / Grid snap |
| Ctrl+Z / Ctrl+Y / Ctrl+S / Ctrl+A | Undo / Redo / Simpan / Pilih semua |

Drag dari kiri ke kanan = pilih objek yang tertutup sepenuhnya. Drag dari kanan ke kiri = pilih apa-apa yang tersentuh.

## Belum ada

Hatch, Block, dimension bersekutu (associative), fillet pada polyline/arc, Stretch, Break, Join, baca/tulis DWG (format proprietari), 3D, kerjasama masa nyata.
