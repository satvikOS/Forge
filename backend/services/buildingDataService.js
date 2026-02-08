/**
 * Building Data Service - Stub
 * Placeholder for building data retrieval
 */

async function getBuildingData(lat, lng, radius = 500) {
    return {
        buildings: [],
        count: 0,
        source: 'stub',
    };
}

async function getBuildingFootprint(osmId) {
    return null;
}

module.exports = {
    getBuildingData,
    getBuildingFootprint,
};
