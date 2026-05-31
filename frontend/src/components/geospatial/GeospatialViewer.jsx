import React, { useEffect, useState } from 'react';
import { Viewer, Entity } from 'resium';
import { Cartesian3, createWorldTerrainAsync, Ion, Viewer as CesiumViewer } from 'cesium';
import LocationSearch from './LocationSearch';
import './GeospatialViewer.css';

// Initialize Cesium Ion Token (if available in env)
// Note: Cesium works with default token for development but requests a token for production
if (import.meta.env.VITE_CESIUM_ION_TOKEN) {
    Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
}

const GeospatialViewer = () => {
    const [terrainProvider, setTerrainProvider] = useState(null);

    useEffect(() => {
        // Load world terrain
        const loadTerrain = async () => {
            try {
                const terrain = await createWorldTerrainAsync();
                setTerrainProvider(terrain);
            } catch (error) {
                console.error('Failed to load terrain:', error);
            }
        };
        loadTerrain();
    }, []);

    return (
        <div className="geospatial-wrapper">
            <Viewer
                full
                terrainProvider={terrainProvider}
                animation={false}
                timeline={false}
                baseLayerPicker={true}
                geocoder={false} // We rely on our custom search or we can enable this if we have a token
                homeButton={true}
                sceneModePicker={true}
                navigationHelpButton={false}
                selectionIndicator={true}
                infoBox={true}
            >
                <LocationSearch />

                {/* Example entity: ArchDisc HQ at NYC coordinates */}
                <Entity
                    name="ArchDisc HQ (Example)"
                    position={Cartesian3.fromDegrees(-74.006, 40.7128, 100)}
                    point={{ pixelSize: 10, color: undefined }}
                    description="ArchDisc Head Office"
                />
            </Viewer>
        </div>
    );
};

export default GeospatialViewer;
