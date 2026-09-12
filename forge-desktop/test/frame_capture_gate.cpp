// frame_capture_gate.cpp — the picture Archie is actually shown.
//
// The swapchain read-back is the whole window and the whole window is the wrong
// input for a vision model. MEASURED on a real capture from the installed app
// (1680x1000): the 3D viewport is 1038x639 at (307,134) -- 39.5% of the frame --
// so 60.5% is application chrome, and that chrome DISPLAYS A BULLETED LIST OF
// COMMAND NAMES. Archie's known failure is copying op names rather than deriving
// them, so handing it a picture that spells them out beside the part feeds the
// failure directly. Cropping takes the PNG 6,721,578 -> 2,659,147 bytes, which
// is 2.53x and is EXACTLY the area ratio: PngWriter stores uncompressed, so size
// is not an independent argument for cropping. The modality is.
//
// PngWriter had no gate at all before this: it writes every evidence image in
// the project and nothing checked a pixel of it.
//
// Pure functions only -- no window, no swapchain, no GPU.
#include "../src/PngWriter.hpp"

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace {
int g_checks = 0;
int g_failures = 0;
int g_mutation = 0;

void ck(const char* what, bool ok, const std::string& detail = "") {
  ++g_checks;
  if (ok) {
    std::printf("    ok   %s\n", what);
  } else {
    ++g_failures;
    std::printf("    FAIL %s%s%s\n", what, detail.empty() ? "" : "  -> ",
                detail.c_str());
  }
}

// Every call below goes through this, so --mutate swaps in a DEFECTIVE crop and
// the checks have to catch it. A gate whose mutation only flips its own exit
// code proves nothing: it would be red for a reason that has no bearing on the
// code it guards.
bool crop(const std::uint8_t* src, std::uint32_t sw, std::uint32_t sh, int x, int y,
          int w, int h, std::vector<std::uint8_t>& out, std::uint32_t& ow,
          std::uint32_t& oh) {
  switch (g_mutation) {
    case 1:
      // Right SIZE, wrong PLACE -- always from the origin. This is the failure
      // that matters most: a 1038x639 image that is the feature tree and the
      // menu bar instead of the part, and every size assertion still passes.
      return forge::desktop::png::cropRgba(src, sw, sh, 0, 0, w, h, out, ow, oh);
    case 2:
      // Never refuse: slide a rect that lies outside back inside and return a
      // picture of somewhere else rather than nothing.
      if (x >= static_cast<int>(sw)) x = static_cast<int>(sw) - w;
      if (y >= static_cast<int>(sh)) y = static_cast<int>(sh) - h;
      return forge::desktop::png::cropRgba(src, sw, sh, x, y, w, h, out, ow, oh);
    case 3: {
      // Claim success whatever happened, which is how a caller ends up writing
      // an empty buffer and calling it a frame.
      forge::desktop::png::cropRgba(src, sw, sh, x, y, w, h, out, ow, oh);
      return true;
    }
    default:
      return forge::desktop::png::cropRgba(src, sw, sh, x, y, w, h, out, ow, oh);
  }
}

// A source image whose every pixel encodes its own coordinates, so a crop that
// lands in the wrong place is visible rather than merely the wrong size.
std::vector<std::uint8_t> ramp(std::uint32_t w, std::uint32_t h) {
  std::vector<std::uint8_t> v(static_cast<std::size_t>(w) * h * 4);
  for (std::uint32_t y = 0; y < h; ++y) {
    for (std::uint32_t x = 0; x < w; ++x) {
      std::uint8_t* p = v.data() + (static_cast<std::size_t>(y) * w + x) * 4;
      p[0] = static_cast<std::uint8_t>(x & 0xFF);
      p[1] = static_cast<std::uint8_t>(y & 0xFF);
      p[2] = static_cast<std::uint8_t>((x + y) & 0xFF);
      p[3] = 255;
    }
  }
  return v;
}
}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) {
      g_mutation = std::atoi(argv[++i]);
    }
  }
  std::printf("== frame capture ==\n");

  const std::uint32_t SW = 64, SH = 32;
  const std::vector<std::uint8_t> src = ramp(SW, SH);
  std::vector<std::uint8_t> out;
  std::uint32_t ow = 0, oh = 0;

  // ── the ordinary crop ──────────────────────────────────────────────────────
  {
    const bool ok = crop(src.data(), SW, SH, 10, 4, 20, 8,
                                                  out, ow, oh);
    ck("a rect inside the image crops", ok);
    ck("  ...to exactly the size asked for",
       ow == 20 && oh == 8,
       std::to_string(ow) + "x" + std::to_string(oh));
    ck("  ...and the buffer is tightly packed RGBA",
       out.size() == static_cast<std::size_t>(20) * 8 * 4,
       std::to_string(out.size()));
    // Top-left of the crop must be the source pixel at (10,4), not (0,0): a crop
    // of the right SIZE from the wrong PLACE is the failure that matters.
    ck("  ...and it is taken from the right PLACE",
       !out.empty() && out[0] == 10 && out[1] == 4,
       out.empty() ? "empty" : std::to_string(out[0]) + "," + std::to_string(out[1]));
    // ...and the last pixel is (10+20-1, 4+8-1) = (29,11).
    const std::size_t last = out.size() - 4;
    ck("  ...right through to its bottom-right pixel",
       out.size() >= 4 && out[last] == 29 && out[last + 1] == 11,
       std::to_string(out[last]) + "," + std::to_string(out[last + 1]));
  }

  // ── a rect that runs off the edge is CLAMPED, not refused ──────────────────
  {
    const bool ok = crop(src.data(), SW, SH, 60, 28, 40, 40,
                                                  out, ow, oh);
    ck("a rect running past the edge still crops", ok);
    ck("  ...clamped to what exists", ow == 4 && oh == 4,
       std::to_string(ow) + "x" + std::to_string(oh));
  }
  {
    const bool ok = crop(src.data(), SW, SH, -6, -6, 10, 10,
                                                  out, ow, oh);
    ck("a rect starting before the origin still crops", ok);
    ck("  ...clamped, and starting at the true origin",
       ow == 4 && oh == 4 && !out.empty() && out[0] == 0 && out[1] == 0,
       std::to_string(ow) + "x" + std::to_string(oh));
  }

  // ── refusals: a wrong picture is worse than no picture ─────────────────────
  {
    ck("a rect wholly off the right edge is REFUSED",
       !crop(src.data(), SW, SH, 64, 0, 10, 10, out, ow, oh));
    ck("  ...and reports no size", ow == 0 && oh == 0);
    ck("  ...and leaves no pixels behind", out.empty());
    ck("a zero-width rect is REFUSED",
       !crop(src.data(), SW, SH, 0, 0, 0, 10, out, ow, oh));
    ck("a negative-height rect is REFUSED",
       !crop(src.data(), SW, SH, 0, 0, 10, -2, out, ow, oh));
    ck("a null source is REFUSED",
       !crop(nullptr, SW, SH, 0, 0, 10, 10, out, ow, oh));
    ck("an empty source is REFUSED",
       !crop(src.data(), 0, 0, 0, 0, 10, 10, out, ow, oh));
  }

  // ── the real measured rect, at the real measured size ──────────────────────
  {
    const std::uint32_t W = 1680, H = 1000;
    const std::vector<std::uint8_t> win = ramp(W, H);
    const bool ok = crop(win.data(), W, H, 307, 134, 1038,
                                                  639, out, ow, oh);
    ck("the MEASURED viewport rect crops out of a real-sized window", ok);
    ck("  ...to 1038x639", ow == 1038 && oh == 639,
       std::to_string(ow) + "x" + std::to_string(oh));
    const double frac = (static_cast<double>(ow) * oh) / (static_cast<double>(W) * H);
    ck("  ...which is the 39.5% of the frame that is actually the part",
       frac > 0.39 && frac < 0.40, std::to_string(frac));
  }

  // ── and it still writes a PNG ──────────────────────────────────────────────
  {
    const std::string path = std::string(std::getenv("TMPDIR") ? std::getenv("TMPDIR")
                                                               : "/tmp") +
                             "/forge_frame_capture_gate.png";
    std::remove(path.c_str());
    crop(src.data(), SW, SH, 8, 8, 16, 16, out, ow, oh);
    const bool wrote = forge::desktop::png::writeRgba(path, out.data(), ow, oh);
    ck("the cropped buffer writes as a PNG", wrote);
    std::FILE* f = std::fopen(path.c_str(), "rb");
    unsigned char hdr[8] = {0};
    const std::size_t n = f ? std::fread(hdr, 1, 8, f) : 0;
    if (f) std::fclose(f);
    const unsigned char sig[8] = {0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};
    ck("  ...and what lands on disk is really a PNG",
       n == 8 && std::memcmp(hdr, sig, 8) == 0);
    std::remove(path.c_str());
  }

  std::printf("\n[frame_capture] %d checks, %d failures\n", g_checks, g_failures);
  if (g_mutation != 0 && g_failures == 0) {
    std::printf("[frame_capture] mutation %d was NOT caught\n", g_mutation);
    return 1;
  }
  return g_failures == 0 ? 0 : 1;
}
