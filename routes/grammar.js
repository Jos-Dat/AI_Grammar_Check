// routes/grammar.js - Minimal changes to your existing code
const express = require('express');
const { body, validationResult } = require('express-validator');
const LanguageToolService = require('../services/languageToolService');
const router = express.Router();

const languageToolService = new LanguageToolService();

// KEEP YOUR EXISTING middleware
const freeUsageTracker = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const sessionId = req.headers['x-session-id'] || ip;
  
  if (!global.freeUsage) {
    global.freeUsage = new Map();
  }
  
  const userUsage = global.freeUsage.get(sessionId) || { count: 0, firstUse: Date.now() };
  
  if (Date.now() - userUsage.firstUse > 24 * 60 * 60 * 1000) {
    userUsage.count = 0;
    userUsage.firstUse = Date.now();
  }
  
  req.freeUsageCount = userUsage.count;
  req.sessionId = sessionId;
  
  next();
};

// ADDED: Language detection function
function detectTextLanguage(text) {
  const patterns = {
    'de-DE': {
      chars: /[äöüßÄÖÜ]/g,
      words: /\b(der|die|das|und|ist|sind|ich|wir|sie|er|es)\b/gi
    },
    'fr': {
      chars: /[àâäéèêëïîôöùûüÿç]/g,
      words: /\b(le|la|les|et|est|sont|je|nous|vous|ils|elles)\b/gi
    },
    'es': {
      chars: /[ñáéíóúü]/g,
      words: /\b(el|la|los|las|y|es|son|yo|nosotros|ellos)\b/gi
    },
    'nl': {
      chars: /\b(ij|zij|wij|mij|jij)\b/gi,
      words: /\b(de|het|en|is|zijn|ik|wij|zij|hij)\b/gi
    },
    'en-US': {
      chars: /^[a-zA-Z\s.,!?;:'"()\-0-9]+$/,
      words: /\b(the|and|is|are|was|were|have|has|will|would|I|we|you|he|she|it|they)\b/gi
    }
  };
  
  let scores = {};
  
  for (const [lang, pattern] of Object.entries(patterns)) {
    scores[lang] = 0;
    
    const charMatches = text.match(pattern.chars) || [];
    scores[lang] += charMatches.length * 3;
    
    const wordMatches = text.match(pattern.words) || [];
    scores[lang] += wordMatches.length * 2;
  }
  
  const detectedLang = Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b);
  
  if (scores[detectedLang] === 0) {
    return 'en-US';
  }
  
  return detectedLang;
}

// KEEP YOUR EXISTING validation rules
const checkGrammarValidation = [
  body('text')
    .trim()
    .isLength({ min: 1, max: 10000 })
    .withMessage('Text must be between 1 and 10,000 characters'),
  body('language')
    .optional()
    .isIn(['en-US', 'en-GB', 'de-DE', 'es', 'fr', 'nl'])
    .withMessage('Invalid language code')
];

// MAIN CHANGES: Updated grammar check route
router.post('/check', freeUsageTracker, checkGrammarValidation, async (req, res) => {
  try {
    const authToken = req.headers.authorization;
    const isAuthenticated = authToken && authToken.startsWith('Bearer ');
    
    // ADDED: Check free usage limit BEFORE processing
    if (!isAuthenticated && req.freeUsageCount >= 3) {
      return res.status(403).json({
        success: false,
        error: 'Free usage limit reached (3/3). Please register or login to continue.',
        requiresAuth: true,
        remainingChecks: 0
      });
    }
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { text, language = 'en-US' } = req.body;
    const sanitizedText = text.replace(/[<>]/g, '');
    
    // ADDED: Language detection and validation
    const detectedLanguage = detectTextLanguage(sanitizedText);
    
    const isLanguageMatch = 
      detectedLanguage === language ||
      (detectedLanguage.startsWith('en-') && language.startsWith('en-'));
    
    if (!isLanguageMatch) {
      const languageNames = {
        'en-US': 'English (US)',
        'en-GB': 'English (UK)', 
        'de-DE': 'German',
        'fr': 'French',
        'es': 'Spanish',
        'nl': 'Dutch'
      };
      
      return res.status(400).json({
        success: false,
        error: `Language mismatch detected. Text appears to be in ${languageNames[detectedLanguage] || detectedLanguage} but ${languageNames[language]} was selected. Please select the correct language.`,
        detectedLanguage: detectedLanguage,
        selectedLanguage: language
      });
    }
    
    // KEEP YOUR EXISTING: Call LanguageTool API
    const result = await languageToolService.checkGrammar(sanitizedText, language);
    
    // KEEP YOUR EXISTING: Update usage count
    if (!isAuthenticated) {
      const userUsage = global.freeUsage.get(req.sessionId) || { count: 0, firstUse: Date.now() };
      userUsage.count++;
      global.freeUsage.set(req.sessionId, userUsage);
    }
    
    // CHANGED: Process matches to show only BEST suggestion
    const processedMatches = result.matches?.map(match => {
      // Get only the FIRST (best) replacement - this is the key change
      const bestReplacement = match.replacements && match.replacements.length > 0 
        ? [match.replacements[0]]  // Only return the best one
        : [];
      
      return {
        offset: match.offset,
        length: match.length,
        message: match.message,
        shortMessage: match.shortMessage || match.message,
        category: match.rule?.category?.name || 'Grammar',
        ruleId: match.rule?.id,
        severity: match.rule?.category?.id === 'TYPOS' ? 'spelling' : 'grammar',
        replacements: bestReplacement, // Only best suggestion
        context: {
          text: match.context?.text || '',
          offset: match.context?.offset || 0,
          length: match.context?.length || 0
        }
      };
    }) || [];
    
    // KEEP YOUR EXISTING: Process result structure
    const processedResult = {
      matches: processedMatches,
      language: {
        detected: detectedLanguage,
        selected: language,
        name: result.language?.name || 'Unknown'
      },
      statistics: {
        totalErrors: processedMatches.length,
        errorTypes: languageToolService.categorizeErrors(processedMatches),
        processingTime: Date.now() - req.startTime,
        textLength: sanitizedText.length,
        wordCount: sanitizedText.split(/\s+/).filter(word => word.length > 0).length
      },
      usage: {
        remainingChecks: isAuthenticated ? 'unlimited' : Math.max(0, 3 - (req.freeUsageCount + 1)),
        isAuthenticated,
        usedChecks: isAuthenticated ? 0 : (req.freeUsageCount + 1)
      }
    };

    res.json({
      success: true,
      data: processedResult,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Grammar check error:', error);
    
    if (error.name === 'LanguageToolError') {
      return res.status(503).json({
        success: false,
        error: 'Grammar checking service temporarily unavailable'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to check grammar'
    });
  }
});

// KEEP ALL YOUR EXISTING ROUTES
router.get('/languages', (req, res) => {
  res.json({
    success: true,
    data: {
      languages: [
        { code: 'en-US', name: 'English (US)', flag: '🇺🇸' },
        { code: 'en-GB', name: 'English (UK)', flag: '🇬🇧' },
        { code: 'de-DE', name: 'Deutsch', flag: '🇩🇪' },
        { code: 'es', name: 'Español', flag: '🇪🇸' },
        { code: 'fr', name: 'Français', flag: '🇫🇷' },
        { code: 'nl', name: 'Netherlands', flag: 'NL' }
      ]
    }
  });
});

router.get('/usage', freeUsageTracker, (req, res) => {
  const authToken = req.headers.authorization;
  const isAuthenticated = authToken && authToken.startsWith('Bearer ');
  
  res.json({
    success: true,
    data: {
      used: isAuthenticated ? 0 : req.freeUsageCount,
      remaining: isAuthenticated ? 'unlimited' : Math.max(0, 3 - req.freeUsageCount),
      limit: isAuthenticated ? 'unlimited' : 3,
      isAuthenticated
    }
  });
});

// KEEP YOUR EXISTING middleware
router.use((req, res, next) => {
  req.startTime = Date.now();
  next();
});

module.exports = router;