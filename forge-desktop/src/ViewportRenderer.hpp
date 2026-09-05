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

}  // namespace forge::desktop

#endif  // FORGE_DESKTOP_VIEWPORTRENDERER_HPP
