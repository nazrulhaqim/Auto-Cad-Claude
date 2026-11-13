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
- **Trim (`TR`):** klik bahagian objek yang nak dibuang. Semua objek lain jadi cutting edge. Line, arc, circle (perlu 2 persilangan) dan polyline (diletupkan jadi line)
- **Extend (`EX`):** klik hujung line, arc atau polyline terbuka. Ia dipanjangkan sampai objek lain yang pertama
- **Offset (`O`):** letak jarak (taip nombor, klik 2 titik, atau Enter), klik objek, klik sisi. Line, circle, arc, polyline (sudut mitre)
- **Ukur:** Distance (jarak, sudut, ΔX, ΔY)
- **Snap:** endpoint, midpoint, center, quadrant, grid snap, ortho
- **Layer:** warna, show/hide, lock, tukar layer untuk objek terpilih
- **Command line gaya AutoCAD:** `L`, `PL`, `REC`, `C`, `A`, `T`, `M`, `CO`, `RO`, `SC`, `TR`, `EX`, `O`, `E`, `DI`, `U`, `REDO`, `ZE`, `TH <saiz>`, `LAYER <nama>`
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

Mirror, Fillet, Dimension, Hatch, Block, baca/tulis DWG (format proprietari), 3D, kerjasama masa nyata.
