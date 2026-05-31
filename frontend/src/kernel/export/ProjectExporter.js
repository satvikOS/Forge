/**
 * ArchDisc — Project Exporter
 *
 * Emits a complete project as a hierarchy of files — one folder per
 * subsystem, one file per component, plus aggregated summary files.
 *
 * Layout produced:
 *
 *   <root>/
 *     manifest.json                    -- entire project description
 *     hierarchy.json                   -- component tree
 *     bom.csv                          -- bill of materials (CSV + JSON)
 *     bom.json
 *     stats.json                       -- counts by category, material, mass
 *     analyses.json                    -- aggregated FEA/CFD/modal results
 *     tests.json                       -- aggregated real-world test results
 *     interactions.jsonl               -- recorded session log
 *     parts/
 *       FAN/
 *         BLD/
 *           GE9X-FAN-BLD-0001.json     -- metadata
 *           GE9X-FAN-BLD-0001.stl      -- geometry (mesh)
 *           GE9X-FAN-BLD-0001.tests.json  -- per-part tests
 *           GE9X-FAN-BLD-0001.fea.json    -- per-part analyses
 *         HUB/
 *           ...
 *       HPT/
 *         ...
 *
 * Returns an in-memory file-tree object (path -> content). The caller
 * (e.g. Playwright test or Electron) writes those to disk.
 */

import PartIDRegistry from '../registry/PartIDRegistry.js';
import ExportEngine from './ExportEngine.js';
import InteractionRecorder from '../recording/InteractionRecorder.js';

export default class ProjectExporter {

  /**
   * Build the complete project file tree.
   * @param {object} [options]
   * @param {boolean} [options.includeGeometry=true] - emit STL per part
   * @param {boolean} [options.includeBinarySTL=false] - binary STL instead of ASCII
   * @param {string}  [options.format='stl'] - 'stl' | 'obj' | 'gltf'
   * @param {Assembly} [options.assembly]    - assembly to pull solids from (used to resolve PartInstance back to TopoSolid)
   * @returns {object} { files: Map<path, content>, manifest, stats }
   */
  static buildFileTree(options = {}) {
    const {
      includeGeometry = true,
      includeBinarySTL = false,
      format = 'stl',
    } = options;

    const files = new Map();
    const entries = PartIDRegistry.all();
    const stats = PartIDRegistry.stats();

    // Per-part files
    let geometryEmitted = 0;
    let geometryFailed = 0;

    for (const entry of entries) {
      const dir = `parts/${entry.category}/${entry.subsystem}`;

      // Metadata JSON
      const meta = {
        partID: entry.partID,
        name: entry.name,
        category: entry.category,
        subsystem: entry.subsystem,
        sequence: entry.sequence,
        material: entry.material,
        parentID: entry.parentID,
        children: entry.children,
        metadata: entry.metadata,
        revisions: entry.revisions,
        registeredAt: new Date(entry.registeredAt).toISOString(),
      };
      files.set(`${dir}/${entry.partID}.json`, JSON.stringify(meta, null, 2));

      // Geometry
      if (includeGeometry && entry.partInstance?.solid) {
        try {
          if (format === 'stl' && includeBinarySTL) {
            const buf = ExportEngine.toSTLBinary(entry.partInstance.solid);
            files.set(`${dir}/${entry.partID}.stl`, buf);
          } else if (format === 'stl') {
            const text = ExportEngine.toSTL(entry.partInstance.solid, entry.partID);
            files.set(`${dir}/${entry.partID}.stl`, text);
          } else if (format === 'obj') {
            const text = ExportEngine.toOBJ(entry.partInstance.solid);
            files.set(`${dir}/${entry.partID}.obj`, text);
          }
          geometryEmitted++;
        } catch (e) {
          geometryFailed++;
        }
      }

      // Tests
      if (entry.tests.length > 0) {
        files.set(`${dir}/${entry.partID}.tests.json`, JSON.stringify(entry.tests, null, 2));
      }

      // Analyses
      if (entry.analyses.length > 0) {
        files.set(`${dir}/${entry.partID}.fea.json`, JSON.stringify(entry.analyses, null, 2));
      }
    }

    // Hierarchy
    files.set('hierarchy.json', JSON.stringify(PartIDRegistry.tree(), null, 2));

    // BOM (CSV + JSON)
    const bom = ProjectExporter._buildBOM(entries);
    files.set('bom.json', JSON.stringify(bom, null, 2));
    files.set('bom.csv', ProjectExporter._bomToCSV(bom));

    // Stats
    files.set('stats.json', JSON.stringify({
      ...stats,
      geometryEmitted,
      geometryFailed,
      generatedAt: new Date().toISOString(),
    }, null, 2));

    // Analyses aggregate
    const allAnalyses = [];
    for (const e of entries) {
      for (const a of e.analyses) {
        allAnalyses.push({ partID: e.partID, ...a });
      }
    }
    files.set('analyses.json', JSON.stringify(allAnalyses, null, 2));

    // Tests aggregate
    const allTests = [];
    for (const e of entries) {
      for (const t of e.tests) {
        allTests.push({ partID: e.partID, ...t });
      }
    }
    files.set('tests.json', JSON.stringify(allTests, null, 2));

    // Interactions log (if recording was active)
    if (InteractionRecorder.count() > 0) {
      files.set('interactions.jsonl', InteractionRecorder.toJSONL());
    }

    // Manifest
    const manifest = {
      project: stats.project,
      generatedAt: new Date().toISOString(),
      totalComponents: entries.length,
      totalFiles: files.size,
      categories: stats.byCategory,
      subsystems: stats.bySubsystem,
      materials: stats.byMaterial,
      totalTests: stats.totalTests,
      totalAnalyses: stats.totalAnalyses,
      geometryEmitted,
      geometryFailed,
      format,
    };
    files.set('manifest.json', JSON.stringify(manifest, null, 2));

    return { files, manifest, stats };
  }

  /** Build BOM by grouping identical names. */
  static _buildBOM(entries) {
    const grouped = new Map();
    for (const e of entries) {
      const key = `${e.category}-${e.subsystem}-${e.name}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          item: grouped.size + 1,
          name: e.name,
          category: e.category,
          subsystem: e.subsystem,
          material: e.material,
          qty: 0,
          partIDs: [],
        });
      }
      const g = grouped.get(key);
      g.qty++;
      if (g.partIDs.length < 5) g.partIDs.push(e.partID);
    }
    return Array.from(grouped.values()).sort((a, b) => b.qty - a.qty);
  }

  /** BOM JSON to CSV. */
  static _bomToCSV(bom) {
    const lines = ['Item,Name,Category,Subsystem,Material,Qty,Sample IDs'];
    for (const e of bom) {
      const sample = e.partIDs.join('; ');
      const safe = (s) => `"${String(s).replace(/"/g, '""')}"`;
      lines.push([
        e.item,
        safe(e.name),
        safe(e.category),
        safe(e.subsystem),
        safe(e.material),
        e.qty,
        safe(sample),
      ].join(','));
    }
    return lines.join('\n');
  }

  /**
   * Convenience: compute total bytes that would be written.
   */
  static estimateSize(fileTree) {
    let total = 0;
    for (const [, content] of fileTree.files) {
      if (typeof content === 'string') total += content.length;
      else if (content?.byteLength) total += content.byteLength;
    }
    return total;
  }
}
