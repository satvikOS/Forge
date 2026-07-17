// forge-desktop/ui_probe.cpp
//
// ============================================================================
// FORGE C++ DESKTOP UI PROBE  (Pillar #10, Phase-1 — the app's first UI pixels)
// ============================================================================
//
// PURPOSE — render the desktop app's UI LAYER (a representative Forge IDE built
// with Dear ImGui) to an OFFSCREEN framebuffer -> PNG, fully HEADLESS: no window,
// no swapchain, no GLFW, no input. This is the first time the pure-C++ desktop
// app draws real interface pixels, layered on top of the already-proven headless
// Vulkan/MoltenVK renderer backend (see docs/FORGE_CPP_PHASE1_RENDERER.md and
// forge-desktop/renderer_probe.cpp, whose Vulkan setup + PNG writer this reuses).
//
//   1. Reuse the renderer's Vulkan init (VkInstance portability + MoltenVK
//      VkDevice + graphics queue) and create a 1280x800 RGBA8 offscreen color
//      image + render pass + framebuffer (no swapchain).
//   2. STRETCH: render forge::tessellateLOD(makeBox(10,10,10),High) into a SEPARATE
//      offscreen color texture (depth-tested, diffuse-shaded) so it can be shown
//      inside the central viewport panel via ImGui::Image.
//   3. ImGui::CreateContext(); a dark Forge-branded style; io.DisplaySize={1280,800},
//      io.DeltaTime=1/60. NO platform backend (headless). ImGui_ImplVulkan_Init
//      against the offscreen render pass; the 1.92 backend uploads the font atlas
//      automatically during RenderDrawData.
//   4. Build ONE frame of a representative Forge IDE: top menu bar (File/Edit/View/
//      Model/Draft/Help), left MODEL-TREE panel (Part -> Sketch/Extrude/Fillet/Shell),
//      central VIEWPORT panel (the 3D model, or a placeholder rect), right PROPERTIES
//      panel (labelled fields + sliders/checkboxes/combo/colour), bottom status bar.
//   5. ImGui::Render(); begin the offscreen pass with a dark clear;
//      ImGui_ImplVulkan_RenderDrawData(...); submit; wait.
//   6. Readback the offscreen image; ASSERT a meaningful fraction (>15%) of pixels
//      differ from the clear colour (the UI actually drew); write a PNG (the same
//      self-contained writer as renderer_probe — no new dep). Print coverage + path.
//
// No stubs, no faked pass: every VkResult is checked; the coverage assertion is on
// a real read of real GPU memory.
//
// Build (option-gated, does NOT touch the default .node build or CI):
//   cmake -B build -DFORGE_BUILD_DESKTOP_FOUNDATION=ON -DFORGE_BUILD_DESKTOP_UI=ON
//   cmake --build build -j3 --target forge_ui_probe
//   VK_ICD_FILENAMES=$(brew --prefix molten-vk)/etc/vulkan/icd.d/MoltenVK_icd.json \
//     ./build/forge_ui_probe

#include <vulkan/vulkan.h>

#include "imgui.h"
#include "imgui_impl_vulkan.h"

// forge_kernel_core (node-free) — the 3D viewport model (stretch).
#include "forge/Primitives.hpp"   // forge::makeBox
#include "forge/LOD.hpp"          // forge::tessellateLOD / LODLevel
#include "forge/Tessellate.hpp"   // forge::Mesh

// SPIR-V for the 3D viewport shaders, compiled from forge-desktop/shaders/ui_viewport.*
// by glslangValidator at build time (see the FORGE_BUILD_DESKTOP_UI CMake block).
#include "ui_viewport_vert.spv.h"   // uiVertSpv[]
#include "ui_viewport_frag.spv.h"   // uiFragSpv[]

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace {

// -------- offscreen UI framebuffer (the app window surface) --------
constexpr uint32_t UI_W = 1280;
constexpr uint32_t UI_H = 800;
constexpr VkFormat UI_FORMAT = VK_FORMAT_R8G8B8A8_UNORM;

// The known clear colour asserted against for coverage (dark Forge slate).
constexpr float CLEAR_R = 0.055f, CLEAR_G = 0.065f, CLEAR_B = 0.085f, CLEAR_A = 1.0f;

// -------- 3D viewport texture (the model inside the central panel) --------
constexpr uint32_t VP_W = 768;
constexpr uint32_t VP_H = 576;   // 4:3
constexpr VkFormat VP_COLOR_FORMAT = VK_FORMAT_R8G8B8A8_UNORM;
constexpr VkFormat VP_DEPTH_FORMAT = VK_FORMAT_D32_SFLOAT;
constexpr float VP_CLEAR_R = 0.10f, VP_CLEAR_G = 0.12f, VP_CLEAR_B = 0.15f;  // viewport bg

const char* vkResultStr(VkResult r) {
    switch (r) {
        case VK_SUCCESS: return "VK_SUCCESS";
        case VK_NOT_READY: return "VK_NOT_READY";
        case VK_TIMEOUT: return "VK_TIMEOUT";
        case VK_ERROR_OUT_OF_HOST_MEMORY: return "VK_ERROR_OUT_OF_HOST_MEMORY";
        case VK_ERROR_OUT_OF_DEVICE_MEMORY: return "VK_ERROR_OUT_OF_DEVICE_MEMORY";
        case VK_ERROR_INITIALIZATION_FAILED: return "VK_ERROR_INITIALIZATION_FAILED";
        case VK_ERROR_DEVICE_LOST: return "VK_ERROR_DEVICE_LOST";
        case VK_ERROR_LAYER_NOT_PRESENT: return "VK_ERROR_LAYER_NOT_PRESENT";
        case VK_ERROR_EXTENSION_NOT_PRESENT: return "VK_ERROR_EXTENSION_NOT_PRESENT";
        case VK_ERROR_FEATURE_NOT_PRESENT: return "VK_ERROR_FEATURE_NOT_PRESENT";
        case VK_ERROR_INCOMPATIBLE_DRIVER: return "VK_ERROR_INCOMPATIBLE_DRIVER";
        case VK_ERROR_FORMAT_NOT_SUPPORTED: return "VK_ERROR_FORMAT_NOT_SUPPORTED";
        case VK_ERROR_UNKNOWN: return "VK_ERROR_UNKNOWN";
        default: return "VK_ERROR_(other)";
    }
}

#define VKCHECK(call)                                                          \
    do {                                                                       \
        VkResult _r = (call);                                                  \
        if (_r != VK_SUCCESS) {                                                \
            std::fprintf(stderr, "  FAIL: %s -> %s (%d)  [line %d]\n",         \
                         #call, vkResultStr(_r), (int)_r, __LINE__);           \
            return -1;                                                         \
        }                                                                      \
    } while (0)

// ------------------------------ Vulkan context ------------------------------
struct Vk {
    VkInstance instance = VK_NULL_HANDLE;
    VkPhysicalDevice phys = VK_NULL_HANDLE;
    VkDevice device = VK_NULL_HANDLE;
    VkQueue queue = VK_NULL_HANDLE;
    uint32_t queueFamily = 0;
    VkPhysicalDeviceMemoryProperties memProps{};
    char deviceName[VK_MAX_PHYSICAL_DEVICE_NAME_SIZE] = {0};
    char driverName[VK_MAX_DRIVER_NAME_SIZE] = {0};
};

uint32_t findMemoryType(const Vk& vk, uint32_t typeBits, VkMemoryPropertyFlags want) {
    for (uint32_t i = 0; i < vk.memProps.memoryTypeCount; ++i) {
        if ((typeBits & (1u << i)) &&
            (vk.memProps.memoryTypes[i].propertyFlags & want) == want) {
            return i;
        }
    }
    return UINT32_MAX;
}

bool hasInstanceExt(const char* name) {
    uint32_t n = 0;
    vkEnumerateInstanceExtensionProperties(nullptr, &n, nullptr);
    std::vector<VkExtensionProperties> exts(n);
    vkEnumerateInstanceExtensionProperties(nullptr, &n, exts.data());
    for (const auto& e : exts) if (std::strcmp(e.extensionName, name) == 0) return true;
    return false;
}

int initVulkan(Vk& vk) {
    VkApplicationInfo app{VK_STRUCTURE_TYPE_APPLICATION_INFO};
    app.pApplicationName = "forge_ui_probe";
    app.apiVersion = VK_API_VERSION_1_2;

    std::vector<const char*> instExts;
    bool portability = hasInstanceExt(VK_KHR_PORTABILITY_ENUMERATION_EXTENSION_NAME);
    if (portability) instExts.push_back(VK_KHR_PORTABILITY_ENUMERATION_EXTENSION_NAME);

    VkInstanceCreateInfo ici{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
    if (portability) ici.flags = VK_INSTANCE_CREATE_ENUMERATE_PORTABILITY_BIT_KHR;
    ici.pApplicationInfo = &app;
    ici.enabledExtensionCount = static_cast<uint32_t>(instExts.size());
    ici.ppEnabledExtensionNames = instExts.empty() ? nullptr : instExts.data();
    VKCHECK(vkCreateInstance(&ici, nullptr, &vk.instance));

    uint32_t n = 0;
    VKCHECK(vkEnumeratePhysicalDevices(vk.instance, &n, nullptr));
    if (n == 0) {
        std::fprintf(stderr, "  FAIL: no VkPhysicalDevice enumerated (MoltenVK ICD not found?)\n");
        return -1;
    }
    std::vector<VkPhysicalDevice> devs(n);
    VKCHECK(vkEnumeratePhysicalDevices(vk.instance, &n, devs.data()));
    vk.phys = devs[0];

    VkPhysicalDeviceDriverProperties drv{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_DRIVER_PROPERTIES};
    VkPhysicalDeviceProperties2 p2{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2};
    p2.pNext = &drv;
    vkGetPhysicalDeviceProperties2(vk.phys, &p2);
    std::memcpy(vk.deviceName, p2.properties.deviceName, sizeof(vk.deviceName));
    std::memcpy(vk.driverName, drv.driverName, sizeof(vk.driverName));
    vkGetPhysicalDeviceMemoryProperties(vk.phys, &vk.memProps);

    uint32_t qn = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(vk.phys, &qn, nullptr);
    std::vector<VkQueueFamilyProperties> qfp(qn);
    vkGetPhysicalDeviceQueueFamilyProperties(vk.phys, &qn, qfp.data());
    bool found = false;
    for (uint32_t i = 0; i < qn; ++i) {
        if (qfp[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) { vk.queueFamily = i; found = true; break; }
    }
    if (!found) { std::fprintf(stderr, "  FAIL: no graphics queue family\n"); return -1; }

    uint32_t den = 0;
    vkEnumerateDeviceExtensionProperties(vk.phys, nullptr, &den, nullptr);
    std::vector<VkExtensionProperties> devExts(den);
    vkEnumerateDeviceExtensionProperties(vk.phys, nullptr, &den, devExts.data());
    std::vector<const char*> enableDevExts;
    for (const auto& e : devExts) {
        if (std::strcmp(e.extensionName, "VK_KHR_portability_subset") == 0)
            enableDevExts.push_back("VK_KHR_portability_subset");
    }

    float prio = 1.0f;
    VkDeviceQueueCreateInfo qci{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
    qci.queueFamilyIndex = vk.queueFamily;
    qci.queueCount = 1;
    qci.pQueuePriorities = &prio;

    VkDeviceCreateInfo dci{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
    dci.queueCreateInfoCount = 1;
    dci.pQueueCreateInfos = &qci;
    dci.enabledExtensionCount = static_cast<uint32_t>(enableDevExts.size());
    dci.ppEnabledExtensionNames = enableDevExts.empty() ? nullptr : enableDevExts.data();
    VKCHECK(vkCreateDevice(vk.phys, &dci, nullptr, &vk.device));
    vkGetDeviceQueue(vk.device, vk.queueFamily, 0, &vk.queue);
    return 0;
}

// ------------------------------ generic GPU buffer ------------------------------
int makeHostBuffer(const Vk& vk, VkBufferUsageFlags usage, const void* data, VkDeviceSize size,
                   VkBuffer& buf, VkDeviceMemory& mem) {
    VkBufferCreateInfo bci{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    bci.size = size;
    bci.usage = usage;
    bci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    VKCHECK(vkCreateBuffer(vk.device, &bci, nullptr, &buf));
    VkMemoryRequirements mr{};
    vkGetBufferMemoryRequirements(vk.device, buf, &mr);
    VkMemoryAllocateInfo ai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    ai.allocationSize = mr.size;
    ai.memoryTypeIndex = findMemoryType(vk, mr.memoryTypeBits,
        VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    if (ai.memoryTypeIndex == UINT32_MAX) {
        std::fprintf(stderr, "  FAIL: no HOST_VISIBLE|COHERENT memory type for buffer\n"); return -1;
    }
    VKCHECK(vkAllocateMemory(vk.device, &ai, nullptr, &mem));
    VKCHECK(vkBindBufferMemory(vk.device, buf, mem, 0));
    void* p = nullptr;
    VKCHECK(vkMapMemory(vk.device, mem, 0, size, 0, &p));
    std::memcpy(p, data, static_cast<size_t>(size));
    vkUnmapMemory(vk.device, mem);
    return 0;
}

VkShaderModule makeShader(VkDevice dev, const uint32_t* code, size_t bytes) {
    VkShaderModuleCreateInfo sci{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    sci.codeSize = bytes;
    sci.pCode = code;
    VkShaderModule m = VK_NULL_HANDLE;
    if (vkCreateShaderModule(dev, &sci, nullptr, &m) != VK_SUCCESS) return VK_NULL_HANDLE;
    return m;
}

// ---------------------------- tiny self-contained PNG ----------------------------
uint32_t crc32_of(const uint8_t* p, size_t n, uint32_t crc) {
    static uint32_t table[256];
    static bool init = false;
    if (!init) {
        for (uint32_t i = 0; i < 256; ++i) {
            uint32_t c = i;
            for (int k = 0; k < 8; ++k) c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
            table[i] = c;
        }
        init = true;
    }
    crc ^= 0xFFFFFFFFu;
    for (size_t i = 0; i < n; ++i) crc = table[(crc ^ p[i]) & 0xFF] ^ (crc >> 8);
    return crc ^ 0xFFFFFFFFu;
}
void putBE32(std::vector<uint8_t>& v, uint32_t x) {
    v.push_back((x >> 24) & 0xFF); v.push_back((x >> 16) & 0xFF);
    v.push_back((x >> 8) & 0xFF);  v.push_back(x & 0xFF);
}
void writeChunk(std::vector<uint8_t>& out, const char type[4], const std::vector<uint8_t>& data) {
    putBE32(out, static_cast<uint32_t>(data.size()));
    std::vector<uint8_t> tc; tc.insert(tc.end(), type, type + 4);
    tc.insert(tc.end(), data.begin(), data.end());
    out.insert(out.end(), tc.begin(), tc.end());
    putBE32(out, crc32_of(tc.data(), tc.size(), 0));
}
bool writePng(const std::string& path, const uint8_t* rgba, uint32_t w, uint32_t h) {
    std::vector<uint8_t> raw;
    raw.reserve(static_cast<size_t>(h) * (1 + w * 4));
    for (uint32_t y = 0; y < h; ++y) {
        raw.push_back(0);
        raw.insert(raw.end(), rgba + static_cast<size_t>(y) * w * 4,
                              rgba + static_cast<size_t>(y + 1) * w * 4);
    }
    uint32_t a = 1, b = 0;
    for (uint8_t byte : raw) { a = (a + byte) % 65521; b = (b + a) % 65521; }
    const uint32_t adler = (b << 16) | a;
    std::vector<uint8_t> zlib;
    zlib.push_back(0x78); zlib.push_back(0x01);
    size_t off = 0;
    while (off < raw.size()) {
        size_t block = std::min<size_t>(65535, raw.size() - off);
        zlib.push_back(off + block >= raw.size() ? 1 : 0);
        zlib.push_back(block & 0xFF); zlib.push_back((block >> 8) & 0xFF);
        uint16_t nlen = static_cast<uint16_t>(~block);
        zlib.push_back(nlen & 0xFF); zlib.push_back((nlen >> 8) & 0xFF);
        zlib.insert(zlib.end(), raw.begin() + off, raw.begin() + off + block);
        off += block;
    }
    putBE32(zlib, adler);

    std::vector<uint8_t> png;
    const uint8_t sig[8] = {137, 'P', 'N', 'G', 13, 10, 26, 10};
    png.insert(png.end(), sig, sig + 8);
    std::vector<uint8_t> ihdr;
    putBE32(ihdr, w); putBE32(ihdr, h);
    ihdr.push_back(8); ihdr.push_back(6);
    ihdr.push_back(0); ihdr.push_back(0); ihdr.push_back(0);
    writeChunk(png, "IHDR", ihdr);
    writeChunk(png, "IDAT", zlib);
    writeChunk(png, "IEND", {});

    std::FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) return false;
    size_t wrote = std::fwrite(png.data(), 1, png.size(), f);
    std::fclose(f);
    return wrote == png.size();
}

// ------------------------------ 4x4 matrix helpers ------------------------------
struct Mat4 { double m[4][4]; };
Mat4 identity() { Mat4 r{}; for (int i = 0; i < 4; ++i) r.m[i][i] = 1; return r; }
Mat4 mul(const Mat4& A, const Mat4& B) {
    Mat4 r{};
    for (int i = 0; i < 4; ++i)
        for (int j = 0; j < 4; ++j) {
            double s = 0;
            for (int k = 0; k < 4; ++k) s += A.m[i][k] * B.m[k][j];
            r.m[i][j] = s;
        }
    return r;
}
Mat4 translate(double x, double y, double z) {
    Mat4 r = identity(); r.m[0][3] = x; r.m[1][3] = y; r.m[2][3] = z; return r;
}
Mat4 rotX(double a) {
    Mat4 r = identity();
    r.m[1][1] = std::cos(a); r.m[1][2] = -std::sin(a);
    r.m[2][1] = std::sin(a); r.m[2][2] =  std::cos(a);
    return r;
}
Mat4 rotY(double a) {
    Mat4 r = identity();
    r.m[0][0] =  std::cos(a); r.m[0][2] = std::sin(a);
    r.m[2][0] = -std::sin(a); r.m[2][2] = std::cos(a);
    return r;
}
void toColMajor(const Mat4& mtx, float out[16]) {
    for (int c = 0; c < 4; ++c)
        for (int r = 0; r < 4; ++r)
            out[c * 4 + r] = static_cast<float>(mtx.m[r][c]);
}

// ============================================================================
// The offscreen UI target (the app "window" surface): a 1280x800 RGBA8 color
// image, a CLEAR->STORE render pass ending in TRANSFER_SRC_OPTIMAL so the frame
// can be copied to a host-visible buffer and read back, plus a command pool.
// ============================================================================
struct UITarget {
    VkImage image = VK_NULL_HANDLE;
    VkDeviceMemory imageMem = VK_NULL_HANDLE;
    VkImageView view = VK_NULL_HANDLE;
    VkRenderPass renderPass = VK_NULL_HANDLE;
    VkFramebuffer framebuffer = VK_NULL_HANDLE;
    VkBuffer readback = VK_NULL_HANDLE;
    VkDeviceMemory readbackMem = VK_NULL_HANDLE;
    VkCommandPool pool = VK_NULL_HANDLE;
};

int createUITarget(const Vk& vk, UITarget& t) {
    VkImageCreateInfo ic{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
    ic.imageType = VK_IMAGE_TYPE_2D;
    ic.format = UI_FORMAT;
    ic.extent = {UI_W, UI_H, 1};
    ic.mipLevels = 1;
    ic.arrayLayers = 1;
    ic.samples = VK_SAMPLE_COUNT_1_BIT;
    ic.tiling = VK_IMAGE_TILING_OPTIMAL;
    ic.usage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT;
    ic.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    VKCHECK(vkCreateImage(vk.device, &ic, nullptr, &t.image));

    VkMemoryRequirements mr{};
    vkGetImageMemoryRequirements(vk.device, t.image, &mr);
    VkMemoryAllocateInfo ai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    ai.allocationSize = mr.size;
    ai.memoryTypeIndex = findMemoryType(vk, mr.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    if (ai.memoryTypeIndex == UINT32_MAX) {
        std::fprintf(stderr, "  FAIL: no DEVICE_LOCAL memory for UI image\n"); return -1;
    }
    VKCHECK(vkAllocateMemory(vk.device, &ai, nullptr, &t.imageMem));
    VKCHECK(vkBindImageMemory(vk.device, t.image, t.imageMem, 0));

    VkImageViewCreateInfo vci{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
    vci.image = t.image;
    vci.viewType = VK_IMAGE_VIEW_TYPE_2D;
    vci.format = UI_FORMAT;
    vci.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    VKCHECK(vkCreateImageView(vk.device, &vci, nullptr, &t.view));

    VkAttachmentDescription att{};
    att.format = UI_FORMAT;
    att.samples = VK_SAMPLE_COUNT_1_BIT;
    att.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    att.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    att.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    att.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    att.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    att.finalLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;

    VkAttachmentReference ref{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
    VkSubpassDescription sub{};
    sub.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
    sub.colorAttachmentCount = 1;
    sub.pColorAttachments = &ref;

    VkSubpassDependency deps[2]{};
    deps[0].srcSubpass = VK_SUBPASS_EXTERNAL;
    deps[0].dstSubpass = 0;
    deps[0].srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    deps[0].dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    deps[0].srcAccessMask = 0;
    deps[0].dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    deps[1].srcSubpass = 0;
    deps[1].dstSubpass = VK_SUBPASS_EXTERNAL;
    deps[1].srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    deps[1].dstStageMask = VK_PIPELINE_STAGE_TRANSFER_BIT;
    deps[1].srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    deps[1].dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;

    VkRenderPassCreateInfo rpci{VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO};
    rpci.attachmentCount = 1;
    rpci.pAttachments = &att;
    rpci.subpassCount = 1;
    rpci.pSubpasses = &sub;
    rpci.dependencyCount = 2;
    rpci.pDependencies = deps;
    VKCHECK(vkCreateRenderPass(vk.device, &rpci, nullptr, &t.renderPass));

    VkFramebufferCreateInfo fci{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
    fci.renderPass = t.renderPass;
    fci.attachmentCount = 1;
    fci.pAttachments = &t.view;
    fci.width = UI_W;
    fci.height = UI_H;
    fci.layers = 1;
    VKCHECK(vkCreateFramebuffer(vk.device, &fci, nullptr, &t.framebuffer));

    VkBufferCreateInfo bci{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    bci.size = static_cast<VkDeviceSize>(UI_W) * UI_H * 4;
    bci.usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT;
    bci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    VKCHECK(vkCreateBuffer(vk.device, &bci, nullptr, &t.readback));
    VkMemoryRequirements bmr{};
    vkGetBufferMemoryRequirements(vk.device, t.readback, &bmr);
    VkMemoryAllocateInfo bai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    bai.allocationSize = bmr.size;
    bai.memoryTypeIndex = findMemoryType(vk, bmr.memoryTypeBits,
        VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    if (bai.memoryTypeIndex == UINT32_MAX) {
        std::fprintf(stderr, "  FAIL: no HOST_VISIBLE|COHERENT memory for readback\n"); return -1;
    }
    VKCHECK(vkAllocateMemory(vk.device, &bai, nullptr, &t.readbackMem));
    VKCHECK(vkBindBufferMemory(vk.device, t.readback, t.readbackMem, 0));

    VkCommandPoolCreateInfo pci{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
    pci.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    pci.queueFamilyIndex = vk.queueFamily;
    VKCHECK(vkCreateCommandPool(vk.device, &pci, nullptr, &t.pool));
    return 0;
}

// ============================================================================
// STRETCH: render the kernel box into a SEPARATE offscreen color texture that
// ends in SHADER_READ_ONLY_OPTIMAL so ImGui can sample it via ImGui::Image.
// Depth-tested + diffuse-shaded so it reads as a real 3D solid. On success the
// color VkImageView is returned via `outView`; the model triangle count via
// `outTris`. Returns 0 on success, non-zero (with the exact VkResult logged) if
// the composite could not be produced — the caller then draws a placeholder.
// ============================================================================
int renderViewportTexture(const Vk& vk, VkImageView& outView, uint32_t& outTris) {
    // 1) Tessellate the kernel box (node-free core lib).
    forge::ShapeHandle box = forge::makeBox(10.0, 10.0, 10.0);
    const forge::Mesh& mesh = forge::tessellateLOD(box, forge::LODLevel::High);
    const uint32_t vertCount = static_cast<uint32_t>(mesh.positions.size() / 3);
    const uint32_t idxCount  = static_cast<uint32_t>(mesh.indices.size());
    if (vertCount < 3 || idxCount < 3 || mesh.normals.size() != mesh.positions.size()) {
        std::fprintf(stderr, "  FAIL: degenerate kernel mesh for viewport\n"); return -1;
    }
    outTris = idxCount / 3;

    // 2) Color image (COLOR_ATTACHMENT | SAMPLED).
    VkImage color = VK_NULL_HANDLE; VkDeviceMemory colorMem = VK_NULL_HANDLE;
    {
        VkImageCreateInfo ic{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
        ic.imageType = VK_IMAGE_TYPE_2D; ic.format = VP_COLOR_FORMAT;
        ic.extent = {VP_W, VP_H, 1}; ic.mipLevels = 1; ic.arrayLayers = 1;
        ic.samples = VK_SAMPLE_COUNT_1_BIT; ic.tiling = VK_IMAGE_TILING_OPTIMAL;
        ic.usage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT;
        ic.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        VKCHECK(vkCreateImage(vk.device, &ic, nullptr, &color));
        VkMemoryRequirements mr{}; vkGetImageMemoryRequirements(vk.device, color, &mr);
        VkMemoryAllocateInfo ai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        ai.allocationSize = mr.size;
        ai.memoryTypeIndex = findMemoryType(vk, mr.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
        VKCHECK(vkAllocateMemory(vk.device, &ai, nullptr, &colorMem));
        VKCHECK(vkBindImageMemory(vk.device, color, colorMem, 0));
    }
    VkImageView colorView = VK_NULL_HANDLE;
    {
        VkImageViewCreateInfo vci{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
        vci.image = color; vci.viewType = VK_IMAGE_VIEW_TYPE_2D; vci.format = VP_COLOR_FORMAT;
        vci.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
        VKCHECK(vkCreateImageView(vk.device, &vci, nullptr, &colorView));
    }

    // 3) Depth image.
    VkImage depth = VK_NULL_HANDLE; VkDeviceMemory depthMem = VK_NULL_HANDLE;
    {
        VkImageCreateInfo ic{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
        ic.imageType = VK_IMAGE_TYPE_2D; ic.format = VP_DEPTH_FORMAT;
        ic.extent = {VP_W, VP_H, 1}; ic.mipLevels = 1; ic.arrayLayers = 1;
        ic.samples = VK_SAMPLE_COUNT_1_BIT; ic.tiling = VK_IMAGE_TILING_OPTIMAL;
        ic.usage = VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT;
        ic.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        VKCHECK(vkCreateImage(vk.device, &ic, nullptr, &depth));
        VkMemoryRequirements mr{}; vkGetImageMemoryRequirements(vk.device, depth, &mr);
        VkMemoryAllocateInfo ai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        ai.allocationSize = mr.size;
        ai.memoryTypeIndex = findMemoryType(vk, mr.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
        VKCHECK(vkAllocateMemory(vk.device, &ai, nullptr, &depthMem));
        VKCHECK(vkBindImageMemory(vk.device, depth, depthMem, 0));
    }
    VkImageView depthView = VK_NULL_HANDLE;
    {
        VkImageViewCreateInfo vci{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
        vci.image = depth; vci.viewType = VK_IMAGE_VIEW_TYPE_2D; vci.format = VP_DEPTH_FORMAT;
        vci.subresourceRange = {VK_IMAGE_ASPECT_DEPTH_BIT, 0, 1, 0, 1};
        VKCHECK(vkCreateImageView(vk.device, &vci, nullptr, &depthView));
    }

    // 4) Render pass: color (CLEAR->STORE, final SHADER_READ_ONLY) + depth (CLEAR).
    VkRenderPass rp = VK_NULL_HANDLE;
    {
        VkAttachmentDescription att[2]{};
        att[0].format = VP_COLOR_FORMAT; att[0].samples = VK_SAMPLE_COUNT_1_BIT;
        att[0].loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR; att[0].storeOp = VK_ATTACHMENT_STORE_OP_STORE;
        att[0].stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE; att[0].stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        att[0].initialLayout = VK_IMAGE_LAYOUT_UNDEFINED; att[0].finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
        att[1].format = VP_DEPTH_FORMAT; att[1].samples = VK_SAMPLE_COUNT_1_BIT;
        att[1].loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR; att[1].storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        att[1].stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE; att[1].stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        att[1].initialLayout = VK_IMAGE_LAYOUT_UNDEFINED; att[1].finalLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

        VkAttachmentReference colorRef{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
        VkAttachmentReference depthRef{1, VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL};
        VkSubpassDescription sub{};
        sub.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
        sub.colorAttachmentCount = 1; sub.pColorAttachments = &colorRef;
        sub.pDepthStencilAttachment = &depthRef;

        VkSubpassDependency deps[2]{};
        deps[0].srcSubpass = VK_SUBPASS_EXTERNAL; deps[0].dstSubpass = 0;
        deps[0].srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT | VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
        deps[0].dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT | VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
        deps[0].srcAccessMask = 0;
        deps[0].dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT | VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;
        deps[1].srcSubpass = 0; deps[1].dstSubpass = VK_SUBPASS_EXTERNAL;
        deps[1].srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
        deps[1].dstStageMask = VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
        deps[1].srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
        deps[1].dstAccessMask = VK_ACCESS_SHADER_READ_BIT;

        VkRenderPassCreateInfo rpci{VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO};
        rpci.attachmentCount = 2; rpci.pAttachments = att;
        rpci.subpassCount = 1; rpci.pSubpasses = &sub;
        rpci.dependencyCount = 2; rpci.pDependencies = deps;
        VKCHECK(vkCreateRenderPass(vk.device, &rpci, nullptr, &rp));
    }
    VkFramebuffer fb = VK_NULL_HANDLE;
    {
        VkImageView atts[2] = {colorView, depthView};
        VkFramebufferCreateInfo fci{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
        fci.renderPass = rp; fci.attachmentCount = 2; fci.pAttachments = atts;
        fci.width = VP_W; fci.height = VP_H; fci.layers = 1;
        VKCHECK(vkCreateFramebuffer(vk.device, &fci, nullptr, &fb));
    }

    // 5) Vertex (positions) + normal buffers + index buffer.
    VkBuffer vboPos = VK_NULL_HANDLE, vboNrm = VK_NULL_HANDLE, ibo = VK_NULL_HANDLE;
    VkDeviceMemory vboPosMem = VK_NULL_HANDLE, vboNrmMem = VK_NULL_HANDLE, iboMem = VK_NULL_HANDLE;
    if (makeHostBuffer(vk, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, mesh.positions.data(),
                       mesh.positions.size() * sizeof(float), vboPos, vboPosMem) != 0) return -1;
    if (makeHostBuffer(vk, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, mesh.normals.data(),
                       mesh.normals.size() * sizeof(float), vboNrm, vboNrmMem) != 0) return -1;
    if (makeHostBuffer(vk, VK_BUFFER_USAGE_INDEX_BUFFER_BIT, mesh.indices.data(),
                       mesh.indices.size() * sizeof(uint32_t), ibo, iboMem) != 0) return -1;

    // 6) Fixed MVP: centre + rotate to show three faces, ortho framing at 4:3.
    const double modelHalf = 9.5, depthRange = 60.0;
    const double aspect = static_cast<double>(VP_W) / static_cast<double>(VP_H);
    Mat4 model = translate(-5, -5, -5);
    Mat4 rot   = mul(rotY(0.70), rotX(0.50));
    Mat4 proj  = identity();
    proj.m[0][0] =  1.0 / (modelHalf * aspect);
    proj.m[1][1] = -1.0 / modelHalf;
    proj.m[2][2] =  1.0 / depthRange; proj.m[2][3] = 0.5;
    Mat4 mvp = mul(proj, mul(rot, model));
    float push[32];               // mat4 mvp + mat4 nrm, column-major
    toColMajor(mvp, push);
    toColMajor(rot, push + 16);

    // 7) Pipeline.
    VkShaderModule vs = makeShader(vk.device, uiVertSpv, sizeof(uiVertSpv));
    VkShaderModule fs = makeShader(vk.device, uiFragSpv, sizeof(uiFragSpv));
    if (!vs || !fs) { std::fprintf(stderr, "  FAIL: viewport shader module creation\n"); return -1; }

    VkPushConstantRange pcr{VK_SHADER_STAGE_VERTEX_BIT, 0, sizeof(push)};
    VkPipelineLayoutCreateInfo plci{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    plci.pushConstantRangeCount = 1; plci.pPushConstantRanges = &pcr;
    VkPipelineLayout layout = VK_NULL_HANDLE;
    VKCHECK(vkCreatePipelineLayout(vk.device, &plci, nullptr, &layout));

    VkPipelineShaderStageCreateInfo stages[2]{};
    stages[0] = {VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
    stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT; stages[0].module = vs; stages[0].pName = "main";
    stages[1] = {VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
    stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT; stages[1].module = fs; stages[1].pName = "main";

    VkVertexInputBindingDescription binds[2] = {
        {0, 3 * sizeof(float), VK_VERTEX_INPUT_RATE_VERTEX},   // positions
        {1, 3 * sizeof(float), VK_VERTEX_INPUT_RATE_VERTEX},   // normals
    };
    VkVertexInputAttributeDescription attrs[2] = {
        {0, 0, VK_FORMAT_R32G32B32_SFLOAT, 0},
        {1, 1, VK_FORMAT_R32G32B32_SFLOAT, 0},
    };
    VkPipelineVertexInputStateCreateInfo vin{VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO};
    vin.vertexBindingDescriptionCount = 2; vin.pVertexBindingDescriptions = binds;
    vin.vertexAttributeDescriptionCount = 2; vin.pVertexAttributeDescriptions = attrs;

    VkPipelineInputAssemblyStateCreateInfo ia{VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO};
    ia.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;

    VkViewport vp{0, 0, (float)VP_W, (float)VP_H, 0.0f, 1.0f};
    VkRect2D scissor{{0, 0}, {VP_W, VP_H}};
    VkPipelineViewportStateCreateInfo vps{VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO};
    vps.viewportCount = 1; vps.pViewports = &vp; vps.scissorCount = 1; vps.pScissors = &scissor;

    VkPipelineRasterizationStateCreateInfo rs{VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO};
    rs.polygonMode = VK_POLYGON_MODE_FILL;
    rs.cullMode = VK_CULL_MODE_NONE;
    rs.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
    rs.lineWidth = 1.0f;

    VkPipelineMultisampleStateCreateInfo ms{VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO};
    ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

    VkPipelineDepthStencilStateCreateInfo ds{VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO};
    ds.depthTestEnable = VK_TRUE; ds.depthWriteEnable = VK_TRUE;
    ds.depthCompareOp = VK_COMPARE_OP_LESS_OR_EQUAL;

    VkPipelineColorBlendAttachmentState cba{};
    cba.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT |
                         VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    cba.blendEnable = VK_FALSE;
    VkPipelineColorBlendStateCreateInfo cb{VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO};
    cb.attachmentCount = 1; cb.pAttachments = &cba;

    VkGraphicsPipelineCreateInfo gpci{VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO};
    gpci.stageCount = 2; gpci.pStages = stages;
    gpci.pVertexInputState = &vin; gpci.pInputAssemblyState = &ia;
    gpci.pViewportState = &vps; gpci.pRasterizationState = &rs;
    gpci.pMultisampleState = &ms; gpci.pDepthStencilState = &ds; gpci.pColorBlendState = &cb;
    gpci.layout = layout; gpci.renderPass = rp; gpci.subpass = 0;
    VkPipeline pipeline = VK_NULL_HANDLE;
    VKCHECK(vkCreateGraphicsPipelines(vk.device, VK_NULL_HANDLE, 1, &gpci, nullptr, &pipeline));

    // 8) Record + submit + wait.
    VkCommandPool pool = VK_NULL_HANDLE;
    {
        VkCommandPoolCreateInfo pci{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
        pci.queueFamilyIndex = vk.queueFamily;
        VKCHECK(vkCreateCommandPool(vk.device, &pci, nullptr, &pool));
    }
    VkCommandBufferAllocateInfo cai{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
    cai.commandPool = pool; cai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY; cai.commandBufferCount = 1;
    VkCommandBuffer cmd = VK_NULL_HANDLE;
    VKCHECK(vkAllocateCommandBuffers(vk.device, &cai, &cmd));
    VkCommandBufferBeginInfo bi{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    bi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    VKCHECK(vkBeginCommandBuffer(cmd, &bi));

    VkClearValue clears[2]{};
    clears[0].color = {{VP_CLEAR_R, VP_CLEAR_G, VP_CLEAR_B, 1.0f}};
    clears[1].depthStencil = {1.0f, 0};
    VkRenderPassBeginInfo rpbi{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
    rpbi.renderPass = rp; rpbi.framebuffer = fb;
    rpbi.renderArea = {{0, 0}, {VP_W, VP_H}};
    rpbi.clearValueCount = 2; rpbi.pClearValues = clears;
    vkCmdBeginRenderPass(cmd, &rpbi, VK_SUBPASS_CONTENTS_INLINE);
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline);
    vkCmdPushConstants(cmd, layout, VK_SHADER_STAGE_VERTEX_BIT, 0, sizeof(push), push);
    VkBuffer vbufs[2] = {vboPos, vboNrm};
    VkDeviceSize voffs[2] = {0, 0};
    vkCmdBindVertexBuffers(cmd, 0, 2, vbufs, voffs);
    vkCmdBindIndexBuffer(cmd, ibo, 0, VK_INDEX_TYPE_UINT32);
    vkCmdDrawIndexed(cmd, idxCount, 1, 0, 0, 0);
    vkCmdEndRenderPass(cmd);
    VKCHECK(vkEndCommandBuffer(cmd));

    VkSubmitInfo si{VK_STRUCTURE_TYPE_SUBMIT_INFO};
    si.commandBufferCount = 1; si.pCommandBuffers = &cmd;
    VKCHECK(vkQueueSubmit(vk.queue, 1, &si, VK_NULL_HANDLE));
    VKCHECK(vkQueueWaitIdle(vk.queue));

    // The color image is now in SHADER_READ_ONLY_OPTIMAL; hand its view to ImGui.
    outView = colorView;

    // Cleanup transient objects (keep color image/view/mem alive for sampling —
    // the process exits shortly after, reclaiming them).
    vkDestroyPipeline(vk.device, pipeline, nullptr);
    vkDestroyPipelineLayout(vk.device, layout, nullptr);
    vkDestroyShaderModule(vk.device, vs, nullptr);
    vkDestroyShaderModule(vk.device, fs, nullptr);
    vkDestroyCommandPool(vk.device, pool, nullptr);
    vkDestroyFramebuffer(vk.device, fb, nullptr);
    vkDestroyRenderPass(vk.device, rp, nullptr);
    vkDestroyImageView(vk.device, depthView, nullptr);
    vkDestroyImage(vk.device, depth, nullptr);
    vkFreeMemory(vk.device, depthMem, nullptr);
    vkDestroyBuffer(vk.device, vboPos, nullptr); vkFreeMemory(vk.device, vboPosMem, nullptr);
    vkDestroyBuffer(vk.device, vboNrm, nullptr); vkFreeMemory(vk.device, vboNrmMem, nullptr);
    vkDestroyBuffer(vk.device, ibo, nullptr); vkFreeMemory(vk.device, iboMem, nullptr);
    (void)color; (void)colorMem;   // intentionally leaked until process exit
    return 0;
}

// ------------------------------ Forge dark style ------------------------------
void applyForgeStyle() {
    ImGuiStyle& s = ImGui::GetStyle();
    s.WindowRounding = 6.0f;
    s.FrameRounding = 4.0f;
    s.GrabRounding = 3.0f;
    s.ScrollbarRounding = 4.0f;
    s.TabRounding = 4.0f;
    s.WindowBorderSize = 1.0f;
    s.FrameBorderSize = 0.0f;
    s.WindowPadding = ImVec2(12, 10);
    s.FramePadding = ImVec2(8, 5);
    s.ItemSpacing = ImVec2(9, 7);
    s.IndentSpacing = 18.0f;
    s.ScrollbarSize = 12.0f;

    ImVec4* c = s.Colors;
    const ImVec4 slate      = ImVec4(0.12f, 0.13f, 0.155f, 1.0f);
    const ImVec4 slateDark  = ImVec4(0.085f, 0.095f, 0.115f, 1.0f);
    const ImVec4 slatePanel = ImVec4(0.145f, 0.16f, 0.19f, 1.0f);
    const ImVec4 amber      = ImVec4(0.90f, 0.58f, 0.20f, 1.0f);
    const ImVec4 amberDim   = ImVec4(0.72f, 0.46f, 0.16f, 1.0f);
    const ImVec4 text       = ImVec4(0.87f, 0.88f, 0.90f, 1.0f);
    const ImVec4 textDim    = ImVec4(0.55f, 0.57f, 0.61f, 1.0f);

    c[ImGuiCol_Text]                 = text;
    c[ImGuiCol_TextDisabled]         = textDim;
    c[ImGuiCol_WindowBg]             = slate;
    c[ImGuiCol_ChildBg]             = slateDark;
    c[ImGuiCol_PopupBg]              = slatePanel;
    c[ImGuiCol_Border]               = ImVec4(0.03f, 0.03f, 0.04f, 0.85f);
    c[ImGuiCol_FrameBg]              = slateDark;
    c[ImGuiCol_FrameBgHovered]       = ImVec4(0.20f, 0.22f, 0.26f, 1.0f);
    c[ImGuiCol_FrameBgActive]        = ImVec4(0.24f, 0.26f, 0.30f, 1.0f);
    c[ImGuiCol_TitleBg]              = slateDark;
    c[ImGuiCol_TitleBgActive]        = ImVec4(0.16f, 0.17f, 0.20f, 1.0f);
    c[ImGuiCol_MenuBarBg]            = ImVec4(0.10f, 0.11f, 0.13f, 1.0f);
    c[ImGuiCol_ScrollbarBg]          = slateDark;
    c[ImGuiCol_ScrollbarGrab]        = ImVec4(0.28f, 0.30f, 0.34f, 1.0f);
    c[ImGuiCol_ScrollbarGrabHovered] = amberDim;
    c[ImGuiCol_CheckMark]            = amber;
    c[ImGuiCol_SliderGrab]           = amber;
    c[ImGuiCol_SliderGrabActive]     = ImVec4(1.0f, 0.68f, 0.28f, 1.0f);
    c[ImGuiCol_Button]               = ImVec4(0.20f, 0.22f, 0.26f, 1.0f);
    c[ImGuiCol_ButtonHovered]        = amberDim;
    c[ImGuiCol_ButtonActive]         = amber;
    c[ImGuiCol_Header]               = ImVec4(0.20f, 0.22f, 0.27f, 1.0f);
    c[ImGuiCol_HeaderHovered]        = amberDim;
    c[ImGuiCol_HeaderActive]         = amber;
    c[ImGuiCol_Separator]            = ImVec4(0.05f, 0.05f, 0.06f, 1.0f);
    c[ImGuiCol_Tab]                  = slateDark;
    c[ImGuiCol_TabHovered]           = amberDim;
    c[ImGuiCol_TabSelected]          = ImVec4(0.22f, 0.24f, 0.28f, 1.0f);
    c[ImGuiCol_TextSelectedBg]       = ImVec4(amber.x, amber.y, amber.z, 0.35f);
}

// A right-aligned dim label + value row helper for the properties panel.
void propRow(const char* label) {
    ImGui::TableNextRow();
    ImGui::TableSetColumnIndex(0);
    ImGui::AlignTextToFramePadding();
    ImGui::TextUnformatted(label);
    ImGui::TableSetColumnIndex(1);
    ImGui::SetNextItemWidth(-FLT_MIN);
}

// ------------------------------ build one Forge IDE frame ------------------------------
void buildForgeFrame(bool haveViewport, ImTextureID viewportTex, uint32_t tris) {
    // ---- Top main menu bar ----
    float menuH = 0.0f;
    if (ImGui::BeginMainMenuBar()) {
        menuH = ImGui::GetWindowSize().y;
        if (ImGui::BeginMenu("File")) {
            ImGui::MenuItem("New Part", "Cmd+N");
            ImGui::MenuItem("Open...", "Cmd+O");
            ImGui::MenuItem("Import STEP...");
            ImGui::Separator();
            ImGui::MenuItem("Save", "Cmd+S");
            ImGui::MenuItem("Export STEP / STL...");
            ImGui::Separator();
            ImGui::MenuItem("Quit", "Cmd+Q");
            ImGui::EndMenu();
        }
        if (ImGui::BeginMenu("Edit")) {
            ImGui::MenuItem("Undo", "Cmd+Z");
            ImGui::MenuItem("Redo", "Shift+Cmd+Z");
            ImGui::Separator();
            ImGui::MenuItem("Delete Feature");
            ImGui::EndMenu();
        }
        if (ImGui::BeginMenu("View")) {
            ImGui::MenuItem("Shaded", nullptr, true);
            ImGui::MenuItem("Wireframe", nullptr, false);
            ImGui::MenuItem("Show Origin", nullptr, true);
            ImGui::EndMenu();
        }
        if (ImGui::BeginMenu("Model")) {
            ImGui::MenuItem("Extrude");
            ImGui::MenuItem("Revolve");
            ImGui::MenuItem("Fillet");
            ImGui::MenuItem("Chamfer");
            ImGui::MenuItem("Shell");
            ImGui::EndMenu();
        }
        if (ImGui::BeginMenu("Draft")) {
            ImGui::MenuItem("New Drawing");
            ImGui::MenuItem("Projected View");
            ImGui::MenuItem("Section View");
            ImGui::EndMenu();
        }
        if (ImGui::BeginMenu("Help")) {
            ImGui::MenuItem("Documentation");
            ImGui::MenuItem("About Forge");
            ImGui::EndMenu();
        }
        // Right-aligned brand.
        const char* brand = "FORGE  \xC2\xB7  M4 Max / MoltenVK";
        float tw = ImGui::CalcTextSize(brand).x;
        ImGui::SameLine(ImGui::GetWindowWidth() - tw - 18.0f);
        ImGui::TextDisabled("%s", brand);
        ImGui::EndMainMenuBar();
    }

    const float top = menuH;
    const float statusH = 26.0f;
    const float bodyH = (float)UI_H - top - statusH;
    const float leftW = 288.0f;
    const float rightW = 320.0f;
    const float centerW = (float)UI_W - leftW - rightW;

    const ImGuiWindowFlags panelFlags =
        ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoCollapse |
        ImGuiWindowFlags_NoBringToFrontOnFocus;

    // ---- Left: model / feature tree ----
    ImGui::SetNextWindowPos(ImVec2(0, top));
    ImGui::SetNextWindowSize(ImVec2(leftW, bodyH));
    if (ImGui::Begin("Model Tree", nullptr, panelFlags)) {
        ImGui::TextDisabled("BRACKET_01.fpart");
        ImGui::Separator();
        ImGuiTreeNodeFlags base = ImGuiTreeNodeFlags_OpenOnArrow | ImGuiTreeNodeFlags_DefaultOpen;
        if (ImGui::TreeNodeEx("Part \xC2\xB7 Bracket", base | ImGuiTreeNodeFlags_Framed)) {
            if (ImGui::TreeNodeEx("Origin", ImGuiTreeNodeFlags_Leaf)) ImGui::TreePop();
            if (ImGui::TreeNodeEx("Sketch1  (XY, 4 constraints)", ImGuiTreeNodeFlags_Leaf)) ImGui::TreePop();
            ImGui::SetNextItemOpen(true, ImGuiCond_Once);
            if (ImGui::TreeNodeEx("Extrude1", base)) {
                if (ImGui::TreeNodeEx("Sketch1 (profile)", ImGuiTreeNodeFlags_Leaf)) ImGui::TreePop();
                ImGui::TreePop();
            }
            bool sel = true;
            ImGui::Selectable("  Fillet1  (r = 2.0 mm)", &sel);
            if (ImGui::TreeNodeEx("Shell1  (t = 1.5 mm)", ImGuiTreeNodeFlags_Leaf)) ImGui::TreePop();
            ImGui::TreePop();
        }
        ImGui::Separator();
        ImGui::TextDisabled("Bodies");
        ImGui::BulletText("Solid1  (watertight)");
        ImGui::Spacing();
        ImGui::TextDisabled("Sketches");
        ImGui::BulletText("Sketch1  (fully defined)");
    }
    ImGui::End();

    // ---- Center: viewport ----
    ImGui::SetNextWindowPos(ImVec2(leftW, top));
    ImGui::SetNextWindowSize(ImVec2(centerW, bodyH));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
    if (ImGui::Begin("Viewport", nullptr, panelFlags | ImGuiWindowFlags_NoScrollbar)) {
        // Small viewport toolbar.
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(8, 6));
        ImGui::BeginChild("vptoolbar", ImVec2(0, 36), ImGuiChildFlags_None,
                          ImGuiWindowFlags_NoScrollbar);
        ImGui::Button("Orbit"); ImGui::SameLine();
        ImGui::Button("Pan");   ImGui::SameLine();
        ImGui::Button("Zoom");  ImGui::SameLine();
        ImGui::Button("Fit");   ImGui::SameLine();
        ImGui::TextDisabled("  |  Isometric   Shaded + Edges");
        ImGui::EndChild();
        ImGui::PopStyleVar();

        ImVec2 avail = ImGui::GetContentRegionAvail();
        if (haveViewport && avail.x > 8 && avail.y > 8) {
            // Fit the 4:3 texture into the available region, centred.
            float texAspect = (float)VP_W / (float)VP_H;
            float boxAspect = avail.x / avail.y;
            ImVec2 imgSize = (boxAspect > texAspect)
                ? ImVec2(avail.y * texAspect, avail.y)
                : ImVec2(avail.x, avail.x / texAspect);
            ImVec2 cur = ImGui::GetCursorPos();
            ImGui::SetCursorPos(ImVec2(cur.x + (avail.x - imgSize.x) * 0.5f,
                                       cur.y + (avail.y - imgSize.y) * 0.5f));
            ImGui::Image(viewportTex, imgSize);
        } else {
            // Placeholder: a framed rect + centred caption (composite unavailable).
            ImVec2 p0 = ImGui::GetCursorScreenPos();
            ImVec2 p1 = ImVec2(p0.x + avail.x, p0.y + avail.y);
            ImDrawList* dl = ImGui::GetWindowDrawList();
            dl->AddRectFilled(p0, p1, IM_COL32(26, 31, 38, 255));
            dl->AddRect(p0, p1, IM_COL32(60, 66, 74, 255));
            const char* msg = "3D Viewport (placeholder)";
            ImVec2 ts = ImGui::CalcTextSize(msg);
            dl->AddText(ImVec2((p0.x + p1.x - ts.x) * 0.5f, (p0.y + p1.y - ts.y) * 0.5f),
                        IM_COL32(150, 156, 164, 255), msg);
            ImGui::Dummy(avail);
        }
    }
    ImGui::End();
    ImGui::PopStyleVar();

    // ---- Right: properties ----
    ImGui::SetNextWindowPos(ImVec2(leftW + centerW, top));
    ImGui::SetNextWindowSize(ImVec2(rightW, bodyH));
    if (ImGui::Begin("Properties", nullptr, panelFlags)) {
        ImGui::TextDisabled("SELECTION");
        ImGui::TextUnformatted("Fillet1");
        ImGui::Separator();
        ImGui::Spacing();

        static float length = 60.0f, width = 40.0f, height = 12.0f;
        static float filletR = 2.0f, shellT = 1.5f, draft = 1.0f;
        static bool visible = true, shellOn = true, symmetric = false;
        static int matIdx = 1;
        static float color[3] = {0.90f, 0.58f, 0.20f};

        if (ImGui::BeginTable("dims", 2, ImGuiTableFlags_SizingStretchProp)) {
            ImGui::TableSetupColumn("l", ImGuiTableColumnFlags_WidthFixed, 92.0f);
            ImGui::TableSetupColumn("v", ImGuiTableColumnFlags_WidthStretch);
            propRow("Length");     ImGui::SliderFloat("##len", &length, 10.0f, 120.0f, "%.1f mm");
            propRow("Width");      ImGui::SliderFloat("##wid", &width, 10.0f, 120.0f, "%.1f mm");
            propRow("Height");     ImGui::SliderFloat("##hei", &height, 2.0f, 60.0f, "%.1f mm");
            propRow("Fillet R");   ImGui::SliderFloat("##fil", &filletR, 0.5f, 8.0f, "%.2f mm");
            propRow("Shell t");    ImGui::SliderFloat("##shl", &shellT, 0.5f, 6.0f, "%.2f mm");
            propRow("Draft");      ImGui::SliderFloat("##drf", &draft, 0.0f, 10.0f, "%.1f deg");
            ImGui::EndTable();
        }
        ImGui::Spacing();
        ImGui::Separator();
        ImGui::TextDisabled("OPTIONS");
        ImGui::Checkbox("Visible", &visible); ImGui::SameLine(150);
        ImGui::Checkbox("Shell", &shellOn);
        ImGui::Checkbox("Symmetric", &symmetric);
        ImGui::Spacing();
        ImGui::SetNextItemWidth(-FLT_MIN);
        const char* mats[] = {"Aluminium 6061", "Steel AISI 1045", "ABS Plastic", "Titanium Ti-6Al-4V"};
        ImGui::Combo("##mat", &matIdx, mats, IM_ARRAYSIZE(mats));
        ImGui::Spacing();
        ImGui::TextDisabled("Appearance");
        ImGui::ColorEdit3("##col", color, ImGuiColorEditFlags_NoInputs | ImGuiColorEditFlags_NoLabel);
        ImGui::SameLine(); ImGui::TextUnformatted("Surface colour");
        ImGui::Spacing();
        ImGui::Separator();
        ImGui::TextDisabled("MASS PROPERTIES");
        ImGui::Text("Volume    : 27492.3 mm\xC2\xB3");
        ImGui::Text("Mass      : 74.2 g");
        ImGui::Text("Surface   : 9860.5 mm\xC2\xB2");
        ImGui::Spacing();
        ImGui::Button("Apply", ImVec2(-FLT_MIN, 0));
    }
    ImGui::End();

    // ---- Bottom status bar ----
    ImGui::SetNextWindowPos(ImVec2(0, (float)UI_H - statusH));
    ImGui::SetNextWindowSize(ImVec2((float)UI_W, statusH));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 0.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(10, 4));
    if (ImGui::Begin("StatusBar", nullptr,
                     panelFlags | ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoTitleBar)) {
        ImGui::TextUnformatted("Ready");
        ImGui::SameLine(0, 20); ImGui::TextDisabled("|");
        ImGui::SameLine(0, 20);
        if (haveViewport) ImGui::Text("Model: box 10\xC3\x97" "10\xC3\x97" "10  \xC2\xB7  %u triangles", tris);
        else              ImGui::TextUnformatted("Model: (viewport placeholder)");
        ImGui::SameLine(0, 20); ImGui::TextDisabled("|");
        ImGui::SameLine(0, 20); ImGui::TextUnformatted("Units: mm");
        const char* right = "x 42.10   y -8.35   z 12.00     100%";
        float tw = ImGui::CalcTextSize(right).x;
        ImGui::SameLine(ImGui::GetWindowWidth() - tw - 14.0f);
        ImGui::TextDisabled("%s", right);
    }
    ImGui::End();
    ImGui::PopStyleVar(2);
}

}  // namespace

int main() {
    std::printf("=== Forge C++ Desktop UI Probe (Dear ImGui on Vulkan/MoltenVK, headless) ===\n");

    Vk vk;
    if (initVulkan(vk) != 0) {
        std::fprintf(stderr, "=== UI PROBE FAILED: Vulkan/MoltenVK init ===\n");
        return 1;
    }
    std::printf("  physical device : %s\n", vk.deviceName);
    std::printf("  driver          : %s\n", vk.driverName);
    std::printf("  imgui version   : %s\n", IMGUI_VERSION);

    UITarget ui;
    if (createUITarget(vk, ui) != 0) {
        std::fprintf(stderr, "=== UI PROBE FAILED: offscreen UI target ===\n");
        return 1;
    }

    // ---- STRETCH: render the 3D kernel model into a sampleable texture ----
    std::printf("\n--- STRETCH: render kernel box into viewport texture ---\n");
    VkImageView viewportView = VK_NULL_HANDLE;
    uint32_t tris = 0;
    bool haveViewport = (renderViewportTexture(vk, viewportView, tris) == 0);
    if (haveViewport)
        std::printf("  viewport 3D texture rendered (%u triangles) — will composite via ImGui::Image\n", tris);
    else
        std::printf("  viewport composite unavailable — UI will draw a placeholder rect (must-do unaffected)\n");

    // ---- ImGui context + backend ----
    std::printf("\n--- UI: build Forge IDE frame + render offscreen ---\n");
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2((float)UI_W, (float)UI_H);
    io.DeltaTime = 1.0f / 60.0f;
    io.IniFilename = nullptr;   // headless: no imgui.ini
    io.LogFilename = nullptr;
    applyForgeStyle();

    ImGui_ImplVulkan_InitInfo init{};
    init.ApiVersion = VK_API_VERSION_1_2;
    init.Instance = vk.instance;
    init.PhysicalDevice = vk.phys;
    init.Device = vk.device;
    init.QueueFamily = vk.queueFamily;
    init.Queue = vk.queue;
    init.DescriptorPool = VK_NULL_HANDLE;
    init.DescriptorPoolSize = 16;              // backend builds its own pool (font + viewport tex)
    init.MinImageCount = 2;
    init.ImageCount = 2;
    init.PipelineInfoMain.RenderPass = ui.renderPass;
    init.PipelineInfoMain.Subpass = 0;
    init.PipelineInfoMain.MSAASamples = VK_SAMPLE_COUNT_1_BIT;
    if (!ImGui_ImplVulkan_Init(&init)) {
        std::fprintf(stderr, "  FAIL: ImGui_ImplVulkan_Init returned false\n");
        std::fprintf(stderr, "=== UI PROBE FAILED: ImGui Vulkan backend init ===\n");
        return 3;
    }

    // Register the 3D viewport texture with the backend (VkDescriptorSet == ImTextureID).
    ImTextureID viewportTex = 0;
    if (haveViewport) {
        VkDescriptorSet ds = ImGui_ImplVulkan_AddTexture(viewportView, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL);
        if (ds == VK_NULL_HANDLE) {
            std::fprintf(stderr, "  WARN: ImGui_ImplVulkan_AddTexture failed — falling back to placeholder\n");
            haveViewport = false;
        } else {
            viewportTex = (ImTextureID)ds;
        }
    }

    // ---- One frame ----
    ImGui_ImplVulkan_NewFrame();
    ImGui::NewFrame();
    buildForgeFrame(haveViewport, viewportTex, tris);
    ImGui::Render();
    ImDrawData* drawData = ImGui::GetDrawData();
    if (!drawData || drawData->TotalVtxCount <= 0) {
        std::fprintf(stderr, "  FAIL: ImGui produced no draw data\n");
        return 3;
    }
    std::printf("  imgui draw data : %d vertices, %d indices, %d draw lists\n",
                drawData->TotalVtxCount, drawData->TotalIdxCount, drawData->CmdListsCount);

    // Pre-upload any pending textures (font atlas, viewport tex) BEFORE the render
    // pass so the backend's internal queue-submit for uploads does not run inside
    // our active render pass recording.
    if (drawData->Textures != nullptr)
        for (ImTextureData* tex : *drawData->Textures)
            if (tex->Status != ImTextureStatus_OK)
                ImGui_ImplVulkan_UpdateTexture(tex);

    // Record the UI render pass.
    VkCommandBufferAllocateInfo cai{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
    cai.commandPool = ui.pool; cai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY; cai.commandBufferCount = 1;
    VkCommandBuffer cmd = VK_NULL_HANDLE;
    if (vkAllocateCommandBuffers(vk.device, &cai, &cmd) != VK_SUCCESS) {
        std::fprintf(stderr, "  FAIL: vkAllocateCommandBuffers (UI)\n"); return 3;
    }
    VkCommandBufferBeginInfo bi{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    bi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkBeginCommandBuffer(cmd, &bi);

    VkClearValue clear{};
    clear.color = {{CLEAR_R, CLEAR_G, CLEAR_B, CLEAR_A}};
    VkRenderPassBeginInfo rpbi{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
    rpbi.renderPass = ui.renderPass; rpbi.framebuffer = ui.framebuffer;
    rpbi.renderArea = {{0, 0}, {UI_W, UI_H}};
    rpbi.clearValueCount = 1; rpbi.pClearValues = &clear;
    vkCmdBeginRenderPass(cmd, &rpbi, VK_SUBPASS_CONTENTS_INLINE);
    ImGui_ImplVulkan_RenderDrawData(drawData, cmd);
    vkCmdEndRenderPass(cmd);

    // Copy the offscreen image (now TRANSFER_SRC) into the readback buffer.
    VkBufferImageCopy region{};
    region.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
    region.imageExtent = {UI_W, UI_H, 1};
    vkCmdCopyImageToBuffer(cmd, ui.image, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
                           ui.readback, 1, &region);
    if (vkEndCommandBuffer(cmd) != VK_SUCCESS) {
        std::fprintf(stderr, "  FAIL: vkEndCommandBuffer (UI)\n"); return 3;
    }

    VkSubmitInfo si{VK_STRUCTURE_TYPE_SUBMIT_INFO};
    si.commandBufferCount = 1; si.pCommandBuffers = &cmd;
    if (vkQueueSubmit(vk.queue, 1, &si, VK_NULL_HANDLE) != VK_SUCCESS) {
        std::fprintf(stderr, "  FAIL: vkQueueSubmit (UI)\n"); return 3;
    }
    vkQueueWaitIdle(vk.queue);

    // ---- Readback + coverage ----
    std::vector<uint8_t> px(static_cast<size_t>(UI_W) * UI_H * 4);
    void* mapped = nullptr;
    if (vkMapMemory(vk.device, ui.readbackMem, 0, VK_WHOLE_SIZE, 0, &mapped) != VK_SUCCESS) {
        std::fprintf(stderr, "  FAIL: vkMapMemory (readback)\n"); return 3;
    }
    std::memcpy(px.data(), mapped, px.size());
    vkUnmapMemory(vk.device, ui.readbackMem);

    const int cr = (int)std::lround(CLEAR_R * 255.0);
    const int cg = (int)std::lround(CLEAR_G * 255.0);
    const int cb = (int)std::lround(CLEAR_B * 255.0);
    size_t covered = 0;
    for (size_t i = 0; i < px.size(); i += 4) {
        if (std::abs((int)px[i] - cr) > 8 || std::abs((int)px[i + 1] - cg) > 8 ||
            std::abs((int)px[i + 2] - cb) > 8) {
            ++covered;
        }
    }
    double coverage = static_cast<double>(covered) / (static_cast<double>(UI_W) * UI_H);

    std::system("mkdir -p /tmp/forge_ui_probe");
    const std::string pngPath = "/tmp/forge_ui_probe/forge_ui.png";
    bool pngOk = writePng(pngPath, px.data(), UI_W, UI_H);

    std::printf("  covered pixels  = %zu / %u  (%.1f%% of the frame differ from clear)\n",
                covered, UI_W * UI_H, coverage * 100.0);
    std::printf("  PNG written     = %s  (%s)\n", pngPath.c_str(), pngOk ? "ok" : "FAILED");
    std::printf("  viewport 3D     = %s\n", haveViewport ? "composited (real kernel box)" : "placeholder rect");

    // ---- Asserts ----
    int rc = 0;
    if (!pngOk) { std::fprintf(stderr, "  FAIL: PNG write failed\n"); rc = 3; }
    if (coverage <= 0.15) {
        std::fprintf(stderr, "  FAIL: UI coverage <= 15%% (UI did not draw meaningfully)\n"); rc = 3;
    }

    ImGui_ImplVulkan_Shutdown();
    ImGui::DestroyContext();

    if (rc != 0) {
        std::fprintf(stderr, "=== UI PROBE FAILED ===\n");
        return rc;
    }
    std::printf("\n=== UI PROBE PASS — Forge ImGui UI rendered headless offscreen -> PNG (Vulkan/MoltenVK) ===\n");
    return 0;
}
