/**
 * 生成插件图标（纯 Node 实现，无外部依赖）
 * 设计：低饱和科技蓝圆角方块 + 白色对话气泡 + 三个圆点
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../public/icons')

/* ---------- PNG 编码 ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4
      const di = y * (width * 4 + 1) + 1 + x * 4
      raw[di] = rgba[si]
      raw[di + 1] = rgba[si + 1]
      raw[di + 2] = rgba[si + 2]
      raw[di + 3] = rgba[si + 3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ---------- 绘制 ---------- */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

function distToRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = clamp(x, x0 + r, x1 - r)
  const cy = clamp(y, y0 + r, y1 - r)
  return Math.hypot(x - cx, y - cy) - r
}

function draw(size) {
  const s = size / 128
  const px = new Uint8Array(size * size * 4)
  const inBubble = (x, y) => distToRoundRect(x, y, 30 * s, 30 * s, 98 * s, 72 * s, 10 * s) <= 0
  const inTail = (x, y) =>
    y >= 68 * s &&
    y <= 84 * s &&
    x >= 40 * s &&
    x <= 64 * s &&
    y - 68 * s <= (x - 40 * s) * 0.7 &&
    y - 68 * s <= (64 * s - x) * 0.9
  const dot = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) <= r

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const nx = x / s
      const ny = y / s
      // 背景圆角方块
      const inBg = distToRoundRect(nx, ny, 4, 4, 124, 124, 26) <= 0
      if (!inBg) {
        px[i + 3] = 0
        continue
      }
      // 垂直渐变（低饱和科技蓝）
      const t = ny / 128
      const r = Math.round(0x4a + (0x3b - 0x4a) * t)
      const g = Math.round(0x7d + (0x5b - 0x7d) * t)
      const b = Math.round(0xff + (0xdb - 0xff) * t)
      let cr = r
      let cg = g
      let cb = b
      // 白色气泡 + 尾巴
      if (inBubble(nx, ny) || inTail(nx, ny)) {
        cr = cg = cb = 255
      }
      // 蓝色圆点
      if (
        inBubble(nx, ny) &&
        (dot(nx, ny, 47 * s / s, 51, 3.2) ||
          dot(nx, ny, 58, 51, 3.2) ||
          dot(nx, ny, 69, 51, 3.2))
      ) {
        cr = 0x4a
        cg = 0x7d
        cb = 0xff
      }
      px[i] = cr
      px[i + 1] = cg
      px[i + 2] = cb
      px[i + 3] = 255
    }
  }
  return encodePNG(size, size, px)
}

mkdirSync(OUT_DIR, { recursive: true })
for (const size of [16, 32, 48, 128]) {
  const file = resolve(OUT_DIR, `icon${size}.png`)
  writeFileSync(file, draw(size))
  console.log(`generated ${file}`)
}
