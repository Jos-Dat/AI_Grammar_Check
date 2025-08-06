const axios = require('axios');

class LanguageToolService {
    /**
     * Calls the LanguageTool API to check the grammar of a given text.
     * @param {string} text The text to check.
     * @param {string} language The language code (e.g., 'en-US', 'fr', 'de').
     * @returns {Promise<object>} The result from the LanguageTool API.
     */
    async checkGrammar(text, language) {
        const encodedParams = new URLSearchParams();

        // Use the 'language' parameter passed into the function
        encodedParams.set('language', language);
        encodedParams.set('text', text);

        // Add additional parameters for better accuracy
        encodedParams.set('enabledOnly', 'false');
        encodedParams.set('level', 'picky'); // More thorough checking

        const options = {
            method: 'POST',
            url: 'https://languagetool.org/api/v2/check',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'GrammarChecker/1.0'
            },
            data: encodedParams,
            timeout: 30000 // 30 second timeout
        };

        try {
            console.log(`Checking grammar for language: ${language}`);
            const response = await axios.request(options);
            
            // Validate response
            if (!response.data) {
                throw new Error('Empty response from LanguageTool API');
            }
            
            return response.data;
        } catch (error) {
            // Enhanced error handling
            if (error.response) {
                console.error('LanguageTool API Error:', {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    data: error.response.data
                });
                
                // Handle specific error cases
                if (error.response.status === 413) {
                    throw new Error('Text too long for processing');
                } else if (error.response.status === 429) {
                    throw new Error('Too many requests. Please try again later.');
                } else if (error.response.status >= 500) {
                    const customError = new Error('LanguageTool service temporarily unavailable');
                    customError.name = 'LanguageToolError';
                    throw customError;
                }
            } else if (error.code === 'ECONNABORTED') {
                throw new Error('Request timeout. Please try again.');
            } else {
                console.error('Network Error:', error.message);
                throw new Error('Unable to connect to grammar checking service');
            }
            
            throw error;
        }
    }

    /**
     * Categorizes errors by type
     * @param {Array} matches Array of grammar matches
     * @returns {Object} Categorized errors
     */
    categorizeErrors(matches) {
        const categories = {
            grammar: 0,
            spelling: 0,
            style: 0,
            punctuation: 0,
            other: 0
        };

        matches.forEach(match => {
            const category = match.rule?.category?.id?.toLowerCase() || '';
            const ruleId = match.rule?.id?.toLowerCase() || '';
            
            if (category.includes('typo') || category.includes('spell') || ruleId.includes('spell')) {
                categories.spelling++;
            } else if (category.includes('grammar') || ruleId.includes('grammar')) {
                categories.grammar++;
            } else if (category.includes('style') || ruleId.includes('style')) {
                categories.style++;
            } else if (category.includes('punct') || ruleId.includes('punct')) {
                categories.punctuation++;
            } else {
                categories.other++;
            }
        });

        return categories;
    }

    /**
     * Filters and ranks suggestions based on context and relevance
     * @param {Object} match Grammar match object
     * @returns {Array} Ranked suggestions
     */
    rankSuggestions(match) {
        if (!match.replacements || match.replacements.length === 0) {
            return [];
        }

        // Sort suggestions by relevance
        return match.replacements
            .sort((a, b) => {
                // Prefer shorter suggestions for simple corrections
                const lengthDiff = Math.abs(a.value.length - match.length) - Math.abs(b.value.length - match.length);
                if (lengthDiff !== 0) return lengthDiff;
                
                // Prefer alphabetically first if same length difference
                return a.value.localeCompare(b.value);
            })
            .slice(0, 3); // Return top 3 suggestions maximum
    }

    /**
     * Detects if text language matches selected language
     * @param {string} text Text to analyze
     * @param {string} selectedLanguage Selected language code
     * @returns {Object} Detection result
     */
    detectLanguageMismatch(text, selectedLanguage) {
        // Language-specific patterns
        const patterns = {
            'en-US': {
                common: /\b(the|and|is|are|was|were|have|has|will|would|this|that|with|from)\b/gi,
                unique: /\b(color|center|realize|organize|analyze)\b/gi
            },
            'en-GB': {
                common: /\b(the|and|is|are|was|were|have|has|will|would|this|that|with|from)\b/gi,
                unique: /\b(colour|centre|realise|organise|analyse)\b/gi
            },
            'de-DE': {
                common: /\b(der|die|das|und|ist|sind|war|waren|haben|hat|wird|mit|von)\b/gi,
                unique: /[äöüßÄÖÜ]/g
            },
            'fr': {
                common: /\b(le|la|les|et|est|sont|était|avoir|avec|de|dans|pour)\b/gi,
                unique: /[àâäéèêëïîôöùûüÿç]/g
            },
            'es': {
                common: /\b(el|la|los|las|y|es|son|era|tener|con|de|en|para)\b/gi,
                unique: /[ñáéíóúü]/g
            },
            'nl': {
                common: /\b(de|het|en|is|zijn|was|hebben|met|van|in|voor)\b/gi,
                unique: /\b(ij|zij|wij|mij|jij)\b/gi
            }
        };

        const selectedPattern = patterns[selectedLanguage];
        if (!selectedPattern) {
            return { mismatch: false, confidence: 0 };
        }

        let maxScore = 0;
        let detectedLanguage = selectedLanguage;

        // Test each language pattern
        Object.entries(patterns).forEach(([lang, pattern]) => {
            const commonMatches = (text.match(pattern.common) || []).length;
            const uniqueMatches = (text.match(pattern.unique) || []).length;
            
            const score = commonMatches + (uniqueMatches * 2); // Weight unique patterns more
            
            if (score > maxScore) {
                maxScore = score;
                detectedLanguage = lang;
            }
        });

        const mismatch = detectedLanguage !== selectedLanguage && 
                         !(detectedLanguage.startsWith('en-') && selectedLanguage.startsWith('en-'));

        return {
            mismatch,
            detectedLanguage,
            selectedLanguage,
            confidence: maxScore / text.split(/\s+/).length
        };
    }
}

// EXPORT ĐÚNG CÁCH - CHỈ EXPORT CLASS
module.exports = LanguageToolService;