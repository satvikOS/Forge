// render_gate.cpp — THE FIRST GATE THAT LOOKS AT PIXELS.
//
// ── the hole this closes ────────────────────────────────────────────────────
// ViewportRenderer.cpp compiled into forge_desktop and into NOTHING ELSE. No
// gate linked it, run_desktop.sh declines to launch the windowed app ("it needs
// a display server"), and so every GPU-side defect in the one panel the whole
// application exists to show was invisible to a suite that reported ALL GREEN.
// The frame gate asserts on ImGui draw data; the frame-capture gate asserts on a
// crop of an image somebody else produced. Neither has ever seen the viewport
// rasterize a triangle.
//
// This gate renders the REAL ViewportRenderer, with the REAL shaders, over the
// REAL default part, on the REAL GPU, with no window and no swapchain, copies
// the offscreen colour attachment back to host memory and asserts ON THE PIXELS.
// It does it from TWO cameras asserted in full -- the framed isometric the app
// opens on and the same view four wheel notches in -- and then SWEEPS SIXTEEN,
// because the defect below is a depth-test race whose size depends on the
// camera, and one view is one observable.
//
// ── the one gate here that needs a GPU, and what it does without one ────────
// This is the only GATE that calls vkCreateInstance -- the application and the
// two hand-run probes do too, but no other gate does. Every other gate
// run_desktop.sh drives is device-free, which is exactly how the viewport came
// to have no instrument on it. That makes this the only gate that can fail for a
// reason that is not about this project's code, so the no-device case is decided
// rather than left to chance:
//
//   no Vulkan device        exit 77 (SKIPPED) with a banner naming the machine
//                           and the fix. run_desktop.sh reports it in its own
//                           verdict line and does not run the mutations.
//   FORGE_REQUIRE_GPU=1     the same absent device is a FAILURE instead. Set it
//                           on a machine that is supposed to have one.
//   a device, then a
//   failed Vulkan call      a real failure: exit 1, red.
//
// --simulate-no-device forces the skip branch on a machine that DOES have a
// device, which is how run_desktop.sh proves the skip path is real before
// trusting it. A skip nobody has executed is a no-op gate waiting to happen.
//
// ── what it asserts, and why each one is the check it is ────────────────────
// The viewport's job is a CAD picture: a shaded solid with its feature edges
// INKED. A machinist reads the part off the edges -- the hole rim, the face
// boundaries, the fillet tangent lines -- and a shaded-only blob is unreadable.
// So the assertions are about ink, and they are made per EDGE SEGMENT rather
// than on a pixel total, because the defect this gate was written for does not
// remove the edges: it makes them BREAK UP. A count of dark pixels cannot tell a
// continuous rim from a dashed one; a per-segment coverage can.
//
// Every edge segment KernelScene extracted is projected with the SAME camera
// matrix the vertex shader used, walked pixel by pixel in screen space (which is
// exactly what the rasterizer does with a line), and classified:
//
//   coverage >= 0.90  DRAWN    the segment is inked along its whole length
//   coverage <= 0.10  HIDDEN   the solid occludes it -- correct for a back edge
//   otherwise         BROKEN   it is dashed: the defect, named
//
// HIDDEN is asserted to be NON-EMPTY on purpose. "Shaded with edges" is not
// "wireframe": the far side of the bore must stay behind the material. Without
// that check the cheapest way to make the edges continuous -- switch the depth
// test off -- would pass, and the picture would be wrong in a new way.
//
// ── AND TWO CHECKS ABOUT THIS GATE'S OWN FOOTING ────────────────────────────
// Both exist because they were found reporting GREEN on the defect they cover.
//
//   the SPIR-V in this binary was compiled from shaders/viewport_solid.{vert,frag}
//     The generated .spv.h is a build product of a timestamp rule. Touch it, or
//     restore a shader with an older mtime, and glslang is skipped while the
//     binary keeps the previous shader. MEASURED: kEdgeDepthBias = 0.0 in the
//     tree plus a touched header and this gate printed "36 checks, 0 failed".
//     Each header now carries the bytes glslang was handed and this compares
//     them with the files on disk.
//
//   the colour attachment is created TRANSFER_SRC
//     Every assertion here reads the frame back with vkCmdCopyImageToBuffer,
//     which the spec allows only on an image created with that usage. Deleting
//     the bit from ViewportRenderer::createTarget left this gate GREEN, because
//     MoltenVK copied anyway -- so the one line the whole gate rests on was
//     unguarded, and a stricter driver would have turned every pixel check red
//     at once for a reason none of them names.
//
// Pure offscreen: no VkSurfaceKHR, no swapchain, no window server. Dear ImGui's
// Vulkan backend is initialised because ViewportRenderer::createTarget registers
// its colour view as an ImGui texture; nothing here draws an ImGui frame.
//
// Usage:  forge_desktop_render_gate [--mutate N] [--png <path>]
//                                   [--simulate-no-device]
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <string_view>
#include <vector>

#include <vulkan/vulkan.h>

#include "imgui.h"
#include "imgui_impl_vulkan.h"

#include "forge/ui/Types.hpp"

#include "../src/Camera.hpp"
#include "../src/KernelScene.hpp"
#include "../src/PartFile.hpp"
#include "../src/PngWriter.hpp"
#include "../src/ViewportRenderer.hpp"

// ★ WHERE THE SHADERS THIS GATE CLAIMS TO TEST LIVE. Supplied by CMake, and a
// hard error rather than a default, because the check it feeds -- "the SPIR-V in
// this binary was compiled from those files" -- is exactly the kind that is
// worth nothing if it quietly compares a build product against itself.
#ifndef FORGE_VIEWPORT_SHADER_DIR
#error "FORGE_VIEWPORT_SHADER_DIR must be defined by the build (forge-desktop/CMakeLists.txt)"
#endif

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
    std::printf("    FAIL %s%s%s\n", what, detail.empty() ? "" : "  -> ", detail.c_str());
  }
}

std::string num(double v) {
  char buf[64];
  std::snprintf(buf, sizeof(buf), "%.4g", v);
  return buf;
}

// ── reading the shader sources back off disk ────────────────────────────────
bool readWholeFile(const std::string& path, std::string& out) {
  std::FILE* f = std::fopen(path.c_str(), "rb");
  if (f == nullptr) return false;
  out.clear();
  char buf[8192];
  std::size_t n = 0;
  while ((n = std::fread(buf, 1, sizeof(buf), f)) > 0) out.append(buf, n);
  const bool ok = std::ferror(f) == 0;
  std::fclose(f);
  return ok;
}

// Where two byte strings first differ, as "byte N (line L)" -- so a stale header
// names the edit that was not compiled instead of saying only that something is
// different.
std::string firstDifference(std::string_view a, std::string_view b) {
  const std::size_t n = std::min(a.size(), b.size());
  std::size_t i = 0;
  while (i < n && a[i] == b[i]) ++i;
  std::size_t line = 1;
  for (std::size_t j = 0; j < i && j < a.size(); ++j) {
    if (a[j] == '\n') ++line;
  }
  if (i == n && a.size() == b.size()) return "no byte differs";
  return "first difference at byte " + num(static_cast<double>(i)) + " (line " +
         num(static_cast<double>(line)) + ")";
}

// ── the offscreen target's colours, as the shaders write them ───────────────
// R8G8B8A8_UNORM, so a GLSL float lands at round(v * 255) with no sRGB step.
//   ground  vec4(0.086, 0.098, 0.117)  -> (22, 25, 30)   ViewportRenderer clears
//   ink     vec4(0.05,  0.06,  0.08)   -> (13, 15, 20)   viewport_solid.frag, mode 1
// The darkest a SHADED pixel can be is base(0.68,0.72,0.78) * the 0.25 ambient
// floor -> (43, 46, 50), so the three are separable with room to spare.
constexpr int kInk[3] = {13, 15, 20};
constexpr int kGround[3] = {22, 25, 30};

bool near3(const std::uint8_t* px, const int want[3], int tol) {
  for (int i = 0; i < 3; ++i) {
    if (std::abs(static_cast<int>(px[i]) - want[i]) > tol) return false;
  }
  return true;
}

struct Image {
  std::vector<std::uint8_t> rgba;
  std::uint32_t w = 0;
  std::uint32_t h = 0;
  const std::uint8_t* at(int x, int y) const {
    return rgba.data() + (static_cast<std::size_t>(y) * w + static_cast<std::size_t>(x)) * 4;
  }
  bool inside(int x, int y) const {
    return x >= 0 && y >= 0 && x < static_cast<int>(w) && y < static_cast<int>(h);
  }
  // Ink within one pixel of (x,y). The one-pixel slack absorbs the difference
  // between this walk's rounding and the rasterizer's diamond-exit rule; it does
  // NOT hide a dashed line, whose gaps are many pixels long.
  bool inkNear(int x, int y) const {
    for (int dy = -1; dy <= 1; ++dy) {
      for (int dx = -1; dx <= 1; ++dx) {
        if (inside(x + dx, y + dy) && near3(at(x + dx, y + dy), kInk, 3)) return true;
      }
    }
    return false;
  }
};

// Column-major mat4 (Camera's convention) times a point.
void projectPoint(const float m[16], const float p[3], float out[4]) {
  for (int i = 0; i < 4; ++i) {
    out[i] = m[0 * 4 + i] * p[0] + m[1 * 4 + i] * p[1] + m[2 * 4 + i] * p[2] + m[3 * 4 + i];
  }
}

struct ScreenPoint {
  float x = 0.0f;
  float y = 0.0f;
  bool valid = false;
};

ScreenPoint toScreen(const float mvp[16], const float p[3], std::uint32_t w, std::uint32_t h) {
  float clip[4];
  projectPoint(mvp, p, clip);
  ScreenPoint s;
  if (clip[3] <= 1e-6f) return s;  // behind the eye
  const float nx = clip[0] / clip[3];
  const float ny = clip[1] / clip[3];
  const float nz = clip[2] / clip[3];
  if (nx < -1.0f || nx > 1.0f || ny < -1.0f || ny > 1.0f || nz < 0.0f || nz > 1.0f) return s;
  s.x = (nx * 0.5f + 0.5f) * static_cast<float>(w);
  s.y = (ny * 0.5f + 0.5f) * static_cast<float>(h);
  s.valid = true;
  return s;
}

enum class SegVerdict { Offscreen, TooShort, Drawn, Hidden, Broken };

struct SegStats {
  SegVerdict verdict = SegVerdict::Offscreen;
  float coverage = 0.0f;
  int samples = 0;
  // THE SECOND OBSERVABLE, and it is not a re-reading of the first. `coverage`
  // is a RATIO, and on this part it is quantised: 36 judgeable segments framed
  // means one segment is 2.8 percentage points, so a 15% threshold sits one
  // segment away from the defect's 16.67%. `maxGap` is the longest run of
  // CONSECUTIVE un-inked samples inside one segment, in pixels -- a length, not
  // a count, and it is what "dashed" actually means. The stitching defect
  // chops the fillet tangents into 5-pixel dashes with 3-5 pixel gaps; a
  // correctly inked edge has no interior gap at all. The two can disagree: a
  // segment that is 89% covered by one long gap is BROKEN by coverage and also
  // caught here, while 36 segments each missing one scattered pixel would move
  // coverage and leave maxGap at 1. Neither is derivable from the other.
  int maxGap = 0;
};

// Walk the segment in SCREEN space. A rasterized line between two projected
// endpoints IS a straight screen-space segment, so linear interpolation here is
// not an approximation of what the GPU did -- it is the same walk.
SegStats measureSegment(const Image& img, const float mvp[16], const float a[3],
                        const float b[3]) {
  SegStats st;
  const ScreenPoint sa = toScreen(mvp, a, img.w, img.h);
  const ScreenPoint sb = toScreen(mvp, b, img.w, img.h);
  if (!sa.valid || !sb.valid) return st;
  const float dx = sb.x - sa.x;
  const float dy = sb.y - sa.y;
  const float len = std::sqrt(dx * dx + dy * dy);
  if (len < 3.0f) {
    st.verdict = SegVerdict::TooShort;
    return st;
  }
  const int n = std::min(512, static_cast<int>(len) + 1);
  int hits = 0;
  // The gap walk. `run` is the current streak of un-inked samples; it is only
  // folded into maxGap once ink is seen AGAIN, so a segment that simply ENDS in
  // the dark -- a silhouette edge running off the part, or a back edge going
  // behind the material -- does not report its tail as a gap. An INTERIOR gap is
  // the thing a dashed line has and a continuous line does not.
  int run = 0;
  bool seenInk = false;
  for (int i = 0; i <= n; ++i) {
    const float t = static_cast<float>(i) / static_cast<float>(n);
    const int px = static_cast<int>(sa.x + dx * t);
    const int py = static_cast<int>(sa.y + dy * t);
    if (!img.inside(px, py)) continue;
    ++st.samples;
    if (img.inkNear(px, py)) {
      ++hits;
      if (seenInk && run > st.maxGap) st.maxGap = run;
      run = 0;
      seenInk = true;
    } else if (seenInk) {
      ++run;
    }
  }
  if (st.samples == 0) return st;
  st.coverage = static_cast<float>(hits) / static_cast<float>(st.samples);
  if (st.coverage >= 0.90f) {
    st.verdict = SegVerdict::Drawn;
  } else if (st.coverage <= 0.10f) {
    st.verdict = SegVerdict::Hidden;
  } else {
    st.verdict = SegVerdict::Broken;
  }
  return st;
}

// ── headless Vulkan ─────────────────────────────────────────────────────────
struct Vk {
  VkInstance instance = VK_NULL_HANDLE;
  VkPhysicalDevice phys = VK_NULL_HANDLE;
  VkDevice device = VK_NULL_HANDLE;
  VkQueue queue = VK_NULL_HANDLE;
  std::uint32_t queueFamily = 0;
  VkCommandPool pool = VK_NULL_HANDLE;
  VkRenderPass imguiPass = VK_NULL_HANDLE;
  char deviceName[VK_MAX_PHYSICAL_DEVICE_NAME_SIZE] = {0};
};

bool hasInstanceExt(const char* name) {
  std::uint32_t n = 0;
  vkEnumerateInstanceExtensionProperties(nullptr, &n, nullptr);
  std::vector<VkExtensionProperties> exts(n);
  vkEnumerateInstanceExtensionProperties(nullptr, &n, exts.data());
  for (const VkExtensionProperties& e : exts) {
    if (std::strcmp(e.extensionName, name) == 0) return true;
  }
  return false;
}

// ── what "this machine cannot run the gate" means, as a value ───────────────
// THE DISTINCTION THIS ENUM EXISTS FOR. A machine with no Vulkan loader and no
// ICD is not a machine with a broken renderer -- it is a machine with no
// instrument, and an absent instrument reported as a defect turns every
// GPU-less CI runner red for something this commit did not break. But a machine
// that HAS a device and then fails to make a queue, a command pool or a render
// pass out of it is a real failure and must stay red.
//
//   NoDevice  vkCreateInstance failed, or zero VkPhysicalDevice enumerated.
//             There is nothing here to render on. SKIP, loudly.
//   Broken    a device exists and a call against it failed. RED.
//   Ready     go.
enum class VkInit { Ready, NoDevice, Broken };

VkInit initVulkan(Vk& vk, std::string& why) {
  VkApplicationInfo app{};
  app.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
  app.pApplicationName = "forge_desktop_render_gate";
  app.apiVersion = VK_API_VERSION_1_2;

  std::vector<const char*> instExts;
  const bool portability = hasInstanceExt(VK_KHR_PORTABILITY_ENUMERATION_EXTENSION_NAME);
  if (portability) instExts.push_back(VK_KHR_PORTABILITY_ENUMERATION_EXTENSION_NAME);

  VkInstanceCreateInfo ici{};
  ici.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
  if (portability) ici.flags = VK_INSTANCE_CREATE_ENUMERATE_PORTABILITY_BIT_KHR;
  ici.pApplicationInfo = &app;
  ici.enabledExtensionCount = static_cast<std::uint32_t>(instExts.size());
  ici.ppEnabledExtensionNames = instExts.empty() ? nullptr : instExts.data();
  if (vkCreateInstance(&ici, nullptr, &vk.instance) != VK_SUCCESS) {
    why = "vkCreateInstance failed — no Vulkan loader, or no ICD for it to load";
    return VkInit::NoDevice;
  }

  std::uint32_t n = 0;
  vkEnumeratePhysicalDevices(vk.instance, &n, nullptr);
  if (n == 0) {
    why = "the loader enumerated zero VkPhysicalDevice (is VK_ICD_FILENAMES set to "
          "$(brew --prefix molten-vk)/etc/vulkan/icd.d/MoltenVK_icd.json?)";
    return VkInit::NoDevice;
  }
  std::vector<VkPhysicalDevice> devs(n);
  vkEnumeratePhysicalDevices(vk.instance, &n, devs.data());
  vk.phys = devs[0];
  VkPhysicalDeviceProperties props{};
  vkGetPhysicalDeviceProperties(vk.phys, &props);
  std::memcpy(vk.deviceName, props.deviceName, sizeof(vk.deviceName));

  std::uint32_t qn = 0;
  vkGetPhysicalDeviceQueueFamilyProperties(vk.phys, &qn, nullptr);
  std::vector<VkQueueFamilyProperties> qfp(qn);
  vkGetPhysicalDeviceQueueFamilyProperties(vk.phys, &qn, qfp.data());
  bool found = false;
  for (std::uint32_t i = 0; i < qn; ++i) {
    if (qfp[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) {
      vk.queueFamily = i;
      found = true;
      break;
    }
  }
  if (!found) {
    why = "no graphics queue family";
    return VkInit::Broken;
  }

  std::uint32_t den = 0;
  vkEnumerateDeviceExtensionProperties(vk.phys, nullptr, &den, nullptr);
  std::vector<VkExtensionProperties> devExts(den);
  vkEnumerateDeviceExtensionProperties(vk.phys, nullptr, &den, devExts.data());
  std::vector<const char*> enableDevExts;
  for (const VkExtensionProperties& e : devExts) {
    if (std::strcmp(e.extensionName, "VK_KHR_portability_subset") == 0) {
      enableDevExts.push_back("VK_KHR_portability_subset");
    }
  }

  float prio = 1.0f;
  VkDeviceQueueCreateInfo qci{};
  qci.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
  qci.queueFamilyIndex = vk.queueFamily;
  qci.queueCount = 1;
  qci.pQueuePriorities = &prio;
  VkDeviceCreateInfo dci{};
  dci.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
  dci.queueCreateInfoCount = 1;
  dci.pQueueCreateInfos = &qci;
  dci.enabledExtensionCount = static_cast<std::uint32_t>(enableDevExts.size());
  dci.ppEnabledExtensionNames = enableDevExts.empty() ? nullptr : enableDevExts.data();
  if (vkCreateDevice(vk.phys, &dci, nullptr, &vk.device) != VK_SUCCESS) {
    why = "vkCreateDevice failed";
    return VkInit::Broken;
  }
  vkGetDeviceQueue(vk.device, vk.queueFamily, 0, &vk.queue);

  VkCommandPoolCreateInfo pci{};
  pci.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
  pci.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
  pci.queueFamilyIndex = vk.queueFamily;
  if (vkCreateCommandPool(vk.device, &pci, nullptr, &vk.pool) != VK_SUCCESS) {
    why = "vkCreateCommandPool failed";
    return VkInit::Broken;
  }

  // A render pass for Dear ImGui's own pipeline. It is never begun: the backend
  // exists only so ViewportRenderer::createTarget can register its colour view
  // as an ImGui texture, which is how the shell composites the viewport.
  VkAttachmentDescription att{};
  att.format = VK_FORMAT_R8G8B8A8_UNORM;
  att.samples = VK_SAMPLE_COUNT_1_BIT;
  att.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
  att.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
  att.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
  att.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
  att.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
  att.finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
  VkAttachmentReference ref{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
  VkSubpassDescription sub{};
  sub.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
  sub.colorAttachmentCount = 1;
  sub.pColorAttachments = &ref;
  VkRenderPassCreateInfo rp{};
  rp.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
  rp.attachmentCount = 1;
  rp.pAttachments = &att;
  rp.subpassCount = 1;
  rp.pSubpasses = &sub;
  if (vkCreateRenderPass(vk.device, &rp, nullptr, &vk.imguiPass) != VK_SUCCESS) {
    why = "vkCreateRenderPass(imgui) failed";
    return VkInit::Broken;
  }
  return VkInit::Ready;
}

std::uint32_t memoryTypeFor(VkPhysicalDevice phys, std::uint32_t bits,
                            VkMemoryPropertyFlags want) {
  VkPhysicalDeviceMemoryProperties mp{};
  vkGetPhysicalDeviceMemoryProperties(phys, &mp);
  for (std::uint32_t i = 0; i < mp.memoryTypeCount; ++i) {
    if ((bits & (1u << i)) && (mp.memoryTypes[i].propertyFlags & want) == want) return i;
  }
  return UINT32_MAX;
}

// Records the viewport pass, copies the colour attachment into host memory and
// waits. One submit, no frame loop: the picture is a pure function of the scene
// and the camera, so one frame is the whole observable.
bool renderAndReadBack(Vk& vk, forge::desktop::ViewportRenderer& viewport,
                       const forge::desktop::Camera& camera, Image& out, std::string& why) {
  const std::uint32_t w = viewport.width();
  const std::uint32_t h = viewport.height();
  if (w == 0 || h == 0) {
    why = "the offscreen target has no size";
    return false;
  }
  const VkDeviceSize bytes = static_cast<VkDeviceSize>(w) * h * 4;

  VkBufferCreateInfo bi{};
  bi.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
  bi.size = bytes;
  bi.usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT;
  bi.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
  VkBuffer readback = VK_NULL_HANDLE;
  if (vkCreateBuffer(vk.device, &bi, nullptr, &readback) != VK_SUCCESS) {
    why = "vkCreateBuffer(readback) failed";
    return false;
  }
  VkMemoryRequirements mr{};
  vkGetBufferMemoryRequirements(vk.device, readback, &mr);
  VkMemoryAllocateInfo ai{};
  ai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
  ai.allocationSize = mr.size;
  ai.memoryTypeIndex = memoryTypeFor(vk.phys, mr.memoryTypeBits,
                                     VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                                         VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
  if (ai.memoryTypeIndex == UINT32_MAX) {
    why = "no host-visible memory type for the readback buffer";
    return false;
  }
  VkDeviceMemory readbackMem = VK_NULL_HANDLE;
  if (vkAllocateMemory(vk.device, &ai, nullptr, &readbackMem) != VK_SUCCESS) {
    why = "vkAllocateMemory(readback) failed";
    return false;
  }
  vkBindBufferMemory(vk.device, readback, readbackMem, 0);

  VkCommandBufferAllocateInfo cai{};
  cai.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
  cai.commandPool = vk.pool;
  cai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
  cai.commandBufferCount = 1;
  VkCommandBuffer cmd = VK_NULL_HANDLE;
  if (vkAllocateCommandBuffers(vk.device, &cai, &cmd) != VK_SUCCESS) {
    why = "vkAllocateCommandBuffers failed";
    return false;
  }
  VkCommandBufferBeginInfo cbi{};
  cbi.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
  cbi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
  vkBeginCommandBuffer(cmd, &cbi);

  // ── THE APPLICATION'S OWN RECORDING PATH, unmodified ───────────────────
  viewport.record(cmd, camera, /*hoverFace=*/0, /*wireframe=*/false);

  // The pass leaves the colour image in SHADER_READ_ONLY_OPTIMAL (that is what
  // ImGui samples). Take it to TRANSFER_SRC to read it, and put it back.
  VkImageMemoryBarrier toSrc{};
  toSrc.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
  toSrc.oldLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
  toSrc.newLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
  toSrc.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
  toSrc.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
  toSrc.image = viewport.colorImage();
  toSrc.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
  toSrc.srcAccessMask = VK_ACCESS_SHADER_READ_BIT;
  toSrc.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
                       VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, nullptr, 0, nullptr, 1,
                       &toSrc);

  VkBufferImageCopy region{};
  region.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
  region.imageExtent = {w, h, 1};
  vkCmdCopyImageToBuffer(cmd, viewport.colorImage(), VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
                         readback, 1, &region);

  VkImageMemoryBarrier back = toSrc;
  back.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
  back.newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
  back.srcAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
  back.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                       VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, 0, 0, nullptr, 0, nullptr, 1,
                       &back);
  vkEndCommandBuffer(cmd);

  VkSubmitInfo si{};
  si.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
  si.commandBufferCount = 1;
  si.pCommandBuffers = &cmd;
  if (vkQueueSubmit(vk.queue, 1, &si, VK_NULL_HANDLE) != VK_SUCCESS) {
    why = "vkQueueSubmit failed";
    return false;
  }
  vkQueueWaitIdle(vk.queue);

  void* mapped = nullptr;
  if (vkMapMemory(vk.device, readbackMem, 0, bytes, 0, &mapped) != VK_SUCCESS) {
    why = "vkMapMemory(readback) failed";
    return false;
  }
  out.w = w;
  out.h = h;
  out.rgba.assign(static_cast<const std::uint8_t*>(mapped),
                  static_cast<const std::uint8_t*>(mapped) + bytes);
  vkUnmapMemory(vk.device, readbackMem);

  vkFreeCommandBuffers(vk.device, vk.pool, 1, &cmd);
  vkDestroyBuffer(vk.device, readback, nullptr);
  vkFreeMemory(vk.device, readbackMem, nullptr);
  return true;
}

// ── the exit code that means "not run" ──────────────────────────────────────
// 77, the autotools/Automake convention for SKIPPED, chosen so it cannot be
// confused with 0 (passed) or 1 (failed) by anything that reads exit codes.
// run_desktop.sh knows this number and reports the skip in its own verdict.
constexpr int kExitSkipped = 77;

}  // namespace

int main(int argc, char** argv) {
  std::string pngPath;
  bool simulateNoDevice = false;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) {
      g_mutation = std::atoi(argv[++i]);
    } else if (std::strcmp(argv[i], "--png") == 0 && i + 1 < argc) {
      pngPath = argv[++i];
    } else if (std::strcmp(argv[i], "--simulate-no-device") == 0) {
      // THE POSITIVE CONTROL FOR THE SKIP PATH. A skip that has never been
      // executed is a branch nobody has read, and the first machine without a
      // GPU is a bad place to find out it prints nothing or returns the wrong
      // code. run_desktop.sh runs this before the real gate and REQUIRES exit 77
      // and the banner below, so the skip machinery is proved on every machine
      // including the ones that have a device.
      simulateNoDevice = true;
    }
  }
  std::printf("forge_desktop_render_gate — the viewport, rendered, and read back\n");
  if (g_mutation != 0) std::printf("  [mutation %d active]\n", g_mutation);

  // ── 1. the GPU ────────────────────────────────────────────────────────────
  // ★ THIS IS THE ONLY GATE THAT CALLS vkCreateInstance. The application itself
  // does (src/main.cpp) and so do the two hand-run probes (renderer_probe.cpp,
  // ui_probe.cpp), but every other gate run_desktop.sh drives is device-free --
  // which makes this the only gate that can fail for a reason that is not about
  // this project's code.
  //
  // The rule here, decided rather than left to chance:
  //
  //   no device at all      SKIP, exit 77, with a banner naming the machine and
  //                         the fix. A runner without a Vulkan ICD has no
  //                         instrument; reporting that as a defect would turn
  //                         CI red for everyone on a machine that is merely
  //                         unequipped, which is a worse failure than the one
  //                         this gate was written to catch.
  //   FORGE_REQUIRE_GPU=1   the skip becomes RED. Set it on any runner that is
  //                         SUPPOSED to have a device, and the day its ICD stops
  //                         being installed is a red build instead of a silent
  //                         hole. This is how a skip is prevented from quietly
  //                         becoming a permanent no-op gate.
  //   a device, then a
  //   failed call           RED. That is a real defect, not an absent instrument.
  Vk vk;
  std::string why;
  std::printf("\n  [1] headless Vulkan, no surface and no swapchain\n");
  const VkInit vkInit = simulateNoDevice ? VkInit::NoDevice : initVulkan(vk, why);
  if (simulateNoDevice) why = "--simulate-no-device: the skip path, exercised on purpose";
  if (vkInit == VkInit::NoDevice) {
    const char* require = std::getenv("FORGE_REQUIRE_GPU");
    const bool required = require != nullptr && require[0] != '\0' &&
                          std::strcmp(require, "0") != 0;
    if (required) {
      ck("a Vulkan device is available to render on", false,
         why + " (FORGE_REQUIRE_GPU is set, so an absent device is a FAILURE here)");
      std::printf("\n  %d checks, %d failed\n", g_checks, g_failures);
      return 1;
    }
    std::printf(
        "\n"
        "  ┌──────────────────────────────────────────────────────────────────┐\n"
        "  │ RENDER GATE SKIPPED — THIS MACHINE HAS NO VULKAN DEVICE          │\n"
        "  └──────────────────────────────────────────────────────────────────┘\n"
        "  why: %s\n"
        "  NOTHING ABOUT THE VIEWPORT WAS CHECKED ON THIS RUN. Every check in this\n"
        "  gate and the whole sixteen-camera sweep were skipped; the shaded\n"
        "  picture, the inked edges and the depth offset in viewport_solid.vert\n"
        "  are all unverified here.\n"
        "  To make this a FAILURE instead of a skip on a machine that is supposed\n"
        "  to have a GPU, set FORGE_REQUIRE_GPU=1.\n"
        "  To give this machine a device on macOS:\n"
        "    brew install molten-vk vulkan-loader\n"
        "    export VK_ICD_FILENAMES=$(brew --prefix molten-vk)"
        "/etc/vulkan/icd.d/MoltenVK_icd.json\n",
        why.c_str());
    std::fprintf(stderr, "forge_desktop_render_gate: SKIPPED, no Vulkan device (%s)\n",
                 why.c_str());
    std::fflush(stdout);
    return kExitSkipped;
  }
  if (vkInit == VkInit::Broken) {
    ck("a Vulkan device is available to render on", false, why);
    std::printf("\n  %d checks, %d failed\n", g_checks, g_failures);
    return 1;
  }
  ck("a Vulkan device is available to render on", true);
  std::printf("         device: %s\n", vk.deviceName);

  ImGui::CreateContext();
  ImGui_ImplVulkan_InitInfo init{};
  init.ApiVersion = VK_API_VERSION_1_2;
  init.Instance = vk.instance;
  init.PhysicalDevice = vk.phys;
  init.Device = vk.device;
  init.QueueFamily = vk.queueFamily;
  init.Queue = vk.queue;
  init.DescriptorPool = VK_NULL_HANDLE;
  init.DescriptorPoolSize = 32;
  init.MinImageCount = 2;
  init.ImageCount = 2;
  init.PipelineInfoMain.RenderPass = vk.imguiPass;
  init.PipelineInfoMain.Subpass = 0;
  init.PipelineInfoMain.MSAASamples = VK_SAMPLE_COUNT_1_BIT;
  ck("the ImGui Vulkan backend initialises headless", ImGui_ImplVulkan_Init(&init));

  // ── 2. the part ───────────────────────────────────────────────────────────
  std::printf("\n  [2] the default part, through the real build path\n");
  forge::desktop::KernelScene scene;
  const bool built = (g_mutation == 4) ? scene.buildFromIr("%1 = RECT(1, 1)\n")
                                       : scene.buildFromIr(forge::desktop::defaultPartIr());
  // MUTATION 4 builds a PROFILE, not a solid: it tessellates to nothing, so the
  // viewport has no triangles. The coverage check below is what must notice.
  if (g_mutation != 4) {
    ck("the default part builds", built, scene.error());
  }
  const std::vector<forge::desktop::SceneVertex>& verts = scene.vertices();
  std::vector<forge::desktop::SceneVertex> edges = scene.edgeVertices();
  std::printf("         %zu triangles, %zu feature-edge segments\n", verts.size() / 3,
              edges.size() / 2);
  if (g_mutation != 4) {
    ck("the tessellation produced triangles", verts.size() >= 3,
       num(static_cast<double>(verts.size() / 3)) + " triangles");
    ck("KernelScene extracted feature edges", edges.size() >= 2,
       num(static_cast<double>(edges.size() / 2)) + " segments");
  }

  // The part's bounds are the geometry the rim check below is written against.
  // If the default part changes, this fails LOUDLY rather than letting the rim
  // check quietly find nothing and pass.
  const forge::desktop::Bounds& bounds = scene.bounds();
  if (g_mutation != 4) {
    const bool box = std::fabs(bounds.max[0] - bounds.min[0] - 80.0f) < 0.5f &&
                     std::fabs(bounds.max[1] - bounds.min[1] - 50.0f) < 0.5f &&
                     std::fabs(bounds.max[2] - bounds.min[2] - 20.0f) < 0.5f;
    ck("the default part is still the 80 x 50 x 20 bracket the rim check assumes", box,
       num(bounds.max[0] - bounds.min[0]) + " x " + num(bounds.max[1] - bounds.min[1]) +
           " x " + num(bounds.max[2] - bounds.min[2]));
  }

  // The edge stream as KernelScene extracted it. Mutations 3 and 5 DISPLACE the
  // copy that is uploaded; the bore-rim check still has to know which segments
  // ARE the rim, and it cannot ask a coordinate that was moved on purpose.
  const std::vector<forge::desktop::SceneVertex> pristine = scene.edgeVertices();

  // ── mutations that corrupt what reaches the GPU ──────────────────────────
  // Displace every edge vertex along the view direction by `mm` (positive =
  // away from the eye). The camera here is the one section 3 builds, made twice
  // rather than shared so the mutation cannot silently change the real one.
  auto displaceAlongView = [&](float mm) {
    forge::desktop::Camera probe;
    float centre2[3];
    bounds.centre(centre2);
    probe.setAspect(1.0f);
    probe.setIsometric();
    probe.frame(centre2, bounds.radius());
    float eye[3];
    probe.eye(eye);
    float d[3] = {centre2[0] - eye[0], centre2[1] - eye[1], centre2[2] - eye[2]};
    const float len = std::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    if (len <= 1e-6f) return;
    for (forge::desktop::SceneVertex& v : edges) {
      v.px += d[0] / len * mm;
      v.py += d[1] / len * mm;
      v.pz += d[2] / len * mm;
    }
  };

  if (g_mutation == 1) {
    edges.clear();  // the edges never reach the vertex buffer
  } else if (g_mutation == 2) {
    if (edges.size() > 16) edges.resize(16);  // only 8 segments survive the upload
  } else if (g_mutation == 3) {
    // 1.0 mm AWAY from the eye -- four times what the 3e-6 NDC offset is worth in
    // world units on this part, so the surface wins the depth test again in
    // patches. This is the stitching the offset exists to prevent, as data.
    displaceAlongView(1.0f);
  } else if (g_mutation == 7) {
    // 0.15 mm away from the eye. MUTATION 3's 1.0 mm shoves the edges far enough
    // behind the surface that most of them simply go dark; this one is the
    // STITCHING shape of the defect -- small enough that the edges still mostly
    // win the depth test and come out DASHED rather than hidden. It is the only
    // injected input that turns the two GAP observables red, which is what makes
    // them checks rather than decoration.
    displaceAlongView(0.15f);
  } else if (g_mutation == 5) {
    // 60 mm TOWARD the eye, which clears the part's whole depth extent: every
    // edge now floats in front of the material. This is what the cheap "fix" --
    // switch the depth test off -- would look like, and the hidden-edge check is
    // the only thing in this gate that refuses it.
    displaceAlongView(-60.0f);
  }

  // ── 3. the renderer ───────────────────────────────────────────────────────
  std::printf("\n  [3] ViewportRenderer — the application's own renderer object\n");

  // ★ BEFORE ANY PIXEL: IS THIS BINARY HOLDING THE SHADERS IN THIS TREE?
  //
  // Everything below asserts on pixels drawn by the SPIR-V compiled into
  // libforge_desktop_render.a. That SPIR-V is a build product of a
  // timestamp-driven rule, and a timestamp rule can be defeated -- `touch` the
  // generated .spv.h, restore a shader with an older mtime (cp -p, rsync -t, an
  // unpacked archive), or let a clock run backwards, and glslang is skipped while
  // the binary keeps the PREVIOUS shader. The gate then measures a program the
  // tree no longer contains and cannot tell.
  //
  // That is not hypothetical. MEASURED on this tree, before this check existed:
  // kEdgeDepthBias set to 0.0 in shaders/viewport_solid.vert -- the exact defect
  // this gate was written for, the one whose table says "20 / 10 / 6 broken, RED"
  // -- with the generated header touched so glslang would be skipped. This gate
  // printed "36 checks, 0 failed. RENDER GATE PASS" -- every check it then had,
  // green ON the defect it exists for. That is not a caveat about how to sweep a
  // constant; it is the gate not measuring the shipped shader.
  //
  // So each generated header carries the exact bytes glslang was handed, written
  // by the same build command, and ViewportRenderer.cpp -- the object that turns
  // them into VkShaderModules -- hands them here. This compares them against the
  // files on disk. A stale header is a RED gate.
  {
    struct Stage {
      const char* file;
      std::string_view compiled;
    };
    const Stage stages[2] = {
        {"viewport_solid.vert", forge::desktop::viewportSolidVertCompiledSource()},
        {"viewport_solid.frag", forge::desktop::viewportSolidFragCompiledSource()},
    };
    for (const Stage& st : stages) {
      const std::string path = std::string(FORGE_VIEWPORT_SHADER_DIR) + "/" + st.file;
      std::string onDisk;
      if (!readWholeFile(path, onDisk)) {
        // NOT a skip. A gate that cannot find the source it claims to be testing
        // has no idea what it just rendered with.
        ck((std::string("the shader source ") + st.file + " is readable").c_str(), false,
           path);
        continue;
      }
      const bool same = onDisk.size() == st.compiled.size() &&
                        std::memcmp(onDisk.data(), st.compiled.data(), onDisk.size()) == 0;
      std::printf("         %s: %zu bytes on disk, %zu compiled into this binary\n", st.file,
                  onDisk.size(), st.compiled.size());
      ck((std::string("the SPIR-V in this binary was compiled from shaders/") + st.file)
             .c_str(),
         same,
         same ? "" : firstDifference(onDisk, st.compiled) + " — the generated .spv.h is " +
                         "STALE, so every pixel below was drawn by a shader this tree " +
                         "does not contain. Delete shaders/*.spv.h in your build tree " +
                         "(the default is forge-desktop/build/shaders) and rebuild.");
    }
  }

  constexpr std::uint32_t kW = 900;
  constexpr std::uint32_t kH = 620;
  forge::desktop::ViewportRenderer viewport;
  ck("ViewportRenderer::init succeeds on a real device",
     viewport.init(vk.phys, vk.device, vk.queue, vk.queueFamily, verts), viewport.error());
  ck("the vertex + edge streams upload", viewport.uploadVertices(verts, edges),
     viewport.error());
  ck("the offscreen target resizes to the panel", viewport.resize(kW, kH), viewport.error());
  ck("the offscreen colour attachment is registered as an ImGui texture",
     viewport.texture() != 0);
  // ★ AND THE ONE LINE THIS WHOLE GATE RESTS ON. Every assertion in this file
  // reads the colour attachment back with vkCmdCopyImageToBuffer, which requires
  // the image to have been created with VK_IMAGE_USAGE_TRANSFER_SRC_BIT. Deleting
  // that bit from ViewportRenderer::createTarget -- the edit the commit that added
  // this gate calls "what makes any of this readable" -- left the gate GREEN:
  // MoltenVK performed the copy regardless, so the enabling change was the one
  // thing here that nothing could falsify. It is a usage the SPEC requires and a
  // stricter driver, or a validation layer, is entitled to refuse; on that machine
  // every pixel check would fail at once for a reason none of them names.
  // colorImageUsage() returns the value passed to vkCreateImage, so removing the
  // bit there removes it from what this reads.
  {
    const VkImageUsageFlags usage = viewport.colorImageUsage();
    char hex[32];
    std::snprintf(hex, sizeof(hex), "usage = 0x%x", static_cast<unsigned>(usage));
    ck("the colour attachment is created TRANSFER_SRC, which is what makes the frame "
       "readable at all",
       (usage & VK_IMAGE_USAGE_TRANSFER_SRC_BIT) != 0, hex);
  }

  // ── 4 and 5. TWO GATED CAMERAS, AND A SWEEP OVER SIXTEEN ────────────────
  // The defect is a depth-test race, and its magnitude depends on how steeply
  // the surface falls away in screen space -- which is a property of the CAMERA,
  // not of the part. One view would prove the offset works at one scale.
  //
  // Two cameras are asserted HARD, with the full set of checks: the framed
  // isometric the app opens on, and the same view four wheel notches in, which
  // is what a machinist inspecting a feature is looking at. Section 7 then
  // sweeps SIXTEEN cameras over the same part and asserts a weaker property
  // across all of them, because the two gated views are two views and the
  // renderer has to work from anywhere. What the sweep asserts, and why it is
  // weaker than what these two assert, is argued where it is measured.

  // Everything one frame says about itself. Gathered in ONE place so the gated
  // cameras and the sweep cannot measure the same picture differently.
  struct FrameStats {
    double groundFrac = 0.0;
    double shadedFrac = 0.0;
    std::size_t ink = 0;
    int drawn = 0;
    int hidden = 0;
    int broken = 0;
    int offscreen = 0;
    int tooShort = 0;
    int classified = 0;
    int rimTotal = 0;
    int rimDrawn = 0;
    int rimBroken = 0;
    // The gap observable. `visible` counts segments the frame agrees are in
    // front of the material (coverage >= 0.5); `worstGap` is the longest run of
    // consecutive un-inked pixels INSIDE one of them; `gappy` is how many carry
    // an interior gap wider than a single pixel.
    int visible = 0;
    int worstGap = 0;
    int gappy = 0;
    double brokenFrac() const {
      return classified > 0 ? static_cast<double>(broken) / static_cast<double>(classified)
                            : 1.0;
    }
    double drawnFrac() const {
      return classified > 0 ? static_cast<double>(drawn) / static_cast<double>(classified)
                            : 0.0;
    }
  };

  // The bore is CYL(6, ...) on the Z axis in defaultPartStatements(); its TOP
  // rim is the circle r=6 at the top face, and from a view above, all of it is
  // unobstructed. It is the single feature a shaded-only picture loses most
  // visibly, so it gets its own verdict.
  const float topZ = bounds.max[2];
  constexpr float kBoreRadius = 6.0f;
  auto onTopRim = [&](const forge::desktop::SceneVertex& v) {
    const float r = std::sqrt(v.px * v.px + v.py * v.py);
    return std::fabs(r - kBoreRadius) < 0.5f && std::fabs(v.pz - topZ) < 0.05f;
  };

  auto measureFrame = [&](const forge::desktop::Camera& cam, Image& out, FrameStats& fs,
                          std::string& err) -> bool {
    if (!renderAndReadBack(vk, viewport, cam, out, err)) return false;
    float mvp[16];
    cam.viewProj(mvp);

    std::size_t ground = 0, ink = 0, shaded = 0;
    for (std::uint32_t y = 0; y < out.h; ++y) {
      for (std::uint32_t x = 0; x < out.w; ++x) {
        const std::uint8_t* px = out.at(static_cast<int>(x), static_cast<int>(y));
        if (near3(px, kGround, 2)) {
          ++ground;
        } else if (near3(px, kInk, 3)) {
          ++ink;
        } else {
          ++shaded;
        }
      }
    }
    const double total = static_cast<double>(out.rgba.size() / 4);
    fs.ink = ink;
    fs.groundFrac = static_cast<double>(ground) / total;
    fs.shadedFrac = static_cast<double>(shaded) / total;

    for (std::size_t i = 0; i + 1 < edges.size(); i += 2) {
      const float pa[3] = {edges[i].px, edges[i].py, edges[i].pz};
      const float pb[3] = {edges[i + 1].px, edges[i + 1].py, edges[i + 1].pz};
      const SegStats st = measureSegment(out, mvp, pa, pb);
      if (st.verdict != SegVerdict::Offscreen && st.verdict != SegVerdict::TooShort &&
          st.coverage >= 0.5f) {
        ++fs.visible;
        if (st.maxGap > fs.worstGap) fs.worstGap = st.maxGap;
        if (st.maxGap > 1) ++fs.gappy;
      }
      switch (st.verdict) {
        case SegVerdict::Drawn: ++fs.drawn; break;
        case SegVerdict::Hidden: ++fs.hidden; break;
        case SegVerdict::Broken: ++fs.broken; break;
        case SegVerdict::TooShort: ++fs.tooShort; break;
        case SegVerdict::Offscreen: ++fs.offscreen; break;
      }
      // Rim membership is read off the PRISTINE coordinates: a mutation that
      // moves the geometry must not be allowed to move the rim out of the
      // check's sight and go red for the wrong reason.
      const bool isRim = edges.size() == pristine.size() && onTopRim(pristine[i]) &&
                         onTopRim(pristine[i + 1]);
      if (isRim && st.verdict != SegVerdict::Offscreen &&
          st.verdict != SegVerdict::TooShort) {
        ++fs.rimTotal;
        if (st.verdict == SegVerdict::Drawn) ++fs.rimDrawn;
        if (st.verdict == SegVerdict::Broken) ++fs.rimBroken;
      }
    }
    fs.classified = fs.drawn + fs.hidden + fs.broken;
    return true;
  };

  auto renderFrom = [&](const char* label, const forge::desktop::Camera& cam,
                        double shadedLo, double shadedHi, bool assertRim,
                        Image& out) -> bool {
    FrameStats fs;
    std::string err;
    if (!measureFrame(cam, out, fs, err)) {
      ck((std::string("the viewport renders and the pixels come back — ") + label).c_str(),
         false, err);
      return false;
    }
    std::printf("\n  [4/%s] what is actually in the frame\n", label);
    std::printf("         %.1f%% ground   %.1f%% shaded solid   %.2f%% edge ink\n",
                100.0 * fs.groundFrac, 100.0 * fs.shadedFrac,
                100.0 * static_cast<double>(fs.ink) /
                    static_cast<double>(out.rgba.size() / 4));
    ck((std::string("the solid rasterized into the frame — ") + label).c_str(),
       fs.shadedFrac > shadedLo && fs.shadedFrac < shadedHi,
       num(100.0 * fs.shadedFrac) + "%");
    ck((std::string("the edge overlay reached the frame at all — ") + label).c_str(),
       fs.ink > 0, num(static_cast<double>(fs.ink)) + " ink pixels");

    // ── per segment: DRAWN, HIDDEN or BROKEN ──────────────────────────────
    std::printf("\n  [5/%s] every extracted edge segment, projected and walked\n", label);
    std::printf("         %d drawn   %d hidden   %d BROKEN   (%d sub-pixel, %d off-screen)\n",
                fs.drawn, fs.hidden, fs.broken, fs.tooShort, fs.offscreen);
    std::printf("         bore top rim: %d segments, %d drawn, %d broken\n", fs.rimTotal,
                fs.rimDrawn, fs.rimBroken);
    std::printf("         ink continuity: %d visible segments, worst interior gap %d px, "
                "%d of them gapped by more than 1 px\n",
                fs.visible, fs.worstGap, fs.gappy);

    ck((std::string("segments long enough to judge exist — ") + label).c_str(),
       fs.classified >= 20, num(static_cast<double>(fs.classified)) + " classified");

    // ── OBSERVABLE ONE: how many segments are dashed ───────────────────────
    // A dashed edge is neither drawn nor occluded; it is the edge pass failing to
    // win the depth test against the surface it lies on. MEASURED on the default
    // bracket with kEdgeDepthBias reverted to 0: 6 of 36 judgeable segments
    // (16.67%) framed and 7 of 119 (5.88%) zoomed; 0 of each with the offset.
    //
    // THE THRESHOLD IS 5%, NOT 15%. 15% was one segment of margin and nothing
    // else: 36 classified segments quantise this ratio at 2.78 points apiece, so
    // 16.67% against 15% is 6 broken against a 5.4 that rounds to 5 -- ONE
    // segment either way flips the verdict, and the zoomed camera's 5.88% slid
    // under 15% entirely, leaving that view's dashing check unable to see the
    // defect at all. At 5% the same two measurements are 6 of 36 vs 1.8 and 7 of
    // 119 vs 5.95: BOTH cameras go red on the defect, and the fixed renderer's
    // measured 0 of 36 and 0 of 119 sit a whole segment and six segments below
    // the line respectively. The margin is now on the side of the fix.
    ck((std::string("edges are not dashed (fewer than 5% of segments broken) — ") + label)
           .c_str(),
       fs.brokenFrac() < 0.05, num(100.0 * fs.brokenFrac()) + "% broken");

    // ── OBSERVABLE TWO: how LONG the dashes are ────────────────────────────
    // Independent of the first, and not a ratio: the longest run of consecutive
    // un-inked pixels inside a segment the frame agrees is visible. A continuous
    // edge has no interior gap; a stitched one is chopped into 5-pixel dashes.
    // MEASURED: with the offset, worst interior gap 0 px and 0 gapped segments at
    // BOTH gated cameras. With kEdgeDepthBias at 0: 6 px and 5 gapped segments
    // framed, 2 px and 3 gapped zoomed. The check is that NO visible segment is
    // gapped by more than one pixel, which the defect breaks at both cameras by
    // three segments and by five, not by one.
    ck((std::string("no visible edge is gapped (ink is continuous along it) — ") + label)
           .c_str(),
       fs.gappy == 0 && fs.worstGap <= 1,
       num(static_cast<double>(fs.gappy)) + " gapped, worst " +
           num(static_cast<double>(fs.worstGap)) + " px");

    ck((std::string("a real share of the extracted edges is inked (at least 35% drawn) — ") +
        label)
           .c_str(),
       fs.drawnFrac() >= 0.35, num(100.0 * fs.drawnFrac()) + "% drawn");

    // THE MACHINIST'S CHECK. If the bore rim is not inked, the picture does not
    // say there is a hole.
    if (assertRim) {
      ck((std::string("the bore's top rim is a closed inked circle — ") + label).c_str(),
         fs.rimTotal >= 12 && fs.rimDrawn * 10 >= fs.rimTotal * 9,
         num(fs.rimDrawn) + " of " + num(fs.rimTotal) + " drawn");
    }

    // THE CHECK THAT REFUSES THE LAZY FIX. "Shaded with edges" hides what the
    // material hides. If every extracted edge is inked, the depth test is off
    // and the viewport is a wireframe wearing a shaded coat.
    ck((std::string("occluded edges stay behind the material — ") + label).c_str(),
       fs.hidden >= 5, num(static_cast<double>(fs.hidden)) + " hidden");
    return true;
  };

  forge::desktop::Camera framed;
  framed.setAspect(static_cast<float>(kW) / static_cast<float>(kH));
  framed.setIsometric();
  float centre[3] = {0.0f, 0.0f, 0.0f};
  bounds.centre(centre);
  framed.frame(centre, bounds.radius());
  Image img;
  if (!renderFrom("framed isometric", framed, 0.15, 0.85, true, img)) {
    std::printf("\n  %d checks, %d failed\n", g_checks, g_failures);
    return 1;
  }
  // The same view, four wheel notches in: the part covers 41% of the frame
  // instead of 18%, every segment is longer in pixels, and Camera moves near and
  // far with the distance. If the offset in the shader were tuned to one scale
  // rather than to the camera's own depth range, this is where it comes apart.
  forge::desktop::Camera close = framed;
  close.zoom(4.0f);
  Image closeImg;
  renderFrom("zoomed in x4", close, 0.20, 0.90, true, closeImg);

  // ── 7. THE SAME PART FROM SIXTEEN CAMERAS ────────────────────────────────
  // Two gated views are two views. The defect this gate exists for is a
  // depth-test race whose size is a property of the camera, so a fix proved at
  // two cameras is a fix proved at two cameras -- and the honest finding here is
  // that it is NOT complete everywhere. MEASURED on the default bracket, BROKEN
  // segments per camera, kEdgeDepthBias 0 -> 3e-6, is printed by the table
  // below on every run; the residue lives at the cameras where the part is
  // SMALLEST on screen and a segment is a handful of pixels long, so one pixel
  // of gap is a large fraction of it.
  //
  // WHAT THIS SECTION ASSERTS, and why it is deliberately weaker than what the
  // two gated cameras assert:
  //
  //   * EVERY camera renders and produces ink. A view that comes back blank is
  //     a defect at any threshold, and nothing above would have noticed.
  //   * The SUM of broken segments over all sixteen is bounded. A per-camera
  //     percentage is quantised by that camera's segment count -- at a view
  //     where the part is small, 30 classified segments make one segment worth
  //     3.3 points -- so the aggregate is the stable statistic, and it is the
  //     one that moves when the offset is removed.
  //   * NO camera is allowed to be a wireframe (hidden > 0 wherever the part
  //     occludes itself) or to lose its ink entirely.
  //
  // It does NOT assert 0 broken per camera, because that is not true today and
  // writing it down would be writing down a wish. The bound is set from the
  // measured sweep with margin, and the table prints the per-camera numbers so
  // a regression is readable even while it is inside the bound.
  std::printf("\n  [7] the same part from sixteen cameras\n");
  {
    struct CamSpec {
      const char* name;
      forge::ui::NamedView view;
      float zoomSteps;
      float dAz;
      float dEl;
    };
    // Six named views, the framed isometric, three wheel positions and six
    // orbits away from it. The orbits are not round numbers: a camera that lands
    // exactly on an axis sees the part edge-on and is the easy case.
    const CamSpec kCams[] = {
        {"front", forge::ui::NamedView::Front, 0.0f, 0.0f, 0.0f},
        {"back", forge::ui::NamedView::Back, 0.0f, 0.0f, 0.0f},
        {"left", forge::ui::NamedView::Left, 0.0f, 0.0f, 0.0f},
        {"right", forge::ui::NamedView::Right, 0.0f, 0.0f, 0.0f},
        {"top", forge::ui::NamedView::Top, 0.0f, 0.0f, 0.0f},
        {"bottom", forge::ui::NamedView::Bottom, 0.0f, 0.0f, 0.0f},
        {"iso", forge::ui::NamedView::Isometric, 0.0f, 0.0f, 0.0f},
        {"iso wheel+2", forge::ui::NamedView::Isometric, 2.0f, 0.0f, 0.0f},
        {"iso wheel+4", forge::ui::NamedView::Isometric, 4.0f, 0.0f, 0.0f},
        {"iso wheel-2", forge::ui::NamedView::Isometric, -2.0f, 0.0f, 0.0f},
        {"iso orbit A", forge::ui::NamedView::Isometric, 0.0f, 0.7f, 0.4f},
        {"iso orbit B", forge::ui::NamedView::Isometric, 0.0f, -0.7f, 0.4f},
        {"iso orbit C", forge::ui::NamedView::Isometric, 0.0f, 0.7f, -1.1f},
        {"iso orbit D", forge::ui::NamedView::Isometric, 0.0f, -0.7f, -0.4f},
        {"iso orbit E", forge::ui::NamedView::Isometric, 0.0f, 1.6f, 0.2f},
        {"iso orbit F", forge::ui::NamedView::Isometric, 0.0f, 2.4f, -0.2f},
    };
    constexpr int kCamCount = static_cast<int>(sizeof(kCams) / sizeof(kCams[0]));

    int rendered = 0, totalBroken = 0, totalClassified = 0;
    int worstCameraBroken = 0, blankCameras = 0, wireframeCameras = 0;
    int totalGappy = 0, worstGapAnywhere = 0;
    const char* worstCameraName = "-";
    std::printf("         %-12s  %6s %6s %6s   %5s  %s\n", "camera", "drawn", "hid",
                "BROKEN", "gap", "ink px");
    for (int i = 0; i < kCamCount; ++i) {
      forge::desktop::Camera cam;
      cam.setAspect(static_cast<float>(kW) / static_cast<float>(kH));
      cam.setNamedView(kCams[i].view);
      cam.frame(centre, bounds.radius());
      if (kCams[i].dAz != 0.0f || kCams[i].dEl != 0.0f) {
        cam.orbit(kCams[i].dAz, kCams[i].dEl);
      }
      if (kCams[i].zoomSteps != 0.0f) cam.zoom(kCams[i].zoomSteps);
      Image frame;
      FrameStats fs;
      std::string err;
      if (!measureFrame(cam, frame, fs, err)) {
        std::printf("         %-12s  RENDER FAILED: %s\n", kCams[i].name, err.c_str());
        continue;
      }
      ++rendered;
      if (fs.ink == 0) ++blankCameras;
      // A camera whose part occludes nothing of itself has no hidden edges to
      // lose, so "hidden == 0" is only a wireframe verdict where the frame
      // actually classified a healthy number of segments.
      if (fs.classified >= 20 && fs.hidden == 0) ++wireframeCameras;
      totalBroken += fs.broken;
      totalClassified += fs.classified;
      totalGappy += fs.gappy;
      if (fs.worstGap > worstGapAnywhere) worstGapAnywhere = fs.worstGap;
      if (fs.broken > worstCameraBroken) {
        worstCameraBroken = fs.broken;
        worstCameraName = kCams[i].name;
      }
      std::printf("         %-12s  %6d %6d %6d   %5d  %zu\n", kCams[i].name, fs.drawn,
                  fs.hidden, fs.broken, fs.worstGap, fs.ink);
    }
    std::printf("         ---- %d cameras: %d broken of %d classified (%.2f%%), "
                "%d gapped segments, worst gap %d px; worst camera %s at %d\n",
                rendered, totalBroken, totalClassified,
                totalClassified > 0
                    ? 100.0 * static_cast<double>(totalBroken) /
                          static_cast<double>(totalClassified)
                    : 0.0,
                totalGappy, worstGapAnywhere, worstCameraName, worstCameraBroken);

    // NOTE what is NOT a separate check here: "all sixteen cameras rendered".
    // No injected input in this gate can make a render FAIL, so a standalone ck
    // for it would be a check nothing can turn red -- and this suite's own rule
    // is that an unfalsifiable check is not a check. It is folded into the two
    // aggregates below instead, where it does real work: a camera that failed to
    // render would shrink the denominator and let a percentage pass on fewer
    // cameras than the check's own name claims.
    ck("every camera puts ink in the frame", blankCameras == 0,
       num(static_cast<double>(blankCameras)) + " blank");
    ck("no camera turns the viewport into a wireframe", wireframeCameras == 0,
       num(static_cast<double>(wireframeCameras)) + " with nothing occluded");

    // ── THE AGGREGATE, which is the statistic that is actually stable ──────
    // MEASURED over these sixteen cameras on the default bracket:
    //     kEdgeDepthBias 0     83 broken of 743 classified = 11.17%, 38 gapped
    //     kEdgeDepthBias 3e-6  13 broken of 743 classified =  1.75%,  4 gapped
    // A factor of 6.4 on the first and 9.5 on the second, with 743 segments
    // behind each number rather than 36 -- so no single segment moves either
    // verdict, which is the failure mode that made a 15% per-camera threshold
    // on 36 segments worth so little.
    //
    // 5% of 743 is 37: the fix sits 24 segments below the line and the defect 46
    // above it. That is the margin the two gated cameras cannot have on their
    // own, and it is why this check is here rather than a sixteenth repetition
    // of the per-camera one.
    ck("across sixteen cameras, under 5% of all segments are dashed",
       rendered == kCamCount && totalClassified > 0 &&
           static_cast<double>(totalBroken) / static_cast<double>(totalClassified) < 0.05,
       num(static_cast<double>(totalBroken)) + " of " +
           num(static_cast<double>(totalClassified)) + " over " +
           num(static_cast<double>(rendered)) + " cameras");
    // The gap observable, aggregated the same way. The bound is 12 and not 0 on
    // purpose: four segments in this sweep carry a real interior gap WITH the
    // fix in place, and all four are long silhouette edges that genuinely pass
    // BEHIND the part in their middle -- the 29 px gap at "iso orbit D" is the
    // material, correctly drawn over the edge. A zero here would be a wish. 12
    // is three times the measured four and three times below the defect's 38.
    ck("across sixteen cameras, at most 12 segments carry an interior gap",
       rendered == kCamCount && totalGappy <= 12,
       num(static_cast<double>(totalGappy)) + " gapped over " +
           num(static_cast<double>(rendered)) + " cameras");
  }

  // ── 6. hiding a body must take ITS EDGES with it ─────────────────────────
  // extractFeatureEdges() used to be called from installGeometry() and NOWHERE
  // ELSE, and it walked the master vertex stream rather than the drawn one. So
  // switching a body off removed its triangles from the viewport and left its
  // feature edges inked: a wireframe ghost of a body the user had just hidden.
  // Four separate cubes, because a pattern whose copies do not meet does not
  // fuse into one body.
  std::printf("\n  [6] hiding a body takes its edges out of the stream\n");
  {
    forge::desktop::KernelScene multi;
    const bool ok = multi.buildFromIr(
        "%1 = BOX(10, 10, 10, 0, 0, 0)\n"
        "%2 = PATTERN(%1, LINEAR, 4, 30, 0, 0)\n");
    ck("a 4-up pattern builds", ok, multi.error());
    ck("it is four separate bodies", multi.bodyCount() == 4,
       num(static_cast<double>(multi.bodyCount())) + " bodies");
    const std::size_t edgesAll = multi.edgeVertices().size() / 2;
    const std::size_t trisAll = multi.triangleCount();
    // MUTATION 6 hides nothing: the counts below then cannot move, which is what
    // the checks have to notice. It is the positive control for this section --
    // a check that passes whether or not the hide happened is not a check.
    if (g_mutation != 6) multi.setBodyVisible(3, false);
    const std::size_t edgesHidden = multi.edgeVertices().size() / 2;
    const std::size_t trisHidden = multi.triangleCount();
    std::printf("         all four: %zu triangles, %zu edge segments\n", trisAll, edgesAll);
    std::printf("         one hidden: %zu triangles, %zu edge segments\n", trisHidden,
                edgesHidden);
    ck("hiding a body removes its triangles", trisHidden < trisAll,
       num(static_cast<double>(trisHidden)) + " of " + num(static_cast<double>(trisAll)));
    ck("hiding a body removes ITS EDGES too", edgesHidden < edgesAll,
       num(static_cast<double>(edgesHidden)) + " of " + num(static_cast<double>(edgesAll)));
    // Four identical cubes: a quarter of the edges goes with a quarter of the
    // triangles. An inequality alone would pass on one segment.
    ck("exactly a quarter of the edges goes, matching the triangles",
       edgesAll > 0 && edgesHidden == edgesAll - edgesAll / 4,
       num(static_cast<double>(edgesHidden)) + ", expected " +
           num(static_cast<double>(edgesAll - edgesAll / 4)));
    multi.showAllBodies();
    ck("showing them again brings the edges back", multi.edgeVertices().size() / 2 == edgesAll,
       num(static_cast<double>(multi.edgeVertices().size() / 2)) + " of " +
           num(static_cast<double>(edgesAll)));
  }

  if (pngPath.empty()) {
    const char* tmp = std::getenv("TMPDIR");
    pngPath = std::string(tmp != nullptr ? tmp : "/tmp") + "/forge_render_gate.png";
  }
  if (forge::desktop::png::writeRgba(pngPath, img.rgba.data(), img.w, img.h)) {
    std::printf("\n         evidence: %s\n", pngPath.c_str());
  }

  viewport.destroy();
  ImGui_ImplVulkan_Shutdown();
  ImGui::DestroyContext();
  vkDestroyRenderPass(vk.device, vk.imguiPass, nullptr);
  vkDestroyCommandPool(vk.device, vk.pool, nullptr);
  vkDestroyDevice(vk.device, nullptr);
  vkDestroyInstance(vk.instance, nullptr);

  std::printf("\n  %d checks, %d failed\n", g_checks, g_failures);
  if (g_failures == 0) std::printf("  RENDER GATE PASS\n");
  return g_failures == 0 ? 0 : 1;
}
