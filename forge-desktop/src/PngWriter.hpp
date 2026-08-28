// forge-desktop/src/PngWriter.hpp — a dependency-free RGBA8 PNG writer.
//
// Lifted verbatim in behaviour from forge-desktop/renderer_probe.cpp, where it
// already writes the offscreen probe's evidence images. It is here, in a header,
// so the APPLICATION can produce the same kind of evidence from its LIVE
// swapchain — a screenshot of the running window is the only artefact that
// proves the app drew, as opposed to proving that an offscreen probe drew.
//
// Format: PNG (W3C/ISO 15948) with a zlib stream (RFC 1950) of STORED deflate
// blocks (RFC 1951, BTYPE=00). Stored blocks mean no compressor and no
// dependency; the file is larger and is still a byte-valid PNG that any decoder
// reads. CRC-32 is the standard IEEE 802.3 polynomial the PNG spec names.
#ifndef FORGE_DESKTOP_PNGWRITER_HPP
#define FORGE_DESKTOP_PNGWRITER_HPP

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

namespace forge::desktop::png {

inline std::uint32_t crc32Of(const std::uint8_t* p, std::size_t n, std::uint32_t crc) {
  static std::uint32_t table[256];
  static bool init = false;
  if (!init) {
    for (std::uint32_t i = 0; i < 256; ++i) {
      std::uint32_t c = i;
      for (int k = 0; k < 8; ++k) c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
      table[i] = c;
    }
    init = true;
  }
  crc ^= 0xFFFFFFFFu;
  for (std::size_t i = 0; i < n; ++i) crc = table[(crc ^ p[i]) & 0xFF] ^ (crc >> 8);
  return crc ^ 0xFFFFFFFFu;
}

inline void putBE32(std::vector<std::uint8_t>& v, std::uint32_t x) {
  v.push_back(static_cast<std::uint8_t>((x >> 24) & 0xFF));
  v.push_back(static_cast<std::uint8_t>((x >> 16) & 0xFF));
  v.push_back(static_cast<std::uint8_t>((x >> 8) & 0xFF));
  v.push_back(static_cast<std::uint8_t>(x & 0xFF));
}

inline void writeChunk(std::vector<std::uint8_t>& out, const char type[4],
                       const std::vector<std::uint8_t>& data) {
  putBE32(out, static_cast<std::uint32_t>(data.size()));
  std::vector<std::uint8_t> tc;
  tc.insert(tc.end(), type, type + 4);
  tc.insert(tc.end(), data.begin(), data.end());
  out.insert(out.end(), tc.begin(), tc.end());
  putBE32(out, crc32Of(tc.data(), tc.size(), 0));
}

inline bool writeRgba(const std::string& path, const std::uint8_t* rgba, std::uint32_t w,
                      std::uint32_t h) {
  std::vector<std::uint8_t> raw;
  raw.reserve(static_cast<std::size_t>(h) * (1 + static_cast<std::size_t>(w) * 4));
  for (std::uint32_t y = 0; y < h; ++y) {
    raw.push_back(0);  // filter type 0 (None)
    raw.insert(raw.end(), rgba + static_cast<std::size_t>(y) * w * 4,
               rgba + static_cast<std::size_t>(y + 1) * w * 4);
  }
  std::uint32_t a = 1, b = 0;
  for (std::uint8_t byte : raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const std::uint32_t adler = (b << 16) | a;

  std::vector<std::uint8_t> zlib;
  zlib.push_back(0x78);
  zlib.push_back(0x01);
  std::size_t off = 0;
  while (off < raw.size()) {
    const std::size_t block = std::min<std::size_t>(65535, raw.size() - off);
    zlib.push_back(off + block >= raw.size() ? 1 : 0);
    zlib.push_back(static_cast<std::uint8_t>(block & 0xFF));
    zlib.push_back(static_cast<std::uint8_t>((block >> 8) & 0xFF));
    const std::uint16_t nlen = static_cast<std::uint16_t>(~block);
    zlib.push_back(static_cast<std::uint8_t>(nlen & 0xFF));
    zlib.push_back(static_cast<std::uint8_t>((nlen >> 8) & 0xFF));
    zlib.insert(zlib.end(), raw.begin() + static_cast<std::ptrdiff_t>(off),
                raw.begin() + static_cast<std::ptrdiff_t>(off + block));
    off += block;
  }
  putBE32(zlib, adler);

  std::vector<std::uint8_t> out;
  const std::uint8_t sig[8] = {137, 'P', 'N', 'G', 13, 10, 26, 10};
  out.insert(out.end(), sig, sig + 8);
  std::vector<std::uint8_t> ihdr;
  putBE32(ihdr, w);
  putBE32(ihdr, h);
  ihdr.push_back(8);  // bit depth
  ihdr.push_back(6);  // colour type: RGBA
  ihdr.push_back(0);
  ihdr.push_back(0);
  ihdr.push_back(0);
  writeChunk(out, "IHDR", ihdr);
  writeChunk(out, "IDAT", zlib);
  writeChunk(out, "IEND", {});

  std::FILE* f = std::fopen(path.c_str(), "wb");
  if (f == nullptr) return false;
  const bool ok = std::fwrite(out.data(), 1, out.size(), f) == out.size();
  std::fclose(f);
  return ok;
}

}  // namespace forge::desktop::png

#endif  // FORGE_DESKTOP_PNGWRITER_HPP
