/**
 * ArchDisc Foundation — autonomous design orchestrator.
 *
 * Product-AGNOSTIC. The engine work was only an example; this engine
 * builds ANY mechanical product to the same depth. Given a part graph
 * it drives every part through its own closing design loop, in
 * dependency order, then checks every interface between connected
 * parts, assembles, and system-tests the whole.
 *
 * A part is never "done" because it was drawn — it is done when a real
 * analysis on its own model meets criteria, and failures drive a
 * redesign (see foundation/DesignLoop.js). The orchestrator applies that
 * discipline to every node of the graph and refuses to call the product
 * accepted unless every part, every interface and the system test pass.
 *
 * This is the deterministic substrate. In the product, an LLM planner
 * decomposes a brief into the part graph and per-part agents supply the
 * build/analyse/judge/redesign reasoning; here those are plain functions,
 * so the orchestration itself is fully testable without a model.
 *
 *   PartNode  = {
 *     id, name,
 *     dependsOn?: string[],          // ids that must be designed first
 *     loop: { params, build, analyse, judge, redesign, maxIterations? },
 *   }
 *   Interface = { a, b, name?, check(resultA, resultB) -> {pass,message} }
 *   Graph     = { brief?, parts: PartNode[], interfaces?: Interface[],
 *                 assemble?(parts)->any, systemTest?(parts,assembly)->{pass,..} }
 *
 * Kernel-free pure math — node-importable for e2e.
 */

import { runDesignLoop } from './DesignLoop.js';

/** Kahn topological sort over PartNode.dependsOn. Throws on a cycle. */
function topoOrder(parts) {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const indeg = new Map(parts.map((p) => [p.id, 0]));
  for (const p of parts) {
    for (const d of p.dependsOn || []) {
      if (!byId.has(d)) throw new Error(`part "${p.id}" depends on unknown "${d}"`);
      indeg.set(p.id, indeg.get(p.id) + 1);
    }
  }
  const ready = parts.filter((p) => indeg.get(p.id) === 0);
  const order = [];
  while (ready.length) {
    const p = ready.shift();
    order.push(p);
    for (const q of parts) {
      if ((q.dependsOn || []).includes(p.id)) {
        indeg.set(q.id, indeg.get(q.id) - 1);
        if (indeg.get(q.id) === 0) ready.push(q);
      }
    }
  }
  if (order.length !== parts.length) throw new Error('part graph has a dependency cycle');
  return order;
}

/**
 * Orchestrate an autonomous design run over a part graph.
 *
 * @param {Graph} graph
 * @returns {{
 *   brief, partCount, partsPassed, parts, interfaces, assembly,
 *   systemTest, accepted, summary
 * }}
 */
export function orchestrate(graph) {
  if (!graph || !Array.isArray(graph.parts) || !graph.parts.length) {
    throw new Error('orchestrate: graph.parts must be a non-empty array');
  }
  const order = topoOrder(graph.parts);

  // ── per-part: run each part's closing design loop ──
  const parts = {};
  for (const node of order) {
    const lr = runDesignLoop(node.loop);
    parts[node.id] = {
      id: node.id,
      name: node.name,
      converged: lr.converged,
      iterations: lr.iterations,
      params: lr.params,
      analysis: lr.analysis,
      verdict: lr.judged ? lr.judged.message : 'no judgement',
      history: lr.history,
    };
  }
  const partsPassed = Object.values(parts).filter((p) => p.converged).length;

  // ── interfaces: every connection between two parts is checked ──
  const interfaces = (graph.interfaces || []).map((intf) => {
    const v = intf.check(parts[intf.a], parts[intf.b]) || { pass: false, message: 'no result' };
    return { between: [intf.a, intf.b], name: intf.name || `${intf.a}↔${intf.b}`, ...v };
  });
  const interfacesPassed = interfaces.filter((i) => i.pass).length;

  // ── assemble + system-test the whole product ──
  const assembly = graph.assemble ? graph.assemble(parts) : null;
  const systemTest = graph.systemTest ? graph.systemTest(parts, assembly) : null;

  const allParts = partsPassed === graph.parts.length;
  const allIfaces = interfacesPassed === interfaces.length;
  const sysOK = !systemTest || systemTest.pass;
  const accepted = allParts && allIfaces && sysOK;

  return {
    brief: graph.brief || null,
    partCount: graph.parts.length,
    partsPassed,
    parts,
    interfaces,
    interfacesPassed,
    assembly,
    systemTest,
    accepted,
    summary: accepted
      ? `accepted — ${partsPassed}/${graph.parts.length} parts, `
        + `${interfacesPassed}/${interfaces.length} interfaces, system test ${sysOK ? 'passed' : 'failed'}`
      : `NOT accepted — parts ${partsPassed}/${graph.parts.length}, `
        + `interfaces ${interfacesPassed}/${interfaces.length}, `
        + `system test ${systemTest ? (sysOK ? 'passed' : 'FAILED') : 'n/a'}`,
  };
}
