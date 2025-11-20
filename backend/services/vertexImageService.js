const { VertexAI } = require('@google-cloud/vertexai');
const config = require('../config/ai3d-providers');
const creditManager = require('./creditManager');

/**
 * Vertex AI Imagen Service
 * Image generation for concept art, textures, and multi-view references
 * Uses Google Cloud Vertex AI with Imagen 3/4 models
 */
class VertexImageService {
  constructor() {
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    this.location = config.vertexImagen.location;
    this.model = config.vertexImagen.model;
    this.credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    this.enabled = !!this.projectId && config.features.ai3DGeneration;
    this.vertexAI = null;

    if (this.enabled) {
      try {
        this.vertexAI = new VertexAI({
          project: this.projectId,
          location: this.location,
        });
      } catch (error) {
        console.warn('Vertex AI initialization failed:', error.message);
        this.enabled = false;
      }
    }
  }

  /**
   * Check if service is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Generate single image from prompt
   */
  async generateImage(prompt, options = {}) {
    if (!this.enabled) {
      throw new Error('Vertex AI Imagen service is not enabled. Please configure Google Cloud credentials.');
    }

    // Check free tier availability
    const canUseFree = await creditManager.canUseFreeTier('vertexImagen', 1);
    const useFreeTier = config.features.useFreeTierFirst && canUseFree;

    // Check budget
    const costUSD = useFreeTier ? 0 : config.vertexImagen.costs.perImage;
    const budgetCheck = await creditManager.isWithinBudget(costUSD);

    if (!budgetCheck.withinBudget) {
      throw new Error('Generation would exceed monthly budget');
    }

    console.log('🎨 Vertex Imagen: Generating image:', {
      prompt: prompt.substring(0, 50),
      useFreeTier,
      estimatedCost: costUSD,
    });

    try {
      const generativeModel = this.vertexAI.preview.getGenerativeModel({
        model: this.model,
      });

      const request = {
        contents: [{
          role: 'user',
          parts: [{
            text: prompt,
          }],
        }],
        generation_config: {
          temperature: options.temperature || 0.4,
          top_p: options.topP || 0.95,
          max_output_tokens: options.maxTokens || 2048,
        },
      };

      const result = await generativeModel.generateContent(request);
      const response = result.response;

      // Extract image data
      const imageData = response.candidates?.[0]?.content?.parts?.[0];

      // Record usage
      await creditManager.recordUsage('vertexImagen', 1, costUSD, {
        type: 'image-generation',
        prompt: prompt.substring(0, 100),
      });

      console.log('✅ Vertex Imagen: Image generated');

      return {
        success: true,
        imageData,
        imageUrl: imageData?.image_url || null,
        base64: imageData?.inline_data?.data || null,
        mimeType: imageData?.inline_data?.mime_type || 'image/png',
        creditsUsed: 1,
        costUSD,
        provider: 'vertexImagen',
      };
    } catch (error) {
      console.error('❌ Vertex Imagen: Generation failed:', error.message);
      throw error;
    }
  }

  /**
   * Generate multi-view images for 3D reconstruction
   */
  async generateMultiViewImages(prompt, views = ['front', 'side', 'top', 'isometric']) {
    if (!this.enabled) {
      throw new Error('Vertex AI Imagen service is not enabled');
    }

    const imageCount = views.length;

    // Check free tier availability
    const canUseFree = await creditManager.canUseFreeTier('vertexImagen', imageCount);
    const useFreeTier = config.features.useFreeTierFirst && canUseFree;

    // Check budget
    const costUSD = useFreeTier ? 0 : config.vertexImagen.costs.perImage * imageCount;
    const budgetCheck = await creditManager.isWithinBudget(costUSD);

    if (!budgetCheck.withinBudget) {
      throw new Error('Generation would exceed monthly budget');
    }

    console.log('🎨 Vertex Imagen: Generating multi-view images:', {
      prompt: prompt.substring(0, 50),
      views: views.length,
      useFreeTier,
      estimatedCost: costUSD,
    });

    try {
      const images = [];

      // Generate each view
      for (const view of views) {
        const viewPrompt = `${prompt}, ${view} view, architectural drawing style, clean background, professional render`;
        const result = await this.generateImage(viewPrompt, { temperature: 0.3 });
        images.push({
          view,
          ...result,
        });
      }

      console.log('✅ Vertex Imagen: Multi-view images generated');

      return {
        success: true,
        images,
        totalCreditsUsed: imageCount,
        totalCostUSD: costUSD,
        provider: 'vertexImagen',
      };
    } catch (error) {
      console.error('❌ Vertex Imagen: Multi-view generation failed:', error.message);
      throw error;
    }
  }

  /**
   * Generate PBR texture maps
   */
  async generatePBRTextures(materialName, resolution = '1024x1024') {
    if (!this.enabled) {
      throw new Error('Vertex AI Imagen service is not enabled');
    }

    const textureCount = 4; // albedo, normal, roughness, metallic

    // Check free tier and budget
    const canUseFree = await creditManager.canUseFreeTier('vertexImagen', textureCount);
    const useFreeTier = config.features.useFreeTierFirst && canUseFree;
    const costUSD = useFreeTier ? 0 : config.vertexImagen.costs.perImage * textureCount;
    const budgetCheck = await creditManager.isWithinBudget(costUSD);

    if (!budgetCheck.withinBudget) {
      throw new Error('Generation would exceed monthly budget');
    }

    console.log('🎨 Vertex Imagen: Generating PBR textures:', {
      material: materialName,
      resolution,
      useFreeTier,
    });

    try {
      const textures = {};
      const textureTypes = [
        { name: 'albedo', prompt: `${materialName} albedo texture map, ${resolution}, seamless, tileable, PBR, photorealistic` },
        { name: 'normal', prompt: `${materialName} normal map texture, ${resolution}, seamless, tileable, tangent space, purple/blue tones` },
        { name: 'roughness', prompt: `${materialName} roughness texture map, ${resolution}, seamless, tileable, grayscale, PBR` },
        { name: 'metallic', prompt: `${materialName} metallic texture map, ${resolution}, seamless, tileable, grayscale, PBR` },
      ];

      for (const texture of textureTypes) {
        const result = await this.generateImage(texture.prompt, { temperature: 0.2 });
        textures[texture.name] = result;
      }

      console.log('✅ Vertex Imagen: PBR textures generated');

      return {
        success: true,
        textures,
        totalCreditsUsed: textureCount,
        totalCostUSD: costUSD,
        provider: 'vertexImagen',
      };
    } catch (error) {
      console.error('❌ Vertex Imagen: PBR texture generation failed:', error.message);
      throw error;
    }
  }

  /**
   * Generate concept art for a building/structure
   */
  async generateConceptArt(description, style = 'photorealistic') {
    if (!this.enabled) {
      throw new Error('Vertex AI Imagen service is not enabled');
    }

    const prompt = `${description}, ${style} architectural concept art, professional render, detailed, high quality`;

    return await this.generateImage(prompt, {
      temperature: 0.5,
    });
  }

  /**
   * Get estimated cost for image generation
   */
  async estimateCost(imageCount = 1) {
    const canUseFree = await creditManager.canUseFreeTier('vertexImagen', imageCount);
    const costUSD = canUseFree ? 0 : config.vertexImagen.costs.perImage * imageCount;

    return {
      provider: 'vertexImagen',
      imageCount,
      canUseFreeTier: canUseFree,
      estimatedCostUSD: costUSD,
    };
  }
}

module.exports = new VertexImageService();
