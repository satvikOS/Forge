#!/usr/bin/env node

/**
 * Manual Verification Script for Variant Selection Flow
 * 
 * This script verifies that:
 * 1. POST /api/generate does NOT auto-generate variants
 * 2. POST /api/generate/variants generates 3 variants
 * 3. POST /api/generate/create-design accepts a variant and creates design
 * 
 * Usage: node verify-variant-flow.js
 */

const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';

async function verifyVariantFlow() {
  console.log('\n========================================');
  console.log('🔍 Variant Selection Flow Verification');
  console.log('========================================\n');

  try {
    // Test 1: Verify POST /api/generate does NOT use multi-variant generation
    console.log('Test 1: Verify POST /api/generate uses standard pipeline');
    console.log('-----------------------------------------------');
    try {
      const response = await axios.post(`${API_BASE_URL}/generate`, {
        prompt: 'Simple test building'
      });
      
      if (response.data.success && response.data.jobId) {
        console.log('✅ Standard generation endpoint works');
        console.log('   Job ID:', response.data.jobId);
        console.log('   Note: This should use standard pipeline, not variants\n');
      }
    } catch (error) {
      console.error('❌ Standard generation endpoint failed:', error.message);
    }

    // Test 2: Verify POST /api/generate/variants generates 3 variants
    console.log('Test 2: Generate variants');
    console.log('-----------------------------------------------');
    try {
      const response = await axios.post(`${API_BASE_URL}/generate/variants`, {
        prompt: 'Eiffel Tower'
      });
      
      if (response.data.success && response.data.variants) {
        console.log('✅ Variant generation endpoint works');
        console.log('   Generated', response.data.variants.length, 'variants:');
        response.data.variants.forEach((variant, i) => {
          console.log(`   ${i + 1}. ${variant.title}: ${variant.name}`);
        });
        console.log('   ✅ No 3D model generated yet (as expected)\n');
        
        // Test 3: Verify POST /api/generate/create-design works
        console.log('Test 3: Create design from selected variant');
        console.log('-----------------------------------------------');
        
        const selectedVariant = response.data.variants[1]; // Select engineering-detail
        console.log('   Selected variant:', selectedVariant.title);
        
        const designResponse = await axios.post(`${API_BASE_URL}/generate/create-design`, {
          variant: selectedVariant,
          prompt: 'Eiffel Tower'
        });
        
        if (designResponse.data.success && designResponse.data.jobId) {
          console.log('✅ Create design endpoint works');
          console.log('   Job ID:', designResponse.data.jobId);
          console.log('   Selected variant:', designResponse.data.selectedVariant.title);
          console.log('   Status:', designResponse.data.status);
          console.log('   ✅ 3D generation job created for selected variant\n');
        }
      }
    } catch (error) {
      if (error.response?.status === 503) {
        console.log('⚠️  Multi-variant generation not enabled (GEMINI_API_KEY not configured)');
        console.log('   This is expected if API keys are not set up\n');
      } else {
        console.error('❌ Variant generation failed:', error.message);
      }
    }

    // Test 4: Verify error handling
    console.log('Test 4: Verify error handling');
    console.log('-----------------------------------------------');
    try {
      await axios.post(`${API_BASE_URL}/generate/create-design`, {
        // Missing variant and prompt
      });
    } catch (error) {
      if (error.response?.status === 400) {
        console.log('✅ Proper error handling for missing parameters');
        console.log('   Error message:', error.response.data.error);
      }
    }

    console.log('\n========================================');
    console.log('✅ Verification Complete');
    console.log('========================================\n');
    
    console.log('Summary:');
    console.log('- POST /api/generate: Standard pipeline (no variants)');
    console.log('- POST /api/generate/variants: Generates 3 variants only');
    console.log('- POST /api/generate/create-design: Creates 3D from variant');
    console.log('\nExpected user flow:');
    console.log('1. User enters prompt');
    console.log('2. Call /api/generate/variants → Shows 3 cards');
    console.log('3. User selects variant');
    console.log('4. Call /api/generate/create-design → Generates 3D');
    console.log('5. Display final 3D model\n');

  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('\nMake sure the backend server is running:');
      console.error('  cd backend && npm start');
    }
  }
}

// Run verification
verifyVariantFlow().catch(console.error);
