#include "update/Sha256.hpp"

#include <cctype>
#include <cstdio>
#include <cstring>
#include <vector>

namespace forge::update {
namespace {

constexpr std::uint32_t kK[64] = {
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u,
    0x923f82a4u, 0xab1c5ed5u, 0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
    0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u, 0xe49b69c1u, 0xefbe4786u,
    0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u,
    0x06ca6351u, 0x14292967u, 0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
    0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u, 0xa2bfe8a1u, 0xa81a664bu,
    0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au,
    0x5b9cca4fu, 0x682e6ff3u, 0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
    0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u};

inline std::uint32_t rotr(std::uint32_t x, int n) {
  return (x >> n) | (x << (32 - n));
}

struct Ctx {
  std::uint32_t h[8] = {0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
                        0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u};
  std::uint8_t buf[64] = {};
  std::size_t buflen = 0;
  std::uint64_t total = 0;
};

void block(Ctx& c, const std::uint8_t* p) {
  std::uint32_t w[64];
  for (int i = 0; i < 16; ++i) {
    w[i] = (static_cast<std::uint32_t>(p[i * 4 + 0]) << 24) |
           (static_cast<std::uint32_t>(p[i * 4 + 1]) << 16) |
           (static_cast<std::uint32_t>(p[i * 4 + 2]) << 8) |
           (static_cast<std::uint32_t>(p[i * 4 + 3]));
  }
  for (int i = 16; i < 64; ++i) {
    const std::uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
    const std::uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  std::uint32_t a = c.h[0], b = c.h[1], cc = c.h[2], d = c.h[3];
  std::uint32_t e = c.h[4], f = c.h[5], g = c.h[6], hh = c.h[7];
  for (int i = 0; i < 64; ++i) {
    const std::uint32_t S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const std::uint32_t ch = (e & f) ^ ((~e) & g);
    const std::uint32_t t1 = hh + S1 + ch + kK[i] + w[i];
    const std::uint32_t S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const std::uint32_t maj = (a & b) ^ (a & cc) ^ (b & cc);
    const std::uint32_t t2 = S0 + maj;
    hh = g; g = f; f = e; e = d + t1;
    d = cc; cc = b; b = a; a = t1 + t2;
  }
  c.h[0] += a; c.h[1] += b; c.h[2] += cc; c.h[3] += d;
  c.h[4] += e; c.h[5] += f; c.h[6] += g; c.h[7] += hh;
}

void update(Ctx& c, const std::uint8_t* p, std::size_t n) {
  c.total += n;
  if (c.buflen > 0) {
    const std::size_t need = 64 - c.buflen;
    const std::size_t take = n < need ? n : need;
    std::memcpy(c.buf + c.buflen, p, take);
    c.buflen += take;
    p += take;
    n -= take;
    if (c.buflen == 64) {
      block(c, c.buf);
      c.buflen = 0;
    }
  }
  while (n >= 64) {
    block(c, p);
    p += 64;
    n -= 64;
  }
  if (n > 0) {
    std::memcpy(c.buf, p, n);
    c.buflen = n;
  }
}

std::string finish(Ctx& c) {
  const std::uint64_t bits = c.total * 8ull;
  std::uint8_t pad = 0x80;
  update(c, &pad, 1);
  c.total -= 1;  // padding is not message length
  pad = 0x00;
  while (c.buflen != 56) {
    update(c, &pad, 1);
    c.total -= 1;
  }
  std::uint8_t len[8];
  for (int i = 0; i < 8; ++i) len[i] = static_cast<std::uint8_t>((bits >> (56 - 8 * i)) & 0xffu);
  update(c, len, 8);

  static const char* kHex = "0123456789abcdef";
  std::string out;
  out.reserve(64);
  for (int i = 0; i < 8; ++i) {
    for (int b = 3; b >= 0; --b) {
      const std::uint8_t byte = static_cast<std::uint8_t>((c.h[i] >> (8 * b)) & 0xffu);
      out.push_back(kHex[byte >> 4]);
      out.push_back(kHex[byte & 0x0f]);
    }
  }
  return out;
}

}  // namespace

std::string sha256Hex(const void* data, std::size_t len) {
  Ctx c;
  update(c, static_cast<const std::uint8_t*>(data), len);
  return finish(c);
}

std::string sha256Hex(const std::string& s) { return sha256Hex(s.data(), s.size()); }

std::string sha256File(const std::string& path, std::string& err) {
  std::FILE* f = std::fopen(path.c_str(), "rb");
  if (f == nullptr) {
    err = "cannot open " + path;
    return std::string();
  }
  Ctx c;
  std::vector<std::uint8_t> buf(1u << 16);
  for (;;) {
    const std::size_t n = std::fread(buf.data(), 1, buf.size(), f);
    if (n > 0) update(c, buf.data(), n);
    if (n < buf.size()) {
      if (std::ferror(f) != 0) {
        std::fclose(f);
        err = "read error on " + path;
        return std::string();
      }
      break;
    }
  }
  std::fclose(f);
  return finish(c);
}

bool hexDigestEquals(const std::string& a, const std::string& b) {
  // An empty or wrong-length digest is never equal to anything -- this is what
  // stops a failed sha256File() (which returns "") from comparing equal to a
  // manifest field that is also empty because it was missing.
  if (a.size() != 64 || b.size() != 64) return false;
  unsigned diff = 0;
  for (std::size_t i = 0; i < 64; ++i) {
    const unsigned char ca =
        static_cast<unsigned char>(std::tolower(static_cast<unsigned char>(a[i])));
    const unsigned char cb =
        static_cast<unsigned char>(std::tolower(static_cast<unsigned char>(b[i])));
    diff |= static_cast<unsigned>(ca ^ cb);
  }
  return diff == 0;
}

}  // namespace forge::update
