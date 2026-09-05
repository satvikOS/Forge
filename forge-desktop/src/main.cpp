// forge-desktop/src/main.cpp — THE FORGE DESKTOP APPLICATION.
//
// A real window, a real Vulkan device, a real swapchain, a real frame loop, and
// the forge::ui service layer driving all of it.
//
// ── D-006, settled here: MoltenVK, not Diligent ─────────────────────────────
// The decision record left the render backend open, leaning Diligent/Metal
// because "Vulkan on M4 Max is Metal with a layer in front". That is true, and it
// is not the deciding fact. What decides it is what is already PROVEN on this
// machine and what an extra abstraction would cost:
//
//   1. The Vulkan path is measured working here. forge-desktop/renderer_probe.cpp
//      creates a MoltenVK device, renders a tessellated kernel mesh offscreen and
//      reads the pixels back; ui_probe.cpp stands Dear ImGui's Vulkan backend up
//      against that same device. Neither has a Metal counterpart.
//   2. Dear ImGui's renderer backend for Vulkan is VENDORED and version-matched
//      (imgui_impl_vulkan.cpp, 1.92.9-WIP). Its Metal backend is not vendored,
//      is Objective-C++, and would make every UI translation unit .mm.
//   3. Diligent is a THIRD abstraction (Diligent -> Metal) on top of a UI that
//      already has its own renderer backends. Sacrosanct s19.2 asks for ONE
//      authoritative interactive renderer; adding an engine to reach Metal, when
//      the UI framework already speaks Vulkan and Vulkan already reaches Metal,
//      is one renderer more than the requirement, not fewer.
//   4. MoltenVK is Khronos-hosted and Apache-2.0, and is buildable from source —
//      Sacrosanct Law 16's requirement on the dependency stack. Diligent is
//      Apache-2.0 too, so licensing does not separate them; provenance and
//      already-working code do.
//
// The cost is honest and recorded: one translation layer of latency, and Metal
// features MoltenVK does not expose (VK_POLYGON_MODE_LINE among them — see
// ViewportRenderer::createPipeline, which degrades rather than pretending).
//
// ── swapchain ───────────────────────────────────────────────────────────────
// The swapchain, its render pass, per-frame command buffers, fences and
// semaphores come from Dear ImGui's OWN reference helpers,
// ImGui_ImplVulkanH_Window / ImGui_ImplVulkanH_CreateOrResizeWindow, driven
// exactly as upstream's `examples/example_sdl2_vulkan/main.cpp` drives them.
// That is the reference implementation for this backend; SR-3 says follow and
// name it rather than write a fifth hand-rolled swapchain.
//
// Build:  cmake -S forge-desktop -B forge-desktop/build -DCMAKE_BUILD_TYPE=Release
//         cmake --build forge-desktop/build -j8 --target forge_desktop
// Run:    ./forge-desktop/build/forge_desktop

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include <SDL.h>
#include <SDL_vulkan.h>
#include <vulkan/vulkan.h>

#include "imgui.h"
#include "imgui_impl_vulkan.h"

#include "FileDialog.hpp"
#include "FileExchangeHost.hpp"
#include "ForgeFrame.hpp"
#include "ImGuiErrorPolicy.hpp"
#include "KernelScene.hpp"
#include "PlatformSDL2.hpp"
#include "UpdateService.hpp"
#include "PngWriter.hpp"
#include "ViewportRenderer.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/UserFacingText.hpp"
#include "forge/ui/WorkspaceProfile.hpp"

namespace forge::desktop {

// ── WHEN THE APPLICATION CANNOT START ───────────────────────────────────────
//
// Every startup failure in this file used to end in `return 1;` after an
// fprintf. On a developer's terminal that is fine. On a user's Mac, a
// double-clicked Forge.app that returns 1 does not open, shows nothing, and
// leaves the only explanation in a console they have no reason to have open --
// so the application is indistinguishable from one that is broken beyond
// reporting. A dialog is the whole difference between "it does not work" and
// "it cannot use your graphics card".
//
// The SENTENCE comes from forge::ui::userFacingStartupFailure(), which is
// headlessly gated: the technical cause chooses which sentence is shown and is
// never quoted inside one. The cause still goes to stderr, immediately above
// every call to this.
void sayStartupFailed(const char* stage, const char* detail) {
  const std::string message =
      forge::ui::userFacingStartupFailure(stage != nullptr ? stage : "",
                                          detail != nullptr ? detail : "");
  // SDL_ShowSimpleMessageBox works before SDL_Init and needs no window, which is
  // exactly the situation every caller is in.
  SDL_ShowSimpleMessageBox(SDL_MESSAGEBOX_ERROR, "Forge cannot start", message.c_str(), nullptr);
}

}  // namespace forge::desktop

namespace {

VkInstance g_instance = VK_NULL_HANDLE;
VkPhysicalDevice g_phys = VK_NULL_HANDLE;
VkDevice g_device = VK_NULL_HANDLE;
VkQueue g_queue = VK_NULL_HANDLE;
std::uint32_t g_queueFamily = 0;
ImGui_ImplVulkanH_Window g_window;
bool g_swapchainRebuild = false;

#define VKCHECK(call)                                                        \
  do {                                                                       \
    const VkResult _r = (call);                                              \
    if (_r != VK_SUCCESS) {                                                  \
      std::fprintf(stderr, "[forge] FAIL %s -> VkResult %d (line %d)\n",     \
                   #call, static_cast<int>(_r), __LINE__);                   \
      return false;                                                          \
    }                                                                        \
  } while (0)

bool hasInstanceExtension(const char* name) {
  std::uint32_t n = 0;
  vkEnumerateInstanceExtensionProperties(nullptr, &n, nullptr);
  std::vector<VkExtensionProperties> exts(n);
  vkEnumerateInstanceExtensionProperties(nullptr, &n, exts.data());
  for (const VkExtensionProperties& e : exts) {
    if (std::strcmp(e.extensionName, name) == 0) return true;
  }
  return false;
}

bool createVulkan(SDL_Window* window) {
  // ── instance: SDL's required surface extensions + portability enumeration ──
  unsigned int extCount = 0;
  if (!SDL_Vulkan_GetInstanceExtensions(window, &extCount, nullptr)) {
    std::fprintf(stderr, "[forge] SDL_Vulkan_GetInstanceExtensions: %s\n", SDL_GetError());
    return false;
  }
  std::vector<const char*> exts(extCount);
  SDL_Vulkan_GetInstanceExtensions(window, &extCount, exts.data());

  const bool portability = hasInstanceExtension(VK_KHR_PORTABILITY_ENUMERATION_EXTENSION_NAME);
  if (portability) exts.push_back(VK_KHR_PORTABILITY_ENUMERATION_EXTENSION_NAME);

  VkApplicationInfo app{};
  app.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
  app.pApplicationName = "Forge";
  app.apiVersion = VK_API_VERSION_1_2;
  VkInstanceCreateInfo ici{};
  ici.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
  ici.pApplicationInfo = &app;
  if (portability) ici.flags = VK_INSTANCE_CREATE_ENUMERATE_PORTABILITY_BIT_KHR;
  ici.enabledExtensionCount = static_cast<std::uint32_t>(exts.size());
  ici.ppEnabledExtensionNames = exts.data();
  VKCHECK(vkCreateInstance(&ici, nullptr, &g_instance));

  // ── physical device / queue family: ImGui's own selection helpers ─────────
  g_phys = ImGui_ImplVulkanH_SelectPhysicalDevice(g_instance);
  if (g_phys == VK_NULL_HANDLE) {
    std::fprintf(stderr,
                 "[forge] no VkPhysicalDevice. Is the MoltenVK ICD visible? "
                 "Set VK_ICD_FILENAMES to $(brew --prefix molten-vk)"
                 "/etc/vulkan/icd.d/MoltenVK_icd.json\n");
    return false;
  }
  g_queueFamily = ImGui_ImplVulkanH_SelectQueueFamilyIndex(g_phys);

  VkPhysicalDeviceProperties props{};
  vkGetPhysicalDeviceProperties(g_phys, &props);
  std::printf("[forge] GPU: %s (Vulkan %u.%u via MoltenVK)\n", props.deviceName,
              VK_API_VERSION_MAJOR(props.apiVersion), VK_API_VERSION_MINOR(props.apiVersion));

  // ── device: swapchain + portability_subset when the driver advertises it ──
  std::uint32_t devExtCount = 0;
  vkEnumerateDeviceExtensionProperties(g_phys, nullptr, &devExtCount, nullptr);
  std::vector<VkExtensionProperties> devExts(devExtCount);
  vkEnumerateDeviceExtensionProperties(g_phys, nullptr, &devExtCount, devExts.data());
  std::vector<const char*> enableDev{VK_KHR_SWAPCHAIN_EXTENSION_NAME};
  for (const VkExtensionProperties& e : devExts) {
    if (std::strcmp(e.extensionName, "VK_KHR_portability_subset") == 0) {
      enableDev.push_back("VK_KHR_portability_subset");
    }
  }

  const float prio = 1.0f;
  VkDeviceQueueCreateInfo qci{};
  qci.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
  qci.queueFamilyIndex = g_queueFamily;
  qci.queueCount = 1;
  qci.pQueuePriorities = &prio;
  VkDeviceCreateInfo dci{};
  dci.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
  dci.queueCreateInfoCount = 1;
  dci.pQueueCreateInfos = &qci;
  dci.enabledExtensionCount = static_cast<std::uint32_t>(enableDev.size());
  dci.ppEnabledExtensionNames = enableDev.data();
  VKCHECK(vkCreateDevice(g_phys, &dci, nullptr, &g_device));
  vkGetDeviceQueue(g_device, g_queueFamily, 0, &g_queue);
  return true;
}

bool setupSwapchain(SDL_Window* window, int width, int height) {
  if (SDL_Vulkan_CreateSurface(window, g_instance, &g_window.Surface) != SDL_TRUE) {
    std::fprintf(stderr, "[forge] SDL_Vulkan_CreateSurface: %s\n", SDL_GetError());
    return false;
  }
  VkBool32 supported = VK_FALSE;
  vkGetPhysicalDeviceSurfaceSupportKHR(g_phys, g_queueFamily, g_window.Surface, &supported);
  if (supported != VK_TRUE) {
    std::fprintf(stderr, "[forge] queue family %u cannot present to the surface\n",
                 g_queueFamily);
    return false;
  }

  const VkFormat wanted[] = {VK_FORMAT_B8G8R8A8_UNORM, VK_FORMAT_R8G8B8A8_UNORM,
                             VK_FORMAT_B8G8R8A8_SRGB, VK_FORMAT_R8G8B8A8_SRGB};
  g_window.SurfaceFormat = ImGui_ImplVulkanH_SelectSurfaceFormat(
      g_phys, g_window.Surface, wanted, static_cast<int>(IM_ARRAYSIZE(wanted)),
      VK_COLOR_SPACE_SRGB_NONLINEAR_KHR);
  // FIFO is the only mode guaranteed present, and on a CAD workstation a torn
  // frame is worse than a late one.
  const VkPresentModeKHR modes[] = {VK_PRESENT_MODE_FIFO_KHR};
  g_window.PresentMode = ImGui_ImplVulkanH_SelectPresentMode(
      g_phys, g_window.Surface, modes, static_cast<int>(IM_ARRAYSIZE(modes)));
  g_window.ClearValue.color = {{0.055f, 0.063f, 0.075f, 1.0f}};

  // TRANSFER_SRC on the backbuffers: without it the swapchain image cannot be
  // copied, and --screenshot could only ever photograph an offscreen surrogate.
  ImGui_ImplVulkanH_CreateOrResizeWindow(g_instance, g_phys, g_device, &g_window,
                                         g_queueFamily, nullptr, width, height, 2,
                                         VK_IMAGE_USAGE_TRANSFER_SRC_BIT);
  return true;
}

// Copy a PRESENTED swapchain image back to the host and write it as a PNG. This
// is the app photographing its own window: the source is g_window.Frames[i]
// .Backbuffer, the very image the compositor just showed.
bool captureSwapchain(std::uint32_t imageIndex, const std::string& path) {
  const std::uint32_t w = static_cast<std::uint32_t>(g_window.Width);
  const std::uint32_t h = static_cast<std::uint32_t>(g_window.Height);
  const VkDeviceSize bytes = static_cast<VkDeviceSize>(w) * h * 4;
  VkImage src = g_window.Frames[imageIndex].Backbuffer;

  VkBufferCreateInfo bi{};
  bi.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
  bi.size = bytes;
  bi.usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT;
  VkBuffer dst = VK_NULL_HANDLE;
  VKCHECK(vkCreateBuffer(g_device, &bi, nullptr, &dst));
  VkMemoryRequirements mr{};
  vkGetBufferMemoryRequirements(g_device, dst, &mr);
  VkPhysicalDeviceMemoryProperties mp{};
  vkGetPhysicalDeviceMemoryProperties(g_phys, &mp);
  std::uint32_t typeIndex = UINT32_MAX;
  for (std::uint32_t i = 0; i < mp.memoryTypeCount; ++i) {
    const VkMemoryPropertyFlags want =
        VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT;
    if ((mr.memoryTypeBits & (1u << i)) && (mp.memoryTypes[i].propertyFlags & want) == want) {
      typeIndex = i;
      break;
    }
  }
  if (typeIndex == UINT32_MAX) {
    std::fprintf(stderr, "[forge] no host-visible memory for the screenshot buffer\n");
    vkDestroyBuffer(g_device, dst, nullptr);
    return false;
  }
  VkMemoryAllocateInfo ai{};
  ai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
  ai.allocationSize = mr.size;
  ai.memoryTypeIndex = typeIndex;
  VkDeviceMemory mem = VK_NULL_HANDLE;
  VKCHECK(vkAllocateMemory(g_device, &ai, nullptr, &mem));
  vkBindBufferMemory(g_device, dst, mem, 0);

  VkCommandPoolCreateInfo pci{};
  pci.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
  pci.queueFamilyIndex = g_queueFamily;
  VkCommandPool pool = VK_NULL_HANDLE;
  VKCHECK(vkCreateCommandPool(g_device, &pci, nullptr, &pool));
  VkCommandBufferAllocateInfo cbai{};
  cbai.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
  cbai.commandPool = pool;
  cbai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
  cbai.commandBufferCount = 1;
  VkCommandBuffer cmd = VK_NULL_HANDLE;
  VKCHECK(vkAllocateCommandBuffers(g_device, &cbai, &cmd));
  VkCommandBufferBeginInfo cbi{};
  cbi.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
  cbi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
  vkBeginCommandBuffer(cmd, &cbi);

  VkImageMemoryBarrier toSrc{};
  toSrc.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
  toSrc.oldLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
  toSrc.newLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
  toSrc.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
  toSrc.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
  toSrc.image = src;
  toSrc.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
  toSrc.srcAccessMask = VK_ACCESS_MEMORY_READ_BIT;
  toSrc.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0,
                       0, nullptr, 0, nullptr, 1, &toSrc);

  VkBufferImageCopy copy{};
  copy.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
  copy.imageExtent = {w, h, 1};
  vkCmdCopyImageToBuffer(cmd, src, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, dst, 1, &copy);

  VkImageMemoryBarrier back = toSrc;
  back.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
  back.newLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
  back.srcAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
  back.dstAccessMask = VK_ACCESS_MEMORY_READ_BIT;
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0,
                       0, nullptr, 0, nullptr, 1, &back);
  vkEndCommandBuffer(cmd);

  VkSubmitInfo submit{};
  submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
  submit.commandBufferCount = 1;
  submit.pCommandBuffers = &cmd;
  vkQueueSubmit(g_queue, 1, &submit, VK_NULL_HANDLE);
  vkQueueWaitIdle(g_queue);

  void* mapped = nullptr;
  VKCHECK(vkMapMemory(g_device, mem, 0, VK_WHOLE_SIZE, 0, &mapped));
  std::vector<std::uint8_t> rgba(static_cast<std::size_t>(bytes));
  std::memcpy(rgba.data(), mapped, rgba.size());
  vkUnmapMemory(g_device, mem);

  // The swapchain is BGRA on this driver (format 44 == VK_FORMAT_B8G8R8A8_UNORM);
  // PNG is RGBA. Swapping is not cosmetic -- without it the evidence image is
  // colour-reversed and no longer shows what the user saw.
  if (g_window.SurfaceFormat.format == VK_FORMAT_B8G8R8A8_UNORM ||
      g_window.SurfaceFormat.format == VK_FORMAT_B8G8R8A8_SRGB) {
    for (std::size_t i = 0; i + 3 < rgba.size(); i += 4) std::swap(rgba[i], rgba[i + 2]);
  }
  const bool ok = forge::desktop::png::writeRgba(path, rgba.data(), w, h);

  vkDestroyCommandPool(g_device, pool, nullptr);
  vkDestroyBuffer(g_device, dst, nullptr);
  vkFreeMemory(g_device, mem, nullptr);
  return ok;
}

std::string stateFilePath() {
  const char* home = std::getenv("HOME");
  std::string dir = home != nullptr ? std::string(home) + "/.forge" : std::string(".forge");
  // Best effort: if the directory cannot be made, the load simply fails and the
  // app starts on the deterministic default layout, which is the correct
  // degradation for a preferences file.
  std::string cmd = "mkdir -p '" + dir + "' 2>/dev/null";
  if (std::system(cmd.c_str()) != 0) { /* fall through to the write attempt */ }
  return dir + "/shell_state.txt";
}

}  // namespace

int main(int argc, char** argv) {
  bool headless = false;
  int frameLimit = 0;
  std::string screenshot;
  std::string startWorkspace;
  std::string openPath;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--frames") == 0 && i + 1 < argc) frameLimit = std::atoi(argv[++i]);
    if (std::strcmp(argv[i], "--screenshot") == 0 && i + 1 < argc) screenshot = argv[++i];
    if (std::strcmp(argv[i], "--workspace") == 0 && i + 1 < argc) startWorkspace = argv[++i];
    if (std::strcmp(argv[i], "--open") == 0 && i + 1 < argc) openPath = argv[++i];
    if (std::strcmp(argv[i], "--headless") == 0) headless = true;
    // A bare trailing path opens a document, which is what double-clicking a
    // .fpart in a file manager hands the binary.
    if (argv[i][0] != '-' && openPath.empty() && i > 0 &&
        std::strcmp(argv[i - 1], "--frames") != 0 &&
        std::strcmp(argv[i - 1], "--screenshot") != 0 &&
        std::strcmp(argv[i - 1], "--workspace") != 0 &&
        std::strcmp(argv[i - 1], "--open") != 0) {
      openPath = argv[i];
    }
  }
  if (headless) {
    std::printf("[forge] --headless is the frame gate's job; run forge_desktop_frame_gate\n");
    return 0;
  }

  // ── ★ crash isolation, before the first build ────────────────────────────
  // The kernel runs in forge_kernel_worker, which lives BESIDE this binary. If
  // OCCT dereferences a null Geom2d_Curve mid-build -- measured on three paths,
  // on the model's output AND on the gold reference parts -- that process dies
  // and this one keeps the document, the undo stack and the last good body.
  //
  // ★ A MISSING OR BROKEN WORKER IS NOT FATAL, and must never be. An application
  // shipped without its worker is still an application; refusing to model
  // because the safety net is absent would be a capability gate wearing a safety
  // hat, and it would fire hardest on exactly the long, curved, dense trees this
  // system exists to produce. The probe runs ONCE, here, so the fact is known at
  // startup and printed -- rather than discovered on the first rebuild, which is
  // too late to tell anyone.
  forge::desktop::KernelScene scene;
  {
    const std::string self = argv[0] != nullptr ? std::string(argv[0]) : std::string();
    const std::size_t slash = self.find_last_of('/');
    const std::string dir = slash == std::string::npos ? std::string(".") : self.substr(0, slash);
    const std::string worker = dir + "/forge_kernel_worker";

    forge::ui::GuardLimits limits;
    // Non-zero, always: an operation with no deadline is indistinguishable from
    // a hang. 300 s because 6 of 600 corpus parts exceed 300 s in the verifier,
    // and a part that is merely SLOW must not be reported as a failure.
    limits.deadlineMs = 300000;
    scene.useIsolatedWorker({worker}, limits);

    std::string probeError;
    if (scene.probeWorker(probeError)) {
      std::printf("[forge] kernel isolation: ACTIVE (%s)\n", worker.c_str());
    } else {
      // Turn it back off rather than leaving every later build to rediscover the
      // same launch failure and fall back one at a time.
      scene.useIsolatedWorker({}, limits);
      std::fprintf(stderr,
                   "[forge] kernel isolation: UNAVAILABLE (%s) -- modelling runs IN PROCESS, "
                   "so an OCCT fault will take the app down. The app still starts.\n",
                   probeError.c_str());
    }
  }
  if (!scene.build()) {
    std::fprintf(stderr, "[forge] kernel scene: %s (the app still starts)\n",
                 scene.error().c_str());
  } else {
    const forge::desktop::IrBuildReport& r = scene.lastBuild();
    std::printf("[forge] kernel body: %zu triangles, %u faces  [%s]\n", scene.triangleCount(),
                scene.faceCount(), scene.backend().c_str());
    std::printf("[forge] document: ops declared/parsed/compiled %zu/%zu/%zu, "
                "V=%.3f mm3, valid=%s\n",
                r.nDeclared, r.nParsed, r.nCompiled, r.volume, r.valid ? "yes" : "no");
  }

  if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_TIMER) != 0) {
    std::fprintf(stderr, "[forge] SDL_Init: %s\n", SDL_GetError());
    // A double-clicked .app that returns 1 to nobody simply does not open, and
    // the only explanation lands on a console the user never sees. Say it where
    // they are. The technical cause stays on stderr.
    forge::desktop::sayStartupFailed("video", SDL_GetError());
    return 1;
  }
  SDL_Window* window = SDL_CreateWindow(
      "Forge — CAD Workstation", SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, 1680, 1000,
      SDL_WINDOW_VULKAN | SDL_WINDOW_RESIZABLE | SDL_WINDOW_ALLOW_HIGHDPI);
  if (window == nullptr) {
    std::fprintf(stderr, "[forge] SDL_CreateWindow: %s\n", SDL_GetError());
    forge::desktop::sayStartupFailed("window", SDL_GetError());
    SDL_Quit();
    return 1;
  }

  if (!createVulkan(window)) {
    forge::desktop::sayStartupFailed("graphics device", "");
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 2;
  }
  int fbw = 0, fbh = 0;
  SDL_Vulkan_GetDrawableSize(window, &fbw, &fbh);
  if (!setupSwapchain(window, fbw, fbh)) {
    forge::desktop::sayStartupFailed("swapchain", "");
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 2;
  }
  std::printf("[forge] swapchain %dx%d, %u images, format %d\n", g_window.Width, g_window.Height,
              g_window.ImageCount, static_cast<int>(g_window.SurfaceFormat.format));

  // ── ImGui ────────────────────────────────────────────────────────────────
  IMGUI_CHECKVERSION();
  ImGui::CreateContext();
  ImGuiIO& io = ImGui::GetIO();
  io.IniFilename = nullptr;  // the DOCK LAYOUT is ours; imgui.ini would fight it

  // ── A RECOVERABLE INTERFACE ERROR MUST NOT COST THE USER THEIR MODEL ────
  //
  // The settings, what they are measured to do when left alone, and why each one
  // is set the way it is, are all in ImGuiErrorPolicy.hpp -- ONE place, linked
  // into forge_desktop_imgui_recovery_gate, which fails when the context is left
  // at the library's defaults.
  //
  // This file used to hold those six assignments inline. CI COMPILES this file
  // (kernel-tests.yml's `desktop` job builds forge_desktop), and compiling is not
  // asserting: no gate can LINK main.cpp, because it defines main(), so nothing
  // could ever execute or check what those six lines did. Deleting them would
  // have built clean and left every check in the repository green, with a user's
  // unsaved model one recoverable error away from the floor.
  //
  // Do not put them back here: the gate READS THIS FILE and goes red if any of
  // those settings is assigned anywhere in it.
  forge::desktop::applyImGuiErrorPolicy(
      std::getenv("FORGE_IMGUI_DEV_DIAGNOSTICS") != nullptr
          ? forge::desktop::ImGuiErrorPolicy::DeveloperDiagnostics
          : forge::desktop::ImGuiErrorPolicy::Shipping);

  // NavEnableKeyboard is deliberately OFF. ImGui's keyboard nav consumes the
  // arrows, Space and Enter to move a focus cursor between widgets; in a CAD
  // shell those keys belong to the keymap and to the modal command that is
  // running, and a widget silently activating on Space is a wrong-feature bug.

  forge::desktop::PlatformSDL2 platform;
  platform.init(window);
  int winW = 0, winH = 0;
  SDL_GetWindowSize(window, &winW, &winH);
  const float dpi = winW > 0 ? static_cast<float>(fbw) / static_cast<float>(winW) : 1.0f;
  forge::desktop::applyForgeStyle(dpi);
  io.FontGlobalScale = 1.0f;
  ImFontConfig fc;
  fc.SizePixels = 15.0f * dpi;
  io.Fonts->AddFontDefault(&fc);

  ImGui_ImplVulkan_InitInfo init{};
  init.ApiVersion = VK_API_VERSION_1_2;
  init.Instance = g_instance;
  init.PhysicalDevice = g_phys;
  init.Device = g_device;
  init.QueueFamily = g_queueFamily;
  init.Queue = g_queue;
  init.DescriptorPool = VK_NULL_HANDLE;
  init.DescriptorPoolSize = 32;  // font atlas + the viewport texture, re-added on resize
  init.MinImageCount = 2;
  init.ImageCount = g_window.ImageCount;
  init.PipelineInfoMain.RenderPass = g_window.RenderPass;
  init.PipelineInfoMain.Subpass = 0;
  init.PipelineInfoMain.MSAASamples = VK_SAMPLE_COUNT_1_BIT;
  if (!ImGui_ImplVulkan_Init(&init)) {
    std::fprintf(stderr, "[forge] ImGui_ImplVulkan_Init failed\n");
    forge::desktop::sayStartupFailed("renderer", "");
    return 3;
  }

  // ── the shell + the frame builder ────────────────────────────────────────
  forge::ui::ForgeShell shell;
  const std::string statePath = stateFilePath();
  {
    std::ifstream in(statePath);
    if (in) {
      std::ostringstream ss;
      ss << in.rdbuf();
      if (shell.loadState(ss.str())) {
        std::printf("[forge] restored workspace/layout/keymap from %s\n", statePath.c_str());
      } else {
        std::printf("[forge] %s was not readable state; starting on the default layout\n",
                    statePath.c_str());
      }
    }
  }

  if (!startWorkspace.empty()) {
    forge::ui::WorkspaceProfile w = forge::ui::WorkspaceProfile::Part;
    if (forge::ui::workspaceFromString(startWorkspace, w)) {
      shell.setWorkspace(w);
      std::printf("[forge] opening in the %s workspace\n", forge::ui::toString(w));
    } else {
      std::fprintf(stderr, "[forge] unknown workspace '%s'\n", startWorkspace.c_str());
    }
  }

  forge::desktop::ForgeFrame frame(shell, scene);

  // ── auto-update ────────────────────────────────────────────────────────────
  // The FIRST download is meant to be the last manual one. A shipped bundle is
  // ad-hoc signed, so installing it costs a trip through System Settings > Privacy
  // & Security; that cost is paid once only if the app can then update itself.
  //
  // The check is read-only -- it fetches the appcast and decides, downloading no
  // payload -- and it runs off the UI thread, so a slow or unreachable GitHub
  // cannot stall a frame. A version we cannot determine means no check at all,
  // because an unknown running version cannot be ordered against a published one.
  forge::desktop::UpdateService updates;
  const std::string runningVersion =
      forge::desktop::UpdateService::detectRunningVersion(argv[0]);
  // The SAME path the version was read out of. Deriving it a second way here is
  // exactly how the bundle that gets replaced stops being the bundle that was
  // measured.
  const std::string appBundle = forge::desktop::UpdateService::detectAppBundle(argv[0]);
  frame.setRunningVersion(runningVersion);
  if (!runningVersion.empty()) {
    std::printf("[forge] version %s; checking for updates in the background\n",
                runningVersion.c_str());
    updates.start(runningVersion);
  } else {
    std::printf("[forge] running outside an .app bundle - auto-update check skipped\n");
  }
  const std::size_t partCommands = frame.wirePartCommands();

  // ── FILE EXCHANGE: the app can open and save real CAD files ──────────────
  // Installed AFTER wirePartCommands(), and the order is load-bearing: an Import
  // binds the file and then states it in the document through `part.input_solid`,
  // and ForgeShell refuses to offer the command at all until that one is in the
  // registry (importAvailable). Wiring it earlier would leave the File menu
  // showing an Open that the shell has already decided it cannot serve.
  //
  // It reads the document straight out of the frame, so what a Save writes is the
  // program the viewport was built from, and it tells the scene which file the
  // document's `INPUT()` binds so the next rebuild resolves it. Both outlive the
  // loop below.
  forge::desktop::FileExchangeHost fileExchange(frame.document(), &scene);
  shell.setFileExchange(&fileExchange);

  // ── AND THE MOUSE CAN REACH ALL SIX OF THEM ──────────────────────────────
  // The six file commands were registered and every one of them declares a
  // `path` the user has to supply. Until this line the only thing that could
  // supply one was an ImGui text box: to open a part you typed its absolute
  // path. The native panel is constructed HERE, in the application, because it
  // is Cocoa -- the frame builder holds the pointer and knows nothing about
  // AppKit, which is what keeps every headless gate linkable.
  //
  // A platform with no implementation answers nullptr and the app keeps the text
  // prompt: a missing picker degrades to the previous behaviour, never to a menu
  // item that does nothing.
  std::unique_ptr<forge::desktop::FileDialog> fileDialog = forge::desktop::makeNativeFileDialog();
  if (fileDialog) {
    frame.setFileDialog(fileDialog.get());
    std::printf("[forge] native file panels: ON (Open, Save, Import and Export ask for a file)\n");
  } else {
    std::fprintf(stderr,
                 "[forge] no native file panel on this platform - the six file commands fall "
                 "back to the typed-path prompt\n");
  }

  std::printf("[forge] registry: %zu commands (%zu of them Part), %zu categories\n",
              shell.registry().size(), partCommands, shell.registry().categories().size());

  // A document named on the command line is opened through THE SAME file.open
  // or file.import_step / file.import_brep the menu and Ctrl+O dispatch.
  if (!openPath.empty()) {
    forge::ui::CommandParams params;
    params.setText("path", openPath);
    std::string cmdId = "file.open";
    auto hasSuffix = [](const std::string& str, const std::string& suffix) {
      if (str.size() < suffix.size()) return false;
      for (std::size_t i = 0; i < suffix.size(); ++i) {
        if (std::tolower(str[str.size() - suffix.size() + i]) !=
            std::tolower(suffix[i])) return false;
      }
      return true;
    };
    if (hasSuffix(openPath, ".step") || hasSuffix(openPath, ".stp")) {
      cmdId = "file.import_step";
    } else if (hasSuffix(openPath, ".brep")) {
      cmdId = "file.import_brep";
    }
    const forge::ui::DispatchResult r = shell.run(cmdId, params);
    if (!r.ok() || !shell.lastDocumentError().empty()) {
      std::fprintf(stderr, "[forge] could not open %s: %s\n", openPath.c_str(),
                   shell.lastDocumentError().empty() ? forge::ui::machineName(r.status)
                                                     : shell.lastDocumentError().c_str());
    } else {
      frame.documentChanged();
      std::printf("[forge] opened %s: %zu statements, %zu triangles\n", openPath.c_str(),
                  frame.document().records().size(), scene.triangleCount());
    }
  }

  forge::desktop::ViewportRenderer viewport;
  if (!viewport.init(g_phys, g_device, g_queue, g_queueFamily, scene.vertices())) {
    std::fprintf(stderr, "[forge] viewport renderer: %s\n", viewport.error().c_str());
    // ... and, unlike before, somewhere the user will actually see it.
    frame.setViewportUnavailable(viewport.error());
  } else {
    viewport.uploadVertices(scene.vertices(), scene.edgeVertices());
    if (!openPath.empty() && scene.bounds().valid) {
      float c[3] = {0.0f, 0.0f, 0.0f};
      scene.bounds().centre(c);
      frame.camera().frame(c, scene.bounds().radius());
    }
  }


  // ── frame loop ───────────────────────────────────────────────────────────
  int frames = 0;
  bool running = true;
  while (running) {
    SDL_Event event;
    while (SDL_PollEvent(&event)) {
      platform.processEvent(event);
      if (event.type == SDL_WINDOWEVENT &&
          (event.window.event == SDL_WINDOWEVENT_RESIZED ||
           event.window.event == SDL_WINDOWEVENT_SIZE_CHANGED)) {
        g_swapchainRebuild = true;
      }
    }
    if (platform.quitRequested() || frame.wantsQuit()) running = false;

    if (g_swapchainRebuild) {
      int w = 0, h = 0;
      SDL_Vulkan_GetDrawableSize(window, &w, &h);
      if (w > 0 && h > 0) {
        ImGui_ImplVulkan_SetMinImageCount(2);
        ImGui_ImplVulkanH_CreateOrResizeWindow(g_instance, g_phys, g_device, &g_window,
                                               g_queueFamily, nullptr, w, h, 2,
                                               VK_IMAGE_USAGE_TRANSFER_SRC_BIT);
        g_window.FrameIndex = 0;
        g_swapchainRebuild = false;
      }
    }
    if (SDL_GetWindowFlags(window) & SDL_WINDOW_MINIMIZED) {
      SDL_Delay(10);
      continue;
    }

    platform.newFrame();
    ImGui_ImplVulkan_NewFrame();
    ImGui::NewFrame();

    // Keyboard -> the ONE dispatch path. A shortcut is not a special case; it is
    // an invoker of the same command object the menu invokes.
    for (const forge::desktop::KeyPress& kp : platform.drainKeyPresses()) {
      frame.onKey(kp.key, kp.mods);
    }
    platform.clearKeyPresses();

    // Hand this frame the latest update state, and honour a Help-menu request.
    // ForgeFrame raises the request; the socket lives out here.
    frame.setUpdateInfo(updates.snapshot());
    if (frame.updateCheckRequested()) {
      frame.clearUpdateCheckRequest();
      updates.start(runningVersion);
    }
    // The install half. apply() refuses unless a check has already offered a
    // version, so this cannot become a speculative download; it runs off the UI
    // thread and reports back through the same snapshot as the check.
    if (frame.updateApplyRequested()) {
      frame.clearUpdateApplyRequest();
      updates.apply(appBundle);
    }

    frame.build(viewport.texture(), platform.dpiScale());
    ImGui::Render();
    ImDrawData* drawData = ImGui::GetDrawData();

    // Size the 3D target to the panel the frame just laid out.
    const forge::desktop::ViewportRequest& req = frame.viewport();
    if (req.visible && req.width > 0 && req.height > 0) {
      viewport.resize(static_cast<std::uint32_t>(req.width),
                      static_cast<std::uint32_t>(req.height));
    }
    // A DOCUMENT REBUILD changes the triangle count, so uploadVertices may
    // destroy and recreate the vertex buffer. Doing that while a previous frame
    // is still reading it is a use-after-free the validation layers would not
    // even catch on a coherent host-visible allocation, so the device is drained
    // first. A selection re-upload only rewrites mapped bytes and needs none.
    if (req.geometryDirty) {
      vkDeviceWaitIdle(g_device);
      viewport.uploadVertices(scene.vertices(), scene.edgeVertices());
      // Re-frame the camera on the new body -- a rebuild can move the bounds
      // (a pattern trebles them), and a camera left behind looks like a crash.
      float c[3] = {0.0f, 0.0f, 0.0f};
      scene.bounds().centre(c);
      frame.camera().frame(c, scene.bounds().radius());
    } else if (req.visibilityDirty) {
      // A body was shown or hidden. The triangle count moved, so the buffer is
      // resized and the device is drained exactly as above -- but the camera is
      // LEFT WHERE THE USER PUT IT. Hiding one body of six is not opening a new
      // part, and a view that jumps on every checkbox is unusable.
      vkDeviceWaitIdle(g_device);
      viewport.uploadVertices(scene.vertices(), scene.edgeVertices());
    } else if (req.selectionDirty) {
      viewport.uploadVertices(scene.vertices(), scene.edgeVertices());
    }


    // ── acquire, record, submit, present ───────────────────────────────────
    ImGui_ImplVulkanH_FrameSemaphores* sem =
        &g_window.FrameSemaphores[g_window.SemaphoreIndex];
    std::uint32_t imageIndex = 0;
    VkResult acquired = vkAcquireNextImageKHR(g_device, g_window.Swapchain, UINT64_MAX,
                                              sem->ImageAcquiredSemaphore, VK_NULL_HANDLE,
                                              &imageIndex);
    if (acquired == VK_ERROR_OUT_OF_DATE_KHR || acquired == VK_SUBOPTIMAL_KHR) {
      g_swapchainRebuild = true;
      if (acquired == VK_ERROR_OUT_OF_DATE_KHR) continue;
    }
    g_window.FrameIndex = imageIndex;
    ImGui_ImplVulkanH_Frame* fd = &g_window.Frames[imageIndex];

    vkWaitForFences(g_device, 1, &fd->Fence, VK_TRUE, UINT64_MAX);
    vkResetFences(g_device, 1, &fd->Fence);
    vkResetCommandPool(g_device, fd->CommandPool, 0);

    VkCommandBufferBeginInfo cbi{};
    cbi.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    cbi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkBeginCommandBuffer(fd->CommandBuffer, &cbi);

    // PASS 1 — the geometry, into the offscreen viewport texture.
    viewport.record(fd->CommandBuffer, frame.camera(), req.hoverFace, req.wireframe);

    // PASS 2 — the UI, into the swapchain, sampling that texture. Both passes are
    // in the SAME command buffer: this is D-001's latency argument as code.
    VkRenderPassBeginInfo rbi{};
    rbi.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
    rbi.renderPass = g_window.RenderPass;
    rbi.framebuffer = fd->Framebuffer;
    rbi.renderArea.extent.width = static_cast<std::uint32_t>(g_window.Width);
    rbi.renderArea.extent.height = static_cast<std::uint32_t>(g_window.Height);
    rbi.clearValueCount = 1;
    rbi.pClearValues = &g_window.ClearValue;
    vkCmdBeginRenderPass(fd->CommandBuffer, &rbi, VK_SUBPASS_CONTENTS_INLINE);
    ImGui_ImplVulkan_RenderDrawData(drawData, fd->CommandBuffer);
    vkCmdEndRenderPass(fd->CommandBuffer);
    vkEndCommandBuffer(fd->CommandBuffer);

    const VkPipelineStageFlags waitStage = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    VkSubmitInfo submit{};
    submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    submit.waitSemaphoreCount = 1;
    submit.pWaitSemaphores = &sem->ImageAcquiredSemaphore;
    submit.pWaitDstStageMask = &waitStage;
    submit.commandBufferCount = 1;
    submit.pCommandBuffers = &fd->CommandBuffer;
    submit.signalSemaphoreCount = 1;
    submit.pSignalSemaphores = &sem->RenderCompleteSemaphore;
    vkQueueSubmit(g_queue, 1, &submit, fd->Fence);

    VkPresentInfoKHR present{};
    present.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR;
    present.waitSemaphoreCount = 1;
    present.pWaitSemaphores = &sem->RenderCompleteSemaphore;
    present.swapchainCount = 1;
    present.pSwapchains = &g_window.Swapchain;
    present.pImageIndices = &imageIndex;
    const VkResult presented = vkQueuePresentKHR(g_queue, &present);
    if (presented == VK_ERROR_OUT_OF_DATE_KHR || presented == VK_SUBOPTIMAL_KHR) {
      g_swapchainRebuild = true;
    }
    g_window.SemaphoreIndex = (g_window.SemaphoreIndex + 1) % g_window.SemaphoreCount;

    ++frames;
    if (frames == 1) {
      std::printf("[forge] first frame presented: %d vertices / %d indices of UI draw data, "
                  "%u viewport triangles\n",
                  drawData != nullptr ? drawData->TotalVtxCount : 0,
                  drawData != nullptr ? drawData->TotalIdxCount : 0, viewport.triangleCount());
      std::fflush(stdout);
    }
    if (!screenshot.empty() && frames == (frameLimit > 1 ? frameLimit - 1 : 1)) {
      vkQueueWaitIdle(g_queue);
      if (captureSwapchain(imageIndex, screenshot)) {
        std::printf("[forge] screenshot of the LIVE window -> %s (%dx%d)\n",
                    screenshot.c_str(), g_window.Width, g_window.Height);
      } else {
        std::fprintf(stderr, "[forge] screenshot failed\n");
      }
    }
    if (frameLimit > 0 && frames >= frameLimit) running = false;
  }

  std::printf("[forge] presented %d frames\n", frames);

  // ── persistence: the layout the user leaves is the layout they come back to ─
  {
    std::ofstream out(statePath, std::ios::trunc);
    if (out) {
      out << shell.saveState();
      std::printf("[forge] saved workspace/layout/keymap to %s\n", statePath.c_str());
    }
  }

  vkDeviceWaitIdle(g_device);
  viewport.destroy();
  ImGui_ImplVulkan_Shutdown();
  platform.shutdown();
  ImGui::DestroyContext();
  ImGui_ImplVulkanH_DestroyWindow(g_instance, g_device, &g_window, nullptr);
  vkDestroyDevice(g_device, nullptr);
  vkDestroyInstance(g_instance, nullptr);
  SDL_DestroyWindow(window);
  SDL_Quit();
  return 0;
}
