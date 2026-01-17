#!/usr/bin/env node

/**
 * Gemini API Connection Diagnostic Tool
 * Tests if ArchDisc can connect to Google Gemini API
 */

require('dotenv').config();
const geminiService = require('./services/geminiService');

console.log('═══════════════════════════════════════════════════════════');
console.log('🔍 Gemini API Connection Diagnostic Tool');
console.log('═══════════════════════════════════════════════════════════\n');

async function runDiagnostics() {
  try {
    // Step 1: Check environment
    console.log('📋 Step 1: Environment Check');
    console.log('─────────────────────────────────────────────────────────');
    const apiKey = process.env.GEMINI_API_KEY;
    console.log('  ✓ API Key present:', !!apiKey);
    if (apiKey) {
      console.log('  ✓ API Key length:', apiKey.length, 'characters');
      console.log('  ✓ API Key preview:', apiKey.substring(0, 20) + '...');
      console.log('  ✓ API Key format:', apiKey.startsWith('AIza') ? 'Valid format' : '⚠️  Unexpected format');
    } else {
      console.log('  ❌ NO API KEY FOUND!');
      console.log('\n⚠️  CRITICAL ISSUE: No GEMINI_API_KEY in environment');
      console.log('  This is why no requests appear in Google Studio!\n');
      console.log('📝 To fix:');
      console.log('  1. Get API key from: https://makersuite.google.com/app/apikey');
      console.log('  2. Add to backend/.env file: GEMINI_API_KEY=your_key_here');
      console.log('  3. Restart the server');
      process.exit(1);
    }
    console.log('');

    // Step 2: Check service initialization
    console.log('📋 Step 2: Service Initialization Check');
    console.log('─────────────────────────────────────────────────────────');
    const status = geminiService.getStatus();
    console.log('  ✓ Service configured:', status.configured);
    console.log('  ✓ Service mode:', status.mode);
    console.log('  ✓ Model name:', status.model);
    
    if (!status.configured) {
      console.log('\n  ❌ Service not configured properly!');
      console.log('  Check the initialization logs above for errors');
      process.exit(1);
    }
    console.log('');

    // Step 3: Test API connection
    console.log('📋 Step 3: API Connection Test');
    console.log('─────────────────────────────────────────────────────────');
    console.log('  Sending test request to Google Gemini API...');
    
    const testResult = await geminiService.testConnection();
    
    if (testResult.success) {
      console.log('\n✅ SUCCESS! API Connection Working!');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('🎉 All systems operational!');
      console.log('');
      console.log('Your ArchDisc instance CAN connect to Google Gemini API.');
      console.log('Requests WILL appear in Google AI Studio.');
      console.log('');
      console.log('If you\'re still seeing "Failed to generate design":');
      console.log('  1. Check server logs for specific error messages');
      console.log('  2. Try a simple prompt like "design a cube"');
      console.log('  3. Check browser console for frontend errors');
      console.log('═══════════════════════════════════════════════════════════\n');
    } else {
      console.log('\n❌ FAILED! API Connection Not Working');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('Error:', testResult.error);
      console.log('');
      console.log('🔧 Troubleshooting steps:');
      console.log('');
      console.log('1. Verify API key in Google AI Studio:');
      console.log('   https://makersuite.google.com/app/apikey');
      console.log('');
      console.log('2. Check API key has Gemini API enabled:');
      console.log('   - Go to Google Cloud Console');
      console.log('   - Enable "Generative Language API"');
      console.log('');
      console.log('3. Verify no quota limits:');
      console.log('   - Check Google AI Studio dashboard');
      console.log('   - Free tier has limited requests');
      console.log('');
      console.log('4. Test network connectivity:');
      console.log('   curl https://generativelanguage.googleapis.com');
      console.log('═══════════════════════════════════════════════════════════\n');
      process.exit(1);
    }

    // Step 4: Test with actual prompt
    console.log('📋 Step 4: Testing with Architectural Prompt');
    console.log('─────────────────────────────────────────────────────────');
    console.log('  Sending complex architectural design prompt...');
    
    const testPrompt = 'Design a simple modern cube building';
    const analysisResult = await geminiService.analyzePrompt(testPrompt);
    
    if (analysisResult) {
      console.log('\n✅ SUCCESS! Complex Prompt Works!');
      console.log('  Response type:', typeof analysisResult);
      console.log('  Has object count:', !!analysisResult.objectCount);
      console.log('  Has elements:', !!analysisResult.elements);
      console.log('\n🎉 Everything is working correctly!');
      console.log('Your API connection is solid and can handle complex prompts.\n');
    } else {
      console.log('\n⚠️  Warning: Prompt returned null');
      console.log('  The API connected but couldn\'t parse the response');
      console.log('  This might be a JSON parsing issue, not a connection issue\n');
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ Diagnostic Complete');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n═══════════════════════════════════════════════════════════');
    console.error('❌ Diagnostic Failed');
    console.error('═══════════════════════════════════════════════════════════');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('═══════════════════════════════════════════════════════════\n');
    process.exit(1);
  }
}

runDiagnostics();
