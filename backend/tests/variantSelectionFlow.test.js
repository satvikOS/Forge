/**
 * Variant Selection Flow Tests
 * Tests the corrected flow where users see variants before 3D generation happens
 */

const request = require('supertest');
const express = require('express');

// Mock services
jest.mock('../services/aiService');
jest.mock('../services/jobQueue');
jest.mock('../services/multiVariantGenerator');
jest.mock('../services/materialMappingService');

const generateRouter = require('../routes/generate');

describe('Variant Selection Flow', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/generate', generateRouter);
  });

  describe('POST /api/generate (Standard Generation)', () => {
    test('should NOT generate variants automatically', async () => {
      // This endpoint should use standard pipeline only
      // Multi-variant generation should be disabled
      
      const multiVariantGenerator = require('../services/multiVariantGenerator');
      const generateVariantsSpy = jest.spyOn(multiVariantGenerator, 'generateVariants');
      
      const jobQueue = require('../services/jobQueue');
      jobQueue.createJob.mockReturnValue('test-job-123');
      
      const response = await request(app)
        .post('/api/generate')
        .send({ prompt: 'Eiffel Tower' });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.jobId).toBe('test-job-123');
      
      // Verify multi-variant generation was NOT called
      expect(generateVariantsSpy).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/generate/variants', () => {
    test('should generate 3 variants without 3D generation', async () => {
      const multiVariantGenerator = require('../services/multiVariantGenerator');
      
      multiVariantGenerator.isEnabled.mockReturnValue(true);
      multiVariantGenerator.generateVariants.mockResolvedValue([
        { 
          style: 'photorealistic', 
          title: 'Photorealistic',
          name: 'Accurate Eiffel Tower',
          dimensions: { width: 125, height: 324, depth: 125 }
        },
        { 
          style: 'engineering-detail', 
          title: 'Engineering Detail',
          name: 'Technical Eiffel Tower',
          dimensions: { width: 125, height: 324, depth: 125 }
        },
        { 
          style: 'artistic-quality', 
          title: 'Artistic Quality',
          name: 'Aesthetic Eiffel Tower',
          dimensions: { width: 125, height: 324, depth: 125 }
        }
      ]);
      
      const response = await request(app)
        .post('/api/generate/variants')
        .send({ prompt: 'Eiffel Tower' });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.variants).toHaveLength(3);
      expect(response.body.variants[0].style).toBe('photorealistic');
      
      // Verify no 3D model data was generated
      expect(response.body.modelData).toBeUndefined();
      expect(response.body.design).toBeUndefined();
    });
  });

  describe('POST /api/generate/create-design', () => {
    test('should create 3D design from selected variant', async () => {
      const jobQueue = require('../services/jobQueue');
      jobQueue.createJob.mockReturnValue('design-job-456');
      
      const selectedVariant = {
        style: 'engineering-detail',
        title: 'Engineering Detail',
        name: 'Technical Eiffel Tower',
        description: 'Focuses on structural accuracy',
        dimensions: { width: 125, height: 324, depth: 125 },
        materials: ['wrought iron', 'steel'],
        elements: []
      };
      
      const response = await request(app)
        .post('/api/generate/create-design')
        .send({
          variant: selectedVariant,
          prompt: 'Eiffel Tower'
        });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.jobId).toBe('design-job-456');
      expect(response.body.selectedVariant.style).toBe('engineering-detail');
      
      // Verify a job was created for 3D generation
      expect(jobQueue.createJob).toHaveBeenCalledWith(
        'Eiffel Tower',
        expect.objectContaining({
          selectedVariant: selectedVariant,
          isFromVariantSelection: true
        })
      );
    });

    test('should return error if variant is missing', async () => {
      const response = await request(app)
        .post('/api/generate/create-design')
        .send({ prompt: 'Eiffel Tower' });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Variant is required');
    });

    test('should return error if prompt is missing', async () => {
      const response = await request(app)
        .post('/api/generate/create-design')
        .send({ 
          variant: { 
            style: 'photorealistic',
            title: 'Test'
          } 
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Prompt is required');
    });
  });
});

describe('Correct User Flow', () => {
  test('should follow: variants → select → create-design flow', async () => {
    // This test documents the expected flow:
    // 1. User enters prompt
    // 2. Frontend calls POST /api/generate/variants
    // 3. Backend returns 3 variants (NO 3D generation yet)
    // 4. Frontend displays VariantSelector with 3 cards
    // 5. User selects a variant
    // 6. User clicks "Create Design" button
    // 7. Frontend calls POST /api/generate/create-design with selected variant
    // 8. Backend generates 3D model from variant
    // 9. Frontend displays final 3D model
    
    const multiVariantGenerator = require('../services/multiVariantGenerator');
    const jobQueue = require('../services/jobQueue');
    
    multiVariantGenerator.isEnabled.mockReturnValue(true);
    multiVariantGenerator.generateVariants.mockResolvedValue([
      { style: 'photorealistic', title: 'Photorealistic', name: 'Variant 1' },
      { style: 'engineering-detail', title: 'Engineering Detail', name: 'Variant 2' },
      { style: 'artistic-quality', title: 'Artistic Quality', name: 'Variant 3' }
    ]);
    
    jobQueue.createJob.mockReturnValue('final-job-789');
    
    const app = express();
    app.use(express.json());
    app.use('/api/generate', generateRouter);
    
    // Step 1-3: Generate variants
    const variantsResponse = await request(app)
      .post('/api/generate/variants')
      .send({ prompt: 'Test Building' });
    
    expect(variantsResponse.status).toBe(200);
    expect(variantsResponse.body.variants).toHaveLength(3);
    
    // Step 4-6: User selects variant (happens in frontend)
    const selectedVariant = variantsResponse.body.variants[1]; // User picks engineering-detail
    
    // Step 7-8: Create design from selected variant
    const designResponse = await request(app)
      .post('/api/generate/create-design')
      .send({
        variant: selectedVariant,
        prompt: 'Test Building'
      });
    
    expect(designResponse.status).toBe(200);
    expect(designResponse.body.success).toBe(true);
    expect(designResponse.body.selectedVariant.style).toBe('engineering-detail');
  });
});
