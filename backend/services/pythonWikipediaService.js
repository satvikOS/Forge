const { spawn } = require('child_process');

/**
 * Python Wikipedia Service
 * Uses Python's wikipedia package for better data extraction than the REST API
 * Provides enhanced architectural data parsing capabilities
 */
class PythonWikipediaService {
  constructor() {
    this.enabled = process.env.ENABLE_PYTHON_WIKIPEDIA !== 'false';
  }

  /**
   * Check if service is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Search for architecture/landmark using Python wikipedia package
   */
  async searchArchitecture(query) {
    if (!this.isEnabled()) {
      console.log('Python Wikipedia is not enabled, skipping search');
      return null;
    }

    return new Promise((resolve, reject) => {
      const pythonCode = `
import wikipedia
import json
import sys

try:
    # Set language to English
    wikipedia.set_lang("en")
    
    # Search for the page
    page = wikipedia.page("${query.replace(/"/g, '\\"')}", auto_suggest=True)
    
    result = {
        "title": page.title,
        "summary": page.summary,
        "url": page.url,
        "content": page.content[:5000]  # First 5000 chars to avoid too much data
    }
    print(json.dumps(result))
except wikipedia.exceptions.DisambiguationError as e:
    # Multiple matches - take first option
    try:
        page = wikipedia.page(e.options[0])
        result = {
            "title": page.title,
            "summary": page.summary,
            "url": page.url,
            "content": page.content[:5000]
        }
        print(json.dumps(result))
    except Exception as inner_e:
        print(json.dumps({"error": str(inner_e)}))
except wikipedia.exceptions.PageError:
    print(json.dumps({"error": "Page not found"}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

      const python = spawn('python3', ['-c', pythonCode]);
      
      let stdout = '';
      let stderr = '';
      
      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      python.on('close', (code) => {
        if (code !== 0 || stderr) {
          console.warn('Python Wikipedia warning:', stderr);
        }
        
        try {
          const result = JSON.parse(stdout);
          if (result.error) {
            console.error('Python Wikipedia error:', result.error);
            resolve(null);
          } else {
            console.log(`✅ Python Wikipedia: Found "${result.title}"`);
            resolve(result);
          }
        } catch (e) {
          console.error('Failed to parse Python Wikipedia output:', e, stdout);
          resolve(null);
        }
      });
      
      python.on('error', (err) => {
        console.error('Failed to spawn Python process:', err);
        resolve(null);
      });
    });
  }

  /**
   * Extract architectural data from Wikipedia content
   */
  extractArchitecturalData(content, summary) {
    if (!content) return null;

    const fullText = (content + ' ' + summary).toLowerCase();
    
    // Extract height
    const heightPatterns = [
      /(\d+(?:\.\d+)?)\s*(?:m|meters|metres)(?:\s+tall|\s+high|\s+in height)/i,
      /height.*?(\d+(?:\.\d+)?)\s*(?:m|meters|metres)/i,
      /stands at (\d+(?:\.\d+)?)\s*(?:m|meters|metres)/i,
      /(\d+(?:\.\d+)?)\s*(?:m|meters|metres)\s*(?:\(|tall)/i
    ];
    
    let height = null;
    for (const pattern of heightPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        height = parseFloat(match[1]);
        break;
      }
    }
    
    // Extract width/base dimensions
    const widthPatterns = [
      /base.*?(\d+(?:\.\d+)?)\s*(?:m|meters|metres).*?(?:×|x|by)\s*(\d+(?:\.\d+)?)\s*(?:m|meters|metres)/i,
      /(\d+(?:\.\d+)?)\s*(?:m|meters|metres)\s*(?:×|x|by)\s*(\d+(?:\.\d+)?)\s*(?:m|meters|metres).*?base/i,
      /width.*?(\d+(?:\.\d+)?)\s*(?:m|meters|metres)/i
    ];
    
    let width = null;
    let depth = null;
    for (const pattern of widthPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        width = parseFloat(match[1]);
        depth = match[2] ? parseFloat(match[2]) : width;
        break;
      }
    }
    
    // Extract floor count
    const floorsPatterns = [
      /(\d+)\s*(?:floors|stories|storeys)/i,
      /(\d+)-(?:floor|story|storey)/i
    ];
    
    let floors = null;
    for (const pattern of floorsPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        floors = parseInt(match[1]);
        break;
      }
    }
    
    // Extract architect
    const architectMatch = content.match(/architect.*?(?:is|was|:)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
    const architect = architectMatch ? architectMatch[1] : null;
    
    // Extract year/period
    const yearMatch = fullText.match(/(?:built|constructed|completed).*?(\d{4})/i);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;
    
    // Extract architectural style
    const stylePatterns = [
      /art deco/i,
      /gothic/i,
      /baroque/i,
      /modernist/i,
      /neoclassical/i,
      /romanesque/i,
      /renaissance/i,
      /brutalist/i,
      /contemporary/i
    ];
    
    let style = null;
    for (const pattern of stylePatterns) {
      if (fullText.match(pattern)) {
        style = pattern.source.replace(/\\/g, '').replace(/i$/, '');
        break;
      }
    }
    
    // Extract materials
    const materialKeywords = ['iron', 'steel', 'concrete', 'stone', 'glass', 'brick', 'wood', 'limestone', 'granite', 'marble'];
    const materials = [];
    for (const material of materialKeywords) {
      if (fullText.includes(material)) {
        materials.push(material);
      }
    }
    
    return {
      height,
      width,
      depth,
      floors,
      architect,
      year,
      style,
      materials: materials.length > 0 ? materials : null
    };
  }

  /**
   * Search for landmark and extract architectural data
   */
  async getLandmarkData(landmarkName) {
    console.log(`🔍 Python Wikipedia: Searching for "${landmarkName}"...`);
    
    const pageData = await this.searchArchitecture(landmarkName);
    if (!pageData || pageData.error) {
      console.log(`❌ Python Wikipedia: Could not find data for "${landmarkName}"`);
      return null;
    }
    
    const architecturalData = this.extractArchitecturalData(pageData.content, pageData.summary);
    
    const result = {
      title: pageData.title,
      summary: pageData.summary,
      url: pageData.url,
      dimensions: architecturalData,
      source: 'python-wikipedia'
    };
    
    console.log(`✅ Python Wikipedia: Extracted data for "${pageData.title}":`, {
      height: architecturalData.height,
      width: architecturalData.width,
      floors: architecturalData.floors,
      style: architecturalData.style,
      materials: architecturalData.materials
    });
    
    return result;
  }
}

module.exports = new PythonWikipediaService();
