// forge-desktop/src/ViewportRenderer.hpp
//
// The 3D viewport's GPU side: it renders the tessellated kernel body into an
// OFFSCREEN colour+depth target, then hands that target to Dear ImGui as a
// texture so the shell composites it like any other widget.
//
// Why offscreen rather than a scissored draw into the swapchain pass: the
// viewport is a PANEL inside a dock tree that the user can resize, tab away
// from, and (once floating windows land) tear onto a second monitor. A texture
// is the only representation that survives all three. It also means the geometry
// pass and the UI pass have independent depth state, which is what lets the
// overlays composite over the part without fighting its depth buffer — the
// latency argument in D-001, made structural.
//
// Everything here is VkResult-checked; a failure is reported, never assumed away.
#ifndef FORGE_DESKTOP_VIEWPORTRENDERER_HPP
#define FORGE_DESKTOP_VIEWPORTRENDERER_HPP

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include <vulkan/vulkan.h>

#include "Camera.hpp"
#include "KernelScene.hpp"

namespace forge::desktop {

class ViewportRenderer {
 public:
  // Creates the pipeline, the vertex buffer and the first offscreen target.
  bool init(VkPhysicalDevice phys, VkDevice device, VkQueue queue, std::uint32_t queueFamily,
            const std::vector<SceneVertex>& vertices);
  void destroy();

  // Re-uploads the vertex stream (used when the selection flags change).
  bool uploadVertices(const std::vector<SceneVertex>& vertices,
                      const std::vector<SceneVertex>& edgeVertices = {});

  // Ensures the offscreen target is `width` x `height`. Returns false only on a
  // real Vulkan failure; a zero-size request is a no-op that returns true.
  bool resize(std::uint32_t width, std::uint32_t height);

  // Records the geometry pass into `cmd`. Must be called OUTSIDE any render pass.
  void record(VkCommandBuffer cmd, const Camera& camera, std::uint32_t hoverFace,
              bool wireframe);

  // The ImGui texture handle for the current target, 0 until the first resize.
  std::uint64_t texture() const noexcept { return textureId_; }
  // The offscreen colour attachment itself, so the frame can be COPIED OUT and
  // asserted on. The texture handle above is a descriptor: it can be composited
  // and never read. This is the handle forge_desktop_render_gate transitions to
  // TRANSFER_SRC and copies into host memory; it is created with
  // VK_IMAGE_USAGE_TRANSFER_SRC_BIT for exactly that reason.
  VkImage colorImage() const noexcept { return color_; }
  // ★ THE USAGE FLAGS THE COLOUR IMAGE WAS ACTUALLY CREATED WITH -- the value
  // passed to vkCreateImage, not a second spelling of it. 0 when there is no
  // target. The whole render gate rests on VK_IMAGE_USAGE_TRANSFER_SRC_BIT being
  // in there, because the spec allows vkCmdCopyImageToBuffer only on an image
  // that has it. Deleting the bit from createTarget left the gate GREEN --
  // MoltenVK copied anyway -- so the enabling line of the only instrument on
  // this class was the one line nothing guarded, and a stricter driver would
  // have failed every pixel check at once instead. The gate asserts the bit.
  VkImageUsageFlags colorImageUsage() const noexcept { return colorUsage_; }
  std::uint32_t width() const noexcept { return width_; }
  std::uint32_t height() const noexcept { return height_; }
  std::uint32_t triangleCount() const noexcept { return triangles_; }
  const std::string& error() const noexcept { return error_; }

 private:
  bool createTarget(std::uint32_t width, std::uint32_t height);
  void destroyTarget();
  bool createPipeline();
  std::uint32_t findMemoryType(std::uint32_t bits, VkMemoryPropertyFlags want) const;

  VkPhysicalDevice phys_ = VK_NULL_HANDLE;
  VkDevice device_ = VK_NULL_HANDLE;
  VkQueue queue_ = VK_NULL_HANDLE;
  std::uint32_t queueFamily_ = 0;

  VkRenderPass renderPass_ = VK_NULL_HANDLE;
  VkPipelineLayout layout_ = VK_NULL_HANDLE;
  VkPipeline pipelineSolid_ = VK_NULL_HANDLE;
  VkPipeline pipelineWire_ = VK_NULL_HANDLE;
  VkPipeline pipelineLine_ = VK_NULL_HANDLE;
  VkSampler sampler_ = VK_NULL_HANDLE;

  VkImage color_ = VK_NULL_HANDLE;
  VkImageUsageFlags colorUsage_ = 0;
  VkDeviceMemory colorMem_ = VK_NULL_HANDLE;
  VkImageView colorView_ = VK_NULL_HANDLE;
  VkImage depth_ = VK_NULL_HANDLE;
  VkDeviceMemory depthMem_ = VK_NULL_HANDLE;
  VkImageView depthView_ = VK_NULL_HANDLE;
  VkFramebuffer framebuffer_ = VK_NULL_HANDLE;
  VkDescriptorSet descriptor_ = VK_NULL_HANDLE;

  VkBuffer vbo_ = VK_NULL_HANDLE;
  VkDeviceMemory vboMem_ = VK_NULL_HANDLE;
  VkDeviceSize vboBytes_ = 0;
  void* vboMapped_ = nullptr;

  VkBuffer vboEdges_ = VK_NULL_HANDLE;
  VkDeviceMemory vboEdgesMem_ = VK_NULL_HANDLE;
  VkDeviceSize vboEdgesBytes_ = 0;
  void* vboEdgesMapped_ = nullptr;
  std::uint32_t edgeLines_ = 0;


  std::uint32_t width_ = 0;
  std::uint32_t height_ = 0;
  std::uint32_t triangles_ = 0;
  std::uint64_t textureId_ = 0;
  std::string error_;
};

// ── THE SHADER SOURCES THE SPIR-V IN THIS BINARY WAS COMPILED FROM ─────────
// ★ The generated .spv.h headers ViewportRenderer.cpp includes are build
// products of a timestamp-driven rule, and a timestamp rule can be defeated:
// touch the header, restore a shader with an older mtime (cp -p, rsync -t, an
// unpacked archive), and glslang is skipped while the binary keeps the previous
// shader. MEASURED before this existed: with kEdgeDepthBias = 0.0 in the tree --
// the exact defect forge_desktop_render_gate exists for -- and a touched header,
// the gate printed "36 checks, 0 failed. RENDER GATE PASS".
//
// So each header now carries the bytes glslang was handed, written by the same
// build command (forge-desktop/cmake/embed_shader_source.cmake), and these two
// functions expose them FROM THE TRANSLATION UNIT THAT CREATES THE SHADER
// MODULES. The gate compares them with shaders/viewport_solid.{vert,frag} on
// disk and goes red on any difference, so "the gate measures the shipped
// shader" is a check rather than a habit.
std::string_view viewportSolidVertCompiledSource() noexcept;
std::string_view viewportSolidFragCompiledSource() noexcept;

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_VIEWPORTRENDERER_HPP
