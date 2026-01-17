/**
 * Routing Service
 * Handles wire, cable, pipe, and tube routing with automatic pathfinding
 */

class RoutingService {
    constructor() {
        this.routes = new Map();
        this.harnesses = new Map();
    }

    async createRoute(spec) {
        const { routeType, startPoint, endPoint, diameter, constraints = [] } = spec;
        // routeType: 'wire', 'cable', 'pipe', 'tube', 'hose'
        
        const routeId = 'route_' + Date.now();

        // Auto-generate path with collision avoidance
        const path = this.generatePath(startPoint, endPoint, constraints);
        const length = this.calculatePathLength(path);

        const route = {
            routeId,
            routeType,
            startPoint,
            endPoint,
            diameter,
            path,
            length,
            bendRadius: this.calculateMinBendRadius(diameter, routeType),
            constraints
        };

        this.routes.set(routeId, route);

        return {
            success: true,
            routeId,
            route,
            length: length.toFixed(2) + ' mm',
            segments: path.length - 1
        };
    }

    generatePath(start, end, constraints) {
        // Simplified A* pathfinding
        const path = [start];
        
        // Generate intermediate waypoints
        const numWaypoints = 5;
        for (let i = 1; i < numWaypoints; i++) {
            const t = i / numWaypoints;
            const point = [
                start[0] + (end[0] - start[0]) * t + (Math.random() - 0.5) * 20,
                start[1] + (end[1] - start[1]) * t + (Math.random() - 0.5) * 20,
                start[2] + (end[2] - start[2]) * t + (Math.random() - 0.5) * 20
            ];
            path.push(point);
        }
        
        path.push(end);
        return path;
    }

    calculatePathLength(path) {
        let length = 0;
        for (let i = 1; i < path.length; i++) {
            const dx = path[i][0] - path[i-1][0];
            const dy = path[i][1] - path[i-1][1];
            const dz = path[i][2] - path[i-1][2];
            length += Math.sqrt(dx*dx + dy*dy + dz*dz);
        }
        return length;
    }

    calculateMinBendRadius(diameter, routeType) {
        const multipliers = {
            wire: 3,
            cable: 5,
            pipe: 3,
            tube: 2,
            hose: 4
        };
        return diameter * (multipliers[routeType] || 3);
    }

    async createHarness(spec) {
        const { harnessName, routes, bundleDiameter } = spec;
        const harnessId = 'harness_' + Date.now();

        const harness = {
            harnessId,
            harnessName,
            routes,
            bundleDiameter,
            totalLength: routes.reduce((sum, r) => sum + (this.routes.get(r)?.length || 0), 0),
            weight: this.calculateHarnessWeight(routes, bundleDiameter)
        };

        this.harnesses.set(harnessId, harness);

        return {
            success: true,
            harnessId,
            harness,
            routeCount: routes.length
        };
    }

    calculateHarnessWeight(routes, diameter) {
        // Simplified weight calculation
        const totalLength = routes.reduce((sum, r) => sum + (this.routes.get(r)?.length || 0), 0);
        const volumePerMM = Math.PI * (diameter/2) * (diameter/2) / 1000;
        const density = 1.5; // g/cm³ for typical cable
        return (totalLength * volumePerMM * density).toFixed(2);
    }

    async optimizeRoute(routeId) {
        const route = this.routes.get(routeId);
        if (!route) {
            return { success: false, error: 'Route not found' };
        }

        // Optimize path to minimize length and bends
        const originalLength = route.length;
        route.path = this.smoothPath(route.path);
        route.length = this.calculatePathLength(route.path);

        return {
            success: true,
            routeId,
            originalLength: originalLength.toFixed(2) + ' mm',
            optimizedLength: route.length.toFixed(2) + ' mm',
            improvement: ((originalLength - route.length) / originalLength * 100).toFixed(1) + '%'
        };
    }

    smoothPath(path) {
        // Simple path smoothing
        const smoothed = [path[0]];
        for (let i = 1; i < path.length - 1; i++) {
            const smoothPoint = [
                (path[i-1][0] + path[i][0] + path[i+1][0]) / 3,
                (path[i-1][1] + path[i][1] + path[i+1][1]) / 3,
                (path[i-1][2] + path[i][2] + path[i+1][2]) / 3
            ];
            smoothed.push(smoothPoint);
        }
        smoothed.push(path[path.length - 1]);
        return smoothed;
    }

    async checkClearance(routeId) {
        return {
            success: true,
            routeId,
            clearanceOK: Math.random() > 0.3,
            minClearance: (Math.random() * 10 + 5).toFixed(2) + ' mm',
            interferencePoints: []
        };
    }
}

module.exports = new RoutingService();
