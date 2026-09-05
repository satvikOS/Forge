#include "ViewportRenderer.hpp"

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include <vulkan/vulkan.h>

#include "imgui.h"
#include "imgui_impl_vulkan.h"

#include "Camera.hpp"
#include "KernelScene.hpp"

// SPIR-V, produced from shaders/viewport_solid.{vert,frag} by glslangValidator
// at build time (see forge-desktop/CMakeLists.txt).
#include "viewport_solid_frag.spv.h"
#include "viewport_solid_vert.spv.h"

namespace forge::desktop {
namespace {

constexpr VkFormat kColorFormat = VK_FORMAT_R8G8B8A8_UNORM;
constexpr VkFormat kDepthFormat = VK_FORMAT_D32_SFLOAT;

// The push-constant block, byte-for-byte the `PushConstants` in both shaders.
struct PushBlock {
  float mvp[16];
  float nrm[16];
  std::uint32_t hoverFace;
  std::uint32_t shadingMode;
  std::uint32_t pad0;
  std::uint32_t pad1;
};
static_assert(sizeof(PushBlock) == 144, "push block must match the GLSL layout");

}  // namespace

std::uint32_t ViewportRenderer::findMemoryType(std::uint32_t bits,
                                               VkMemoryPropertyFlags want) const {
  VkPhysicalDeviceMemoryProperties props{};
  vkGetPhysicalDeviceMemoryProperties(phys_, &props);
  for (std::uint32_t i = 0; i < props.memoryTypeCount; ++i) {
    if ((bits & (1u << i)) && (props.memoryTypes[i].propertyFlags & want) == want) return i;
  }
  return UINT32_MAX;
}

bool ViewportRenderer::init(VkPhysicalDevice phys, VkDevice device, VkQueue queue,
                            std::uint32_t queueFamily,
                            const std::vector<SceneVertex>& vertices) {
  phys_ = phys;
  device_ = device;
  queue_ = queue;
  queueFamily_ = queueFamily;

  // ── render pass: colour -> SHADER_READ_ONLY, so ImGui can sample it ───────
  VkAttachmentDescription attachments[2]{};
  attachments[0].format = kColorFormat;
  attachments[0].samples = VK_SAMPLE_COUNT_1_BIT;
  attachments[0].loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
  attachments[0].storeOp = VK_ATTACHMENT_STORE_OP_STORE;
  attachments[0].stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
  attachments[0].stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
  attachments[0].initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
  attachments[0].finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
  attachments[1].format = kDepthFormat;
  attachments[1].samples = VK_SAMPLE_COUNT_1_BIT;
  attachments[1].loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
  attachments[1].storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
  attachments[1].stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
  attachments[1].stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
  attachments[1].initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
  attachments[1].finalLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

  VkAttachmentReference colorRef{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
  VkAttachmentReference depthRef{1, VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL};
  VkSubpassDescription subpass{};
  subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
  subpass.colorAttachmentCount = 1;
  subpass.pColorAttachments = &colorRef;
  subpass.pDepthStencilAttachment = &depthRef;

  // Two dependencies: the pass must not begin before a previous frame's sampling
  // of this image is done, and the UI pass must not sample it before this pass
  // has written it. Without the second, the viewport tears on the first frame
  // after a resize on a tiler like Apple's.
  VkSubpassDependency deps[2]{};
  deps[0].srcSubpass = VK_SUBPASS_EXTERNAL;
  deps[0].dstSubpass = 0;
  deps[0].srcStageMask = VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
  deps[0].dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
  deps[0].srcAccessMask = VK_ACCESS_SHADER_READ_BIT;
  deps[0].dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
  deps[0].dependencyFlags = VK_DEPENDENCY_BY_REGION_BIT;
  deps[1].srcSubpass = 0;
  deps[1].dstSubpass = VK_SUBPASS_EXTERNAL;
  deps[1].srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
  deps[1].dstStageMask = VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
  deps[1].srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
  deps[1].dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
  deps[1].dependencyFlags = VK_DEPENDENCY_BY_REGION_BIT;

  VkRenderPassCreateInfo rp{};
  rp.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
  rp.attachmentCount = 2;
  rp.pAttachments = attachments;
  rp.subpassCount = 1;
  rp.pSubpasses = &subpass;
  rp.dependencyCount = 2;
  rp.pDependencies = deps;
  if (vkCreateRenderPass(device_, &rp, nullptr, &renderPass_) != VK_SUCCESS) {
    error_ = "vkCreateRenderPass failed";
    return false;
  }

  VkSamplerCreateInfo si{};
  si.sType = VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO;
  si.magFilter = VK_FILTER_LINEAR;
  si.minFilter = VK_FILTER_LINEAR;
  si.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
  si.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
  si.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
  si.maxLod = 1.0f;
  if (vkCreateSampler(device_, &si, nullptr, &sampler_) != VK_SUCCESS) {
    error_ = "vkCreateSampler failed";
    return false;
  }

  if (!createPipeline()) return false;
  if (!uploadVertices(vertices)) return false;
  return true;
}

bool ViewportRenderer::createPipeline() {
  VkShaderModuleCreateInfo vs{};
  vs.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
  vs.codeSize = sizeof(viewportSolidVertSpv);
  vs.pCode = viewportSolidVertSpv;
  VkShaderModule vertModule = VK_NULL_HANDLE;
  if (vkCreateShaderModule(device_, &vs, nullptr, &vertModule) != VK_SUCCESS) {
    error_ = "vkCreateShaderModule(vert) failed";
    return false;
  }
  VkShaderModuleCreateInfo fs{};
  fs.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
  fs.codeSize = sizeof(viewportSolidFragSpv);
  fs.pCode = viewportSolidFragSpv;
  VkShaderModule fragModule = VK_NULL_HANDLE;
  if (vkCreateShaderModule(device_, &fs, nullptr, &fragModule) != VK_SUCCESS) {
    vkDestroyShaderModule(device_, vertModule, nullptr);
    error_ = "vkCreateShaderModule(frag) failed";
    return false;
  }

  VkPushConstantRange pcr{};
  pcr.stageFlags = VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT;
  pcr.offset = 0;
  pcr.size = sizeof(PushBlock);
  VkPipelineLayoutCreateInfo pl{};
  pl.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
  pl.pushConstantRangeCount = 1;
  pl.pPushConstantRanges = &pcr;
  if (vkCreatePipelineLayout(device_, &pl, nullptr, &layout_) != VK_SUCCESS) {
    vkDestroyShaderModule(device_, vertModule, nullptr);
    vkDestroyShaderModule(device_, fragModule, nullptr);
    error_ = "vkCreatePipelineLayout failed";
    return false;
  }

  VkPipelineShaderStageCreateInfo stages[2]{};
  stages[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
  stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
  stages[0].module = vertModule;
  stages[0].pName = "main";
  stages[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
  stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
  stages[1].module = fragModule;
  stages[1].pName = "main";

  VkVertexInputBindingDescription binding{};
  binding.binding = 0;
  binding.stride = sizeof(SceneVertex);
  binding.inputRate = VK_VERTEX_INPUT_RATE_VERTEX;
  VkVertexInputAttributeDescription attrs[4]{};
  attrs[0] = {0, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(SceneVertex, px)};
  attrs[1] = {1, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(SceneVertex, nx)};
  attrs[2] = {2, 0, VK_FORMAT_R32_UINT, offsetof(SceneVertex, faceId)};
  attrs[3] = {3, 0, VK_FORMAT_R32_UINT, offsetof(SceneVertex, flags)};

  VkPipelineVertexInputStateCreateInfo vi{};
  vi.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
  vi.vertexBindingDescriptionCount = 1;
  vi.pVertexBindingDescriptions = &binding;
  vi.vertexAttributeDescriptionCount = 4;
  vi.pVertexAttributeDescriptions = attrs;

  VkPipelineInputAssemblyStateCreateInfo ia{};
  ia.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
  ia.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;

  VkPipelineViewportStateCreateInfo vp{};
  vp.sType = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO;
  vp.viewportCount = 1;
  vp.scissorCount = 1;

  VkPipelineRasterizationStateCreateInfo rs{};
  rs.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
  rs.polygonMode = VK_POLYGON_MODE_FILL;
  // NO back-face culling. A CAD viewport must show the inside of a shelled or
  // cut body; culling would make a bore's far wall vanish, which reads as a
  // kernel bug and is not one.
  rs.cullMode = VK_CULL_MODE_NONE;
  rs.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
  rs.lineWidth = 1.0f;

  VkPipelineMultisampleStateCreateInfo ms{};
  ms.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
  ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

  VkPipelineDepthStencilStateCreateInfo ds{};
  ds.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
  ds.depthTestEnable = VK_TRUE;
  ds.depthWriteEnable = VK_TRUE;
  ds.depthCompareOp = VK_COMPARE_OP_LESS_OR_EQUAL;
  ds.maxDepthBounds = 1.0f;

  VkPipelineColorBlendAttachmentState cba{};
  cba.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT |
                       VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
  VkPipelineColorBlendStateCreateInfo cb{};
  cb.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
  cb.attachmentCount = 1;
  cb.pAttachments = &cba;

  const VkDynamicState dyn[] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
  VkPipelineDynamicStateCreateInfo dsi{};
  dsi.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
  dsi.dynamicStateCount = 2;
  dsi.pDynamicStates = dyn;

  VkGraphicsPipelineCreateInfo gp{};
  gp.sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
  gp.stageCount = 2;
  gp.pStages = stages;
  gp.pVertexInputState = &vi;
  gp.pInputAssemblyState = &ia;
  gp.pViewportState = &vp;
  gp.pRasterizationState = &rs;
  gp.pMultisampleState = &ms;
  gp.pDepthStencilState = &ds;
  gp.pColorBlendState = &cb;
  gp.pDynamicState = &dsi;
  gp.layout = layout_;
  gp.renderPass = renderPass_;
  gp.subpass = 0;

  bool ok = vkCreateGraphicsPipelines(device_, VK_NULL_HANDLE, 1, &gp, nullptr,
                                      &pipelineSolid_) == VK_SUCCESS;

  // A second pipeline for the wireframe display style. MoltenVK does not support
  // VK_POLYGON_MODE_LINE (Metal has no equivalent fill mode), so a wireframe
  // request falls back to the solid pipeline rather than creating a pipeline the
  // driver will reject. Recorded honestly instead of pretending to have it.
  VkPhysicalDeviceFeatures feats{};
  vkGetPhysicalDeviceFeatures(phys_, &feats);
  if (ok && feats.fillModeNonSolid) {
    VkPipelineRasterizationStateCreateInfo wrs = rs;
    wrs.polygonMode = VK_POLYGON_MODE_LINE;
    VkGraphicsPipelineCreateInfo wgp = gp;
    wgp.pRasterizationState = &wrs;
    if (vkCreateGraphicsPipelines(device_, VK_NULL_HANDLE, 1, &wgp, nullptr,
                                  &pipelineWire_) != VK_SUCCESS) {
      pipelineWire_ = VK_NULL_HANDLE;
    }
  }

  // ── CAD feature edge line pipeline (VK_PRIMITIVE_TOPOLOGY_LINE_LIST) ───
  // Line topology does not require fillModeNonSolid and works across all platforms.
  if (ok) {
    VkPipelineInputAssemblyStateCreateInfo lineIa = ia;
    lineIa.topology = VK_PRIMITIVE_TOPOLOGY_LINE_LIST;

    VkPipelineRasterizationStateCreateInfo lineRs = rs;
    lineRs.polygonMode = VK_POLYGON_MODE_FILL;
    lineRs.depthBiasEnable = VK_TRUE;
    lineRs.depthBiasConstantFactor = -2.0f;
    lineRs.depthBiasSlopeFactor = -2.0f;
    lineRs.lineWidth = 1.0f;

    VkPipelineDepthStencilStateCreateInfo lineDs = ds;
    lineDs.depthTestEnable = VK_TRUE;
    lineDs.depthWriteEnable = VK_FALSE;
    lineDs.depthCompareOp = VK_COMPARE_OP_LESS_OR_EQUAL;

    VkGraphicsPipelineCreateInfo lgp = gp;
    lgp.pInputAssemblyState = &lineIa;
    lgp.pRasterizationState = &lineRs;
    lgp.pDepthStencilState = &lineDs;

    if (vkCreateGraphicsPipelines(device_, VK_NULL_HANDLE, 1, &lgp, nullptr,
                                  &pipelineLine_) != VK_SUCCESS) {
      pipelineLine_ = VK_NULL_HANDLE;
    }
  }


  vkDestroyShaderModule(device_, vertModule, nullptr);
  vkDestroyShaderModule(device_, fragModule, nullptr);
  if (!ok) error_ = "vkCreateGraphicsPipelines failed";
  return ok;
}

bool ViewportRenderer::uploadVertices(const std::vector<SceneVertex>& vertices,
                                      const std::vector<SceneVertex>& edgeVertices) {
  triangles_ = static_cast<std::uint32_t>(vertices.size() / 3);
  if (!vertices.empty()) {
    const VkDeviceSize bytes = vertices.size() * sizeof(SceneVertex);

    if (vbo_ == VK_NULL_HANDLE || bytes > vboBytes_) {
      if (vboMapped_ != nullptr) {
        vkUnmapMemory(device_, vboMem_);
        vboMapped_ = nullptr;
      }
      if (vbo_ != VK_NULL_HANDLE) vkDestroyBuffer(device_, vbo_, nullptr);
      if (vboMem_ != VK_NULL_HANDLE) vkFreeMemory(device_, vboMem_, nullptr);

      VkBufferCreateInfo bi{};
      bi.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
      bi.size = bytes;
      bi.usage = VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;
      bi.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
      if (vkCreateBuffer(device_, &bi, nullptr, &vbo_) != VK_SUCCESS) {
        error_ = "vkCreateBuffer(vertex) failed";
        return false;
      }
      VkMemoryRequirements mr{};
      vkGetBufferMemoryRequirements(device_, vbo_, &mr);
      VkMemoryAllocateInfo ai{};
      ai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
      ai.allocationSize = mr.size;
      ai.memoryTypeIndex = findMemoryType(mr.memoryTypeBits,
                                          VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                                              VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
      if (ai.memoryTypeIndex == UINT32_MAX) {
        error_ = "no host-visible memory type for the vertex buffer";
        return false;
      }
      if (vkAllocateMemory(device_, &ai, nullptr, &vboMem_) != VK_SUCCESS) {
        error_ = "vkAllocateMemory(vertex) failed";
        return false;
      }
      vkBindBufferMemory(device_, vbo_, vboMem_, 0);
      vboBytes_ = mr.size;
      if (vkMapMemory(device_, vboMem_, 0, VK_WHOLE_SIZE, 0, &vboMapped_) != VK_SUCCESS) {
        error_ = "vkMapMemory(vertex) failed";
        vboMapped_ = nullptr;
        return false;
      }
    }
    std::memcpy(vboMapped_, vertices.data(), static_cast<std::size_t>(bytes));
  }

  // Upload edge lines if present
  edgeLines_ = static_cast<std::uint32_t>(edgeVertices.size() / 2);
  if (!edgeVertices.empty()) {
    const VkDeviceSize edgeBytes = edgeVertices.size() * sizeof(SceneVertex);
    if (vboEdges_ == VK_NULL_HANDLE || edgeBytes > vboEdgesBytes_) {
      if (vboEdgesMapped_ != nullptr) {
        vkUnmapMemory(device_, vboEdgesMem_);
        vboEdgesMapped_ = nullptr;
      }
      if (vboEdges_ != VK_NULL_HANDLE) vkDestroyBuffer(device_, vboEdges_, nullptr);
      if (vboEdgesMem_ != VK_NULL_HANDLE) vkFreeMemory(device_, vboEdgesMem_, nullptr);

      VkBufferCreateInfo bi{};
      bi.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
      bi.size = edgeBytes;
      bi.usage = VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;
      bi.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
      if (vkCreateBuffer(device_, &bi, nullptr, &vboEdges_) != VK_SUCCESS) {
        error_ = "vkCreateBuffer(edge) failed";
        return false;
      }
      VkMemoryRequirements mr{};
      vkGetBufferMemoryRequirements(device_, vboEdges_, &mr);
      VkMemoryAllocateInfo ai{};
      ai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
      ai.allocationSize = mr.size;
      ai.memoryTypeIndex = findMemoryType(mr.memoryTypeBits,
                                          VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                                              VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
      if (ai.memoryTypeIndex != UINT32_MAX &&
          vkAllocateMemory(device_, &ai, nullptr, &vboEdgesMem_) == VK_SUCCESS) {
        vkBindBufferMemory(device_, vboEdges_, vboEdgesMem_, 0);
        vboEdgesBytes_ = mr.size;
        if (vkMapMemory(device_, vboEdgesMem_, 0, VK_WHOLE_SIZE, 0, &vboEdgesMapped_) != VK_SUCCESS) {
          vboEdgesMapped_ = nullptr;
        }
      }
    }
    if (vboEdgesMapped_ != nullptr) {
      std::memcpy(vboEdgesMapped_, edgeVertices.data(), static_cast<std::size_t>(edgeBytes));
    }
  }

  return true;
}


void ViewportRenderer::destroyTarget() {
  if (descriptor_ != VK_NULL_HANDLE) {
    ImGui_ImplVulkan_RemoveTexture(descriptor_);
    descriptor_ = VK_NULL_HANDLE;
    textureId_ = 0;
  }
  if (framebuffer_ != VK_NULL_HANDLE) vkDestroyFramebuffer(device_, framebuffer_, nullptr);
  if (colorView_ != VK_NULL_HANDLE) vkDestroyImageView(device_, colorView_, nullptr);
  if (color_ != VK_NULL_HANDLE) vkDestroyImage(device_, color_, nullptr);
  if (colorMem_ != VK_NULL_HANDLE) vkFreeMemory(device_, colorMem_, nullptr);
  if (depthView_ != VK_NULL_HANDLE) vkDestroyImageView(device_, depthView_, nullptr);
  if (depth_ != VK_NULL_HANDLE) vkDestroyImage(device_, depth_, nullptr);
  if (depthMem_ != VK_NULL_HANDLE) vkFreeMemory(device_, depthMem_, nullptr);
  framebuffer_ = VK_NULL_HANDLE;
  colorView_ = VK_NULL_HANDLE;
  color_ = VK_NULL_HANDLE;
  colorMem_ = VK_NULL_HANDLE;
  depthView_ = VK_NULL_HANDLE;
  depth_ = VK_NULL_HANDLE;
  depthMem_ = VK_NULL_HANDLE;
  width_ = height_ = 0;
}

bool ViewportRenderer::createTarget(std::uint32_t w, std::uint32_t h) {
  auto makeImage = [&](VkFormat fmt, VkImageUsageFlags usage, VkImage& img,
                       VkDeviceMemory& mem, VkImageView& view,
                       VkImageAspectFlags aspect) -> bool {
    VkImageCreateInfo ic{};
    ic.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
    ic.imageType = VK_IMAGE_TYPE_2D;
    ic.format = fmt;
    ic.extent = {w, h, 1};
    ic.mipLevels = 1;
    ic.arrayLayers = 1;
    ic.samples = VK_SAMPLE_COUNT_1_BIT;
    ic.tiling = VK_IMAGE_TILING_OPTIMAL;
    ic.usage = usage;
    ic.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    if (vkCreateImage(device_, &ic, nullptr, &img) != VK_SUCCESS) return false;
    VkMemoryRequirements mr{};
    vkGetImageMemoryRequirements(device_, img, &mr);
    VkMemoryAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    ai.allocationSize = mr.size;
    ai.memoryTypeIndex = findMemoryType(mr.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    if (ai.memoryTypeIndex == UINT32_MAX) return false;
    if (vkAllocateMemory(device_, &ai, nullptr, &mem) != VK_SUCCESS) return false;
    vkBindImageMemory(device_, img, mem, 0);
    VkImageViewCreateInfo vi{};
    vi.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
    vi.image = img;
    vi.viewType = VK_IMAGE_VIEW_TYPE_2D;
    vi.format = fmt;
    vi.subresourceRange = {aspect, 0, 1, 0, 1};
    return vkCreateImageView(device_, &vi, nullptr, &view) == VK_SUCCESS;
  };

  if (!makeImage(kColorFormat,
                 VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT, color_,
                 colorMem_, colorView_, VK_IMAGE_ASPECT_COLOR_BIT)) {
    error_ = "offscreen colour image creation failed";
    return false;
  }
  if (!makeImage(kDepthFormat, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT, depth_, depthMem_,
                 depthView_, VK_IMAGE_ASPECT_DEPTH_BIT)) {
    error_ = "offscreen depth image creation failed";
    return false;
  }

  const VkImageView views[2] = {colorView_, depthView_};
  VkFramebufferCreateInfo fi{};
  fi.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
  fi.renderPass = renderPass_;
  fi.attachmentCount = 2;
  fi.pAttachments = views;
  fi.width = w;
  fi.height = h;
  fi.layers = 1;
  if (vkCreateFramebuffer(device_, &fi, nullptr, &framebuffer_) != VK_SUCCESS) {
    error_ = "vkCreateFramebuffer failed";
    return false;
  }

  descriptor_ = ImGui_ImplVulkan_AddTexture(sampler_, colorView_,
                                            VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL);
  if (descriptor_ == VK_NULL_HANDLE) {
    error_ = "ImGui_ImplVulkan_AddTexture failed";
    return false;
  }
  textureId_ = reinterpret_cast<std::uint64_t>(descriptor_);
  width_ = w;
  height_ = h;
  return true;
}

bool ViewportRenderer::resize(std::uint32_t w, std::uint32_t h) {
  if (w == 0 || h == 0) return true;
  if (w == width_ && h == height_) return true;
  vkDeviceWaitIdle(device_);
  destroyTarget();
  return createTarget(w, h);
}

void ViewportRenderer::record(VkCommandBuffer cmd, const Camera& camera,
                              std::uint32_t hoverFace, bool wireframe) {
  if (framebuffer_ == VK_NULL_HANDLE || width_ == 0 || height_ == 0) return;

  VkClearValue clears[2]{};
  clears[0].color = {{0.086f, 0.098f, 0.117f, 1.0f}};  // the viewport ground
  clears[1].depthStencil = {1.0f, 0};

  VkRenderPassBeginInfo bi{};
  bi.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
  bi.renderPass = renderPass_;
  bi.framebuffer = framebuffer_;
  bi.renderArea.extent = {width_, height_};
  bi.clearValueCount = 2;
  bi.pClearValues = clears;
  vkCmdBeginRenderPass(cmd, &bi, VK_SUBPASS_CONTENTS_INLINE);

  if (triangles_ > 0 && vbo_ != VK_NULL_HANDLE) {
    VkPipeline pipe = (wireframe && pipelineWire_ != VK_NULL_HANDLE) ? pipelineWire_
                                                                     : pipelineSolid_;
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, pipe);

    VkViewport vp{};
    vp.width = static_cast<float>(width_);
    vp.height = static_cast<float>(height_);
    vp.maxDepth = 1.0f;
    vkCmdSetViewport(cmd, 0, 1, &vp);
    VkRect2D sc{};
    sc.extent = {width_, height_};
    vkCmdSetScissor(cmd, 0, 1, &sc);

    PushBlock pb{};
    camera.viewProj(pb.mvp);
    camera.view(pb.nrm);  // camera view matrix for camera-aligned studio specular & normals
    pb.hoverFace = hoverFace;
    pb.shadingMode = 0;
    vkCmdPushConstants(cmd, layout_,
                       VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT, 0,
                       sizeof(pb), &pb);

    const VkDeviceSize offset = 0;
    vkCmdBindVertexBuffers(cmd, 0, 1, &vbo_, &offset);
    vkCmdDraw(cmd, triangles_ * 3, 1, 0, 0);

    // ── CAD feature edge overlay ("Shaded with Edges") ─────────────────────
    if (edgeLines_ > 0 && vboEdges_ != VK_NULL_HANDLE && pipelineLine_ != VK_NULL_HANDLE) {
      vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, pipelineLine_);
      pb.shadingMode = 1;
      vkCmdPushConstants(cmd, layout_,
                         VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT, 0,
                         sizeof(pb), &pb);
      vkCmdBindVertexBuffers(cmd, 0, 1, &vboEdges_, &offset);
      vkCmdDraw(cmd, edgeLines_ * 2, 1, 0, 0);
    }
  }

  vkCmdEndRenderPass(cmd);
}

void ViewportRenderer::destroy() {
  if (device_ == VK_NULL_HANDLE) return;
  vkDeviceWaitIdle(device_);
  destroyTarget();
  if (vboMapped_ != nullptr) {
    vkUnmapMemory(device_, vboMem_);
    vboMapped_ = nullptr;
  }
  if (vbo_ != VK_NULL_HANDLE) vkDestroyBuffer(device_, vbo_, nullptr);
  if (vboMem_ != VK_NULL_HANDLE) vkFreeMemory(device_, vboMem_, nullptr);

  if (vboEdgesMapped_ != nullptr) {
    vkUnmapMemory(device_, vboEdgesMem_);
    vboEdgesMapped_ = nullptr;
  }
  if (vboEdges_ != VK_NULL_HANDLE) vkDestroyBuffer(device_, vboEdges_, nullptr);
  if (vboEdgesMem_ != VK_NULL_HANDLE) vkFreeMemory(device_, vboEdgesMem_, nullptr);

  if (pipelineLine_ != VK_NULL_HANDLE) vkDestroyPipeline(device_, pipelineLine_, nullptr);
  if (pipelineWire_ != VK_NULL_HANDLE) vkDestroyPipeline(device_, pipelineWire_, nullptr);
  if (pipelineSolid_ != VK_NULL_HANDLE) vkDestroyPipeline(device_, pipelineSolid_, nullptr);
  if (layout_ != VK_NULL_HANDLE) vkDestroyPipelineLayout(device_, layout_, nullptr);
  if (sampler_ != VK_NULL_HANDLE) vkDestroySampler(device_, sampler_, nullptr);
  if (renderPass_ != VK_NULL_HANDLE) vkDestroyRenderPass(device_, renderPass_, nullptr);
  vbo_ = VK_NULL_HANDLE;
  vboMem_ = VK_NULL_HANDLE;
  vboEdges_ = VK_NULL_HANDLE;
  vboEdgesMem_ = VK_NULL_HANDLE;
  pipelineLine_ = VK_NULL_HANDLE;
  pipelineWire_ = VK_NULL_HANDLE;
  pipelineSolid_ = VK_NULL_HANDLE;
  layout_ = VK_NULL_HANDLE;
  sampler_ = VK_NULL_HANDLE;
  renderPass_ = VK_NULL_HANDLE;
  device_ = VK_NULL_HANDLE;
}


}  // namespace forge::desktop
