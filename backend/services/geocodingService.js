/**
 * Geocoding Service - Stub
 * Wraps geospatial/geocoder.js for backwards compatibility
 */
const path = require('path');
let geocoder;
try {
    geocoder = require('./geospatial/geocoder');
} catch (e) {
    geocoder = null;
}

async function geocode(query) {
    if (geocoder && geocoder.geocode) {
        return geocoder.geocode(query);
    }
    return { lat: 0, lng: 0, formatted: query };
}

async function reverseGeocode(lat, lng) {
    if (geocoder && geocoder.reverseGeocode) {
        return geocoder.reverseGeocode(lat, lng);
    }
    return { formatted: `${lat}, ${lng}` };
}

module.exports = {
    geocode,
    reverseGeocode,
};
