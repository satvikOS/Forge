import React, { useState } from 'react';
import { useCesium } from 'resium';
import { Cartesian3, Math as CesiumMath } from 'cesium';
import './GeospatialViewer.css'; // Shared styles

const LocationSearch = () => {
    const { viewer } = useCesium();
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!query.trim() || !viewer) return;

        setLoading(true);
        setError(null);

        try {
            // Use OpenStreetMap Nominatim for free geocoding
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
            const data = await response.json();

            if (data && data.length > 0) {
                const { lat, lon, display_name } = data[0];

                console.log(`Flying to: ${display_name} (${lat}, ${lon})`);

                // Fly to location
                viewer.camera.flyTo({
                    destination: Cartesian3.fromDegrees(parseFloat(lon), parseFloat(lat), 1000), // 1000m height
                    orientation: {
                        heading: CesiumMath.toRadians(0.0),
                        pitch: CesiumMath.toRadians(-45.0),
                        roll: 0.0
                    },
                    duration: 3 // seconds
                });

                // Clear search or show success? For now, just keep it.
            } else {
                setError('Location not found');
            }
        } catch (err) {
            console.error('Search failed:', err);
            setError('Search failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="geo-search-container">
            <form onSubmit={handleSearch} className="geo-search-form">
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search location (e.g. Paris, Eiffel Tower)..."
                    className="geo-search-input"
                    disabled={loading}
                />
                <button type="submit" className="geo-search-button" disabled={loading}>
                    {loading ? '...' : '🔍'}
                </button>
            </form>
            {error && <div className="geo-search-error">{error}</div>}
        </div>
    );
};

export default LocationSearch;
