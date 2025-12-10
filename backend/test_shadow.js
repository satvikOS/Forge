const realWorldReferenceSystem = require('./services/references/realWorldReferenceSystem');

async function verifyShadowIntegration() {
    console.log('🌍 Verifying Shadow Geospatial Integration...');

    // Test case: A location that needs both Geocoding and Context
    const subject = 'Eiffel Tower';

    console.log(`\n🎯 Querying subject: "${subject}"`);

    try {
        const data = await realWorldReferenceSystem.fetchReferenceData(subject);

        if (!data) {
            console.error('❌ Failed to fetch reference data');
            process.exit(1);
        }

        console.log('\n✨ Results:');
        console.log('----------------------------------------');

        // Check Geocoding
        if (data.wikidata?.location || data.geocodedLocation) {
            const loc = data.wikidata?.location || data.geocodedLocation;
            console.log(`✅ Location Resolved: ${loc.latitude || loc.lat}, ${loc.longitude || loc.lon}`);
        } else {
            console.error('❌ Location NOT resolved');
        }

        // Check Environmental Context
        if (data.environmentalContext) {
            console.log('✅ Environmental Context Retrieved:');
            console.log('   Weather:', data.environmentalContext.weather?.condition);
            console.log('   Temp:', data.environmentalContext.weather?.temperature + '°C');
            console.log('   Terrain:', data.environmentalContext.terrain);
        } else {
            console.error('❌ Environmental Context MISSING (Shadow Integration Failed)');
        }

        console.log('----------------------------------------');

        if (data.environmentalContext) {
            console.log('\n✅ VERIFICATION SUCCESSFUL: Shadow integration is working!');
        } else {
            console.log('\n❌ VERIFICATION FAILED: Context was not retrieved.');
            process.exit(1);
        }

    } catch (error) {
        console.error('❌ Error during verification:', error);
        process.exit(1);
    }
}

// Run verification
verifyShadowIntegration();
