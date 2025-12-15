/**
 * AI Design Memory Service
 * Stores user context, design iterations, and AI conversation history
 * Enables persistent learning and context-aware design generation
 */

class AIDesignMemoryService {
    constructor() {
        this.sessionMemory = new Map(); // In-memory storage for current session
        this.conversationHistory = new Map(); // User conversation threads
        this.designIterations = new Map(); // Design evolution tracking
        this.userPreferences = new Map(); // Learned user preferences
        this.contextWindow = 10; // Number of previous interactions to remember
    }

    /**
     * Store a design generation event
     */
    storeDesignGeneration(userId, designData) {
        const sessionId = this.getOrCreateSession(userId);

        const entry = {
            timestamp: new Date().toISOString(),
            prompt: designData.prompt,
            specifications: designData.specifications,
            taxonomyData: designData.taxonomyData,
            success: designData.success,
            feedback: null // Will be updated if user provides feedback
        };

        // Add to conversation history
        if (!this.conversationHistory.has(sessionId)) {
            this.conversationHistory.set(sessionId, []);
        }
        this.conversationHistory.get(sessionId).push(entry);

        // Track design iterations for this prompt
        const promptKey = this.normalizePrompt(designData.prompt);
        if (!this.designIterations.has(promptKey)) {
            this.designIterations.set(promptKey, []);
        }
        this.designIterations.get(promptKey).push(entry);

        console.log(`✅ Stored design generation for user ${userId}`);
        return entry;
    }

    /**
     * Get previous context for AI enhancement
     */
    getContextForPrompt(userId, currentPrompt) {
        const sessionId = this.getOrCreateSession(userId);
        const history = this.conversationHistory.get(sessionId) || [];

        // Get last N interactions
        const recentHistory = history.slice(-this.contextWindow);

        // Extract relevant patterns
        const context = {
            recentPrompts: recentHistory.map(h => h.prompt),
            recentCategories: recentHistory.map(h => h.taxonomyData?.primaryCategory).filter(Boolean),
            preferredStyles: this.extractPreferredStyles(recentHistory),
            commonMaterials: this.extractCommonMaterials(recentHistory),
            scalePreferences: this.extractScalePreferences(recentHistory),
            sessionCount: history.length
        };

        return context;
    }

    /**
     * Store user feedback on a design
     */
    storeFeedback(userId, designId, feedback) {
        const sessionId = this.getOrCreateSession(userId);
        const history = this.conversationHistory.get(sessionId) || [];

        // Find the design entry and add feedback
        const entry = history.find(h => h.timestamp === designId);
        if (entry) {
            entry.feedback = {
                rating: feedback.rating, // 1-5
                comments: feedback.comments,
                modificationsRequested: feedback.modifications,
                timestamp: new Date().toISOString()
            };

            // Learn from feedback
            this.learnFromFeedback(userId, entry, feedback);
            console.log(`✅ Stored feedback for design ${designId}`);
        }
    }

    /**
     * Learn user preferences from feedback
     */
    learnFromFeedback(userId, designEntry, feedback) {
        if (!this.userPreferences.has(userId)) {
            this.userPreferences.set(userId, {
                styles: {},
                materials: {},
                scales: {},
                detailLevels: {}
            });
        }

        const prefs = this.userPreferences.get(userId);

        // If rating is high (4-5), reinforce these patterns
        if (feedback.rating >= 4) {
            const style = designEntry.taxonomyData?.style?.architectural;
            if (style) {
                prefs.styles[style] = (prefs.styles[style] || 0) + 1;
            }

            const materials = designEntry.specifications?.materials || [];
            materials.forEach(mat => {
                prefs.materials[mat] = (prefs.materials[mat] || 0) + 1;
            });

            const detailLevel = designEntry.taxonomyData?.realism?.detailLevel;
            if (detailLevel) {
                prefs.detailLevels[detailLevel] = (prefs.detailLevels[detailLevel] || 0) + 1;
            }
        }

        console.log(`📊 Updated user preferences for ${userId}`);
    }

    /**
     * Get user preferences for AI prompt enhancement
     */
    getUserPreferences(userId) {
        const prefs = this.userPreferences.get(userId);
        if (!prefs) return null;

        return {
            preferredStyle: this.getTopPreference(prefs.styles),
            preferredMaterials: this.getTopPreferences(prefs.materials, 3),
            preferredDetailLevel: this.getTopPreference(prefs.detailLevels),
            hasHistory: true
        };
    }

    /**
     * Clear old session data (memory management)
     */
    clearOldSessions(maxAgeHours = 24) {
        const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);

        for (const [sessionId, history] of this.conversationHistory.entries()) {
            if (history.length > 0) {
                const lastActivity = new Date(history[history.length - 1].timestamp);
                if (lastActivity.getTime() < cutoff) {
                    this.conversationHistory.delete(sessionId);
                    console.log(`🗑️  Cleared old session: ${sessionId}`);
                }
            }
        }
    }

    /**
     * Get design iteration history
     */
    getDesignIterations(prompt) {
        const promptKey = this.normalizePrompt(prompt);
        return this.designIterations.get(promptKey) || [];
    }

    /**
     * Helper: Get or create session ID
     */
    getOrCreateSession(userId) {
        const sessionId = `session_${userId}_${Date.now()}`;
        if (!this.sessionMemory.has(userId)) {
            this.sessionMemory.set(userId, sessionId);
        }
        return this.sessionMemory.get(userId);
    }

    /**
     * Helper: Normalize prompt for comparison
     */
    normalizePrompt(prompt) {
        return prompt.toLowerCase().trim().replace(/\s+/g, ' ');
    }

    /**
     * Helper: Extract preferred styles from history
     */
    extractPreferredStyles(history) {
        const styles = history
            .map(h => h.taxonomyData?.style?.architectural)
            .filter(Boolean);
        return this.getMostCommon(styles);
    }

    /**
     * Helper: Extract common materials
     */
    extractCommonMaterials(history) {
        const allMaterials = history
            .flatMap(h => h.specifications?.materials || []);
        return this.getMostCommon(allMaterials, 5);
    }

    /**
     * Helper: Extract scale preferences
     */
    extractScalePreferences(history) {
        const scales = history
            .map(h => h.taxonomyData?.scale?.type)
            .filter(Boolean);
        return this.getMostCommon(scales);
    }

    /**
     * Helper: Get most common items
     */
    getMostCommon(array, limit = 3) {
        const counts = {};
        array.forEach(item => {
            counts[item] = (counts[item] || 0) + 1;
        });

        return Object.entries(counts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, limit)
            .map(([item]) => item);
    }

    /**
     * Helper: Get top preference
     */
    getTopPreference(preferences) {
        if (!preferences || Object.keys(preferences).length === 0) return null;

        return Object.entries(preferences)
            .sort(([, a], [, b]) => b - a)[0][0];
    }

    /**
     * Helper: Get top N preferences
     */
    getTopPreferences(preferences, n = 3) {
        if (!preferences || Object.keys(preferences).length === 0) return [];

        return Object.entries(preferences)
            .sort(([, a], [, b]) => b - a)
            .slice(0, n)
            .map(([item]) => item);
    }

    /**
     * Export session data (for persistence)
     */
    exportSessionData(userId) {
        const sessionId = this.sessionMemory.get(userId);
        return {
            userId,
            sessionId,
            conversationHistory: this.conversationHistory.get(sessionId) || [],
            preferences: this.userPreferences.get(userId) || {},
            exportedAt: new Date().toISOString()
        };
    }

    /**
     * Import session data (for restoration)
     */
    importSessionData(data) {
        if (data.sessionId) {
            this.conversationHistory.set(data.sessionId, data.conversationHistory);
            this.sessionMemory.set(data.userId, data.sessionId);
        }
        if (data.preferences) {
            this.userPreferences.set(data.userId, data.preferences);
        }
        console.log(`✅ Imported session data for user ${data.userId}`);
    }
}

module.exports = new AIDesignMemoryService();
