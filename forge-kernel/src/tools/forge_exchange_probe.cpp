// forge_exchange_probe.cpp — ONE FILE, ONE PROCESS: the import/export instrument.
//
// WHAT IT IS FOR. Round-trip fidelity is the measurement that decides whether an
// exchange feature works, and it cannot be measured in-process across a corpus:
// OCCT segfaults on some real parts (see reports/OCCT_NULL_PCURVE_SEGV.md) and a
// handful exceed any sane timeout. A batch tool that shares one address space
// with 600 parts reports the first crash and nothing else — the classic "one
// failure destroys the batch" shape. So this probe does ONE file per process,
// and a bad part costs exactly that part.
//
// WHAT IT PRINTS. NDJSON on stdout, ONE LINE PER STAGE, FLUSHED. That is not a
// style choice: if the re-import segfaults, the import and export lines have
// already been written, so the crash costs the stage it happened in rather than
// the whole record. A driver reads whatever arrived and reports the rest as the
// failure it was.
//
//   {"stage":"import", ...observables of the body as imported...}
//   {"stage":"export", ...bytes written, whether analytic...}
//   {"stage":"reimport", ...observables of the body read back...}
//   {"stage":"loss",   ...forge::ui::compareObservables of the two...}
//
// ★ THE LOSS DEFINITION IS NOT DUPLICATED HERE. This tool links
// ui/src/ExchangeModel.cpp and calls forge::ui::compareObservables — the same
// function the headless UI gate asserts on. A second comparison written in the
// driver would be a second definition of "fidelity", and the one that drifts is
// always the one with fewer users.
//
// Usage:
//   forge_exchange_probe --in <path> [--format auto|step|iges|brep|stl|obj]
//                        [--source-units mm|cm|m|um|in|ft] [--document-units ...]
//                        [--heal none|standard|aggressive] [--tolerance <mm>]
//                        [--no-tolerate-degenerate]
//                        [--out <path> --out-format step|brep|stl|obj]
//                        [--out-units ...] [--linear-tol <mm>] [--angular-tol <rad>]
//                        [--faceted] [--roundtrip]
//
// --roundtrip implies re-importing --out and emitting the loss line.
// Exit code: 0 when the IMPORT produced a body, 2 when it did not, 3 on a usage
// error. A crash is a crash and the driver reads it from the signal, which is
// exactly the honesty this design is for.

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "forge/ExchangeService.hpp"
#include "forge/ui/ExchangeModel.hpp"

namespace {

// ── JSON, the minimum ───────────────────────────────────────────────────────
std::string esc(const std::string& s) {
    std::string o;
    o.reserve(s.size() + 8);
    for (char c : s) {
        switch (c) {
            case '"':  o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n";  break;
            case '\r': o += "\\r";  break;
            case '\t': o += "\\t";  break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char b[8];
                    std::snprintf(b, sizeof b, "\\u%04x", static_cast<unsigned>(c) & 0xFFu);
                    o += b;
                } else {
                    o += c;
                }
        }
    }
    return o;
}

std::string num(double v) {
    char b[64];
    std::snprintf(b, sizeof b, "%.12g", v);
    return std::string(b);
}

std::string jsonObserved(const forge::exchange::Observed& o) {
    std::string s;
    s += "\"measured\":";
    s += o.measured ? "true" : "false";
    s += ",\"valid\":";
    s += o.valid ? "true" : "false";
    s += ",\"closed\":";
    s += o.closed ? "true" : "false";
    s += ",\"manifold\":";
    s += o.manifold ? "true" : "false";
    s += ",\"oriented\":";
    s += o.oriented ? "true" : "false";
    s += ",\"volume\":" + num(o.volume);
    s += ",\"area\":" + num(o.area);
    s += ",\"com\":[" + num(o.com[0]) + "," + num(o.com[1]) + "," + num(o.com[2]) + "]";
    s += ",\"bboxMin\":[" + num(o.bboxMin[0]) + "," + num(o.bboxMin[1]) + "," +
         num(o.bboxMin[2]) + "]";
    s += ",\"bboxMax\":[" + num(o.bboxMax[0]) + "," + num(o.bboxMax[1]) + "," +
         num(o.bboxMax[2]) + "]";
    s += ",\"solids\":" + std::to_string(o.solidCount);
    s += ",\"shells\":" + std::to_string(o.shellCount);
    s += ",\"faces\":" + std::to_string(o.faceCount);
    s += ",\"edges\":" + std::to_string(o.edgeCount);
    s += ",\"vertices\":" + std::to_string(o.vertexCount);
    s += ",\"genus\":" + std::to_string(o.genus);
    s += ",\"meshShells\":" + std::to_string(o.meshShellCount);
    s += ",\"meshVertices\":" + std::to_string(o.meshVertexCount);
    return s;
}

std::string jsonDiagnostics(const std::vector<forge::exchange::Diagnostic>& ds,
                            std::size_t dropped) {
    std::string s = "\"diagnostics\":[";
    for (std::size_t i = 0; i < ds.size(); ++i) {
        if (i) s += ",";
        s += "{\"severity\":" + std::to_string(ds[i].severity);
        s += ",\"code\":\"" + esc(ds[i].code) + "\"";
        s += ",\"message\":\"" + esc(ds[i].message) + "\"";
        s += ",\"entity\":\"" + esc(ds[i].entity) + "\"}";
    }
    s += "],\"diagnosticsDropped\":" + std::to_string(dropped);
    return s;
}

void emit(const std::string& body) {
    // ONE LINE, FLUSHED. A stage that is not on the wire before the next stage
    // starts is a stage a segfault erases.
    std::fputs(("{" + body + "}\n").c_str(), stdout);
    std::fflush(stdout);
}

// ── the ui <-> kernel observable mapping ────────────────────────────────────
// Mechanical, and in exactly one place. The B-rep census is the authority for
// face/edge/vertex/shell counts because it describes the SHAPE; the tessellated
// weld-betti numbers supply genus, which the B-rep census cannot give.
forge::ui::Observables toUi(const forge::exchange::Observed& o) {
    forge::ui::Observables u;
    u.measured = o.measured;
    u.valid = o.valid;
    u.volume = o.volume;
    u.area = o.area;
    for (int i = 0; i < 3; ++i) {
        u.com[i] = o.com[i];
        u.bboxMin[i] = o.bboxMin[i];
        u.bboxMax[i] = o.bboxMax[i];
    }
    u.faceCount = o.faceCount;
    u.edgeCount = o.edgeCount;
    u.vertexCount = o.vertexCount;
    u.genus = o.genus;
    u.shellCount = o.shellCount;
    return u;
}

// Read the head of a file so forge::ui::sniffFormat can do its job. 512 bytes is
// four times what any magic here needs, and the binary-STL rule wants 84.
bool readHead(const std::string& path, std::string& head, std::uint64_t& size) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (f == nullptr) return false;
    if (std::fseek(f, 0, SEEK_END) != 0) { std::fclose(f); return false; }
    const long end = std::ftell(f);
    if (end < 0) { std::fclose(f); return false; }
    size = static_cast<std::uint64_t>(end);
    std::rewind(f);
    char buf[512];
    const std::size_t n = std::fread(buf, 1, sizeof buf, f);
    head.assign(buf, n);
    std::fclose(f);
    return true;
}

forge::exchange::Format toKernelFormat(forge::ui::ExchangeFormat f) {
    switch (f) {
        case forge::ui::ExchangeFormat::Step: return forge::exchange::Format::Step;
        case forge::ui::ExchangeFormat::Iges: return forge::exchange::Format::Iges;
        case forge::ui::ExchangeFormat::Brep: return forge::exchange::Format::Brep;
        case forge::ui::ExchangeFormat::Stl:  return forge::exchange::Format::Stl;
        case forge::ui::ExchangeFormat::Obj:  return forge::exchange::Format::Obj;
        default: return forge::exchange::Format::Unknown;
    }
}

const char* arg(int argc, char** argv, const char* name, const char* dflt) {
    for (int i = 1; i + 1 < argc; ++i) {
        if (std::strcmp(argv[i], name) == 0) return argv[i + 1];
    }
    return dflt;
}

bool has(int argc, char** argv, const char* name) {
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], name) == 0) return true;
    }
    return false;
}

}  // namespace

int main(int argc, char** argv) {
    const char* inPath = arg(argc, argv, "--in", nullptr);
    if (inPath == nullptr) {
        std::fprintf(stderr, "usage: forge_exchange_probe --in <file> [--out <file>] "
                             "[--roundtrip] [--format ...] ...\n");
        return 3;
    }
    const std::string id = arg(argc, argv, "--id", inPath);

    // ── options, through the ONE model ──────────────────────────────────────
    // Every rule about units, healing and tolerance is applied by forge::ui, not
    // re-decided here: this tool is a CALLER of the model, exactly like the
    // desktop dialog, which is what makes the experiment a measurement of the
    // shipping path rather than of a bespoke harness.
    forge::ui::ImportOptions iopts;
    const std::string fmtArg = arg(argc, argv, "--format", "auto");
    iopts.format = fmtArg == "auto" ? forge::ui::ExchangeFormat::Unknown
                                    : forge::ui::formatFromString(fmtArg);
    iopts.sourceUnit = forge::ui::unitFromString(arg(argc, argv, "--source-units", "mm"));
    iopts.documentUnit = forge::ui::unitFromString(arg(argc, argv, "--document-units", "mm"));
    iopts.autoDetectUnit = !has(argc, argv, "--source-units");
    iopts.heal = forge::ui::healPolicyFromString(arg(argc, argv, "--heal", "standard"));
    iopts.sewTolerance = std::atof(arg(argc, argv, "--tolerance", "0.001"));
    iopts.tolerateDegenerate = !has(argc, argv, "--no-tolerate-degenerate");
    iopts.maxDiagnostics = static_cast<std::size_t>(
        std::atol(arg(argc, argv, "--max-diagnostics", "64")));

    forge::ui::DiagnosticLog optLog;
    forge::ui::normaliseImportOptions(iopts, optLog);

    // ── the format: sniffed by the ONE sniffer ──────────────────────────────
    std::string head;
    std::uint64_t size = 0;
    if (!readHead(inPath, head, size)) {
        emit("\"stage\":\"import\",\"id\":\"" + esc(id) + "\",\"ok\":false,\"error\":\"cannot "
             "open the file\"");
        return 2;
    }
    forge::ui::SniffResult sniff;
    if (iopts.format == forge::ui::ExchangeFormat::Unknown) {
        sniff = forge::ui::sniffFormat(inPath, head, size);
    } else {
        sniff.format = iopts.format;
        sniff.confidence = forge::ui::SniffConfidence::Certain;
        sniff.evidence = "the caller pinned the format";
    }

    forge::exchange::ImportRequest req;
    req.path = inPath;
    req.format = toKernelFormat(sniff.format);
    req.scale = forge::ui::importScaleFactor(iopts);
    const forge::ui::HealingPlan plan = forge::ui::resolveHealing(iopts);
    req.sew = plan.sew;
    req.harmoniseNormals = plan.harmoniseNormals;
    req.unifyCoplanarFaces = plan.unifyCoplanarFaces;
    req.fillMissingFaces = plan.fillMissingFaces;
    req.repairSelfIntersections = plan.repairSelfIntersections;
    req.tolerance = plan.tolerance;
    req.tolerateDegenerate = iopts.tolerateDegenerate;
    req.maxDiagnostics = iopts.maxDiagnostics;

    const forge::exchange::ImportResult imp = forge::exchange::importFile(req);

    {
        std::string s = "\"stage\":\"import\",\"id\":\"" + esc(id) + "\"";
        s += ",\"path\":\"" + esc(inPath) + "\"";
        s += ",\"ok\":";
        s += imp.ok ? "true" : "false";
        s += ",\"error\":\"" + esc(imp.error) + "\"";
        s += ",\"format\":\"" + std::string(forge::exchange::toString(imp.format)) + "\"";
        s += ",\"sniffConfidence\":\"" +
             std::string(forge::ui::toString(sniff.confidence)) + "\"";
        s += ",\"sniffEvidence\":\"" + esc(sniff.evidence) + "\"";
        s += ",\"fileBytes\":" + std::to_string(imp.fileBytes);
        s += ",\"scaleApplied\":" + num(imp.scaleApplied);
        s += ",\"seconds\":" + num(imp.seconds);
        s += "," + jsonObserved(imp.observed);
        s += "," + jsonDiagnostics(imp.diagnostics, imp.diagnosticsDropped);
        emit(s);
    }

    if (!imp.ok) return 2;

    const char* outPath = arg(argc, argv, "--out", nullptr);
    const bool roundtrip = has(argc, argv, "--roundtrip");
    if (outPath == nullptr) {
        forge::exchange::release(imp.handle);
        return 0;
    }

    forge::ui::ExportOptions eopts;
    eopts.format = forge::ui::formatFromString(arg(argc, argv, "--out-format", "step"));
    eopts.documentUnit = iopts.documentUnit;
    eopts.targetUnit = forge::ui::unitFromString(arg(argc, argv, "--out-units", "mm"));
    eopts.preferAnalytic = !has(argc, argv, "--faceted");
    eopts.ascii = true;
    eopts.linearTolerance = std::atof(arg(argc, argv, "--linear-tol", "0.05"));
    eopts.angularTolerance = std::atof(arg(argc, argv, "--angular-tol", "0.08"));
    eopts.maxDiagnostics = iopts.maxDiagnostics;
    forge::ui::DiagnosticLog eLog;
    forge::ui::normaliseExportOptions(eopts, eLog);

    forge::exchange::ExportRequest ereq;
    ereq.path = outPath;
    ereq.handle = imp.handle;
    ereq.format = toKernelFormat(eopts.format);
    ereq.scale = forge::ui::exportScaleFactor(eopts);
    ereq.preferAnalytic = eopts.preferAnalytic;
    ereq.ascii = eopts.ascii;
    ereq.linearTolerance = eopts.linearTolerance;
    ereq.angularTolerance = eopts.angularTolerance;
    ereq.maxDiagnostics = eopts.maxDiagnostics;

    const forge::exchange::ExportResult exp = forge::exchange::exportFile(ereq);
    {
        std::string s = "\"stage\":\"export\",\"id\":\"" + esc(id) + "\"";
        s += ",\"path\":\"" + esc(outPath) + "\"";
        s += ",\"ok\":";
        s += exp.ok ? "true" : "false";
        s += ",\"error\":\"" + esc(exp.error) + "\"";
        s += ",\"format\":\"" + std::string(forge::exchange::toString(exp.format)) + "\"";
        s += ",\"fileBytes\":" + std::to_string(exp.fileBytes);
        s += ",\"analytic\":";
        s += exp.analytic ? "true" : "false";
        s += ",\"scaleApplied\":" + num(exp.scaleApplied);
        s += ",\"seconds\":" + num(exp.seconds);
        s += "," + jsonDiagnostics(exp.diagnostics, exp.diagnosticsDropped);
        emit(s);
    }

    if (!exp.ok || !roundtrip) {
        forge::exchange::release(imp.handle);
        return 0;
    }

    // ── the re-import: the half that actually measures fidelity ─────────────
    // It runs with THE SAME options as the first import, because a comparison
    // between a body read one way and a body read another way measures the
    // options, not the file.
    std::string head2;
    std::uint64_t size2 = 0;
    forge::exchange::ImportRequest rreq = req;
    rreq.path = outPath;
    if (readHead(outPath, head2, size2)) {
        rreq.format = toKernelFormat(forge::ui::sniffFormat(outPath, head2, size2).format);
    } else {
        rreq.format = toKernelFormat(eopts.format);
    }
    // The units scale belongs to the FILE, and the file we just wrote is already
    // in the document's unit. Applying it twice would be a measurement of our own
    // arithmetic.
    rreq.scale = 1.0;

    const forge::exchange::ImportResult re = forge::exchange::importFile(rreq);
    {
        std::string s = "\"stage\":\"reimport\",\"id\":\"" + esc(id) + "\"";
        s += ",\"ok\":";
        s += re.ok ? "true" : "false";
        s += ",\"error\":\"" + esc(re.error) + "\"";
        s += ",\"fileBytes\":" + std::to_string(re.fileBytes);
        s += ",\"seconds\":" + num(re.seconds);
        s += "," + jsonObserved(re.observed);
        s += "," + jsonDiagnostics(re.diagnostics, re.diagnosticsDropped);
        emit(s);
    }

    {
        const forge::ui::LossVector L =
            forge::ui::compareObservables(toUi(imp.observed), toUi(re.observed));
        std::string s = "\"stage\":\"loss\",\"id\":\"" + esc(id) + "\"";
        s += ",\"comparable\":";
        s += L.comparable ? "true" : "false";
        s += ",\"withinTolerance\":";
        s += L.withinTolerance ? "true" : "false";
        s += ",\"volumeRel\":" + num(L.volumeRel);
        s += ",\"areaRel\":" + num(L.areaRel);
        s += ",\"comDistRel\":" + num(L.comDistRel);
        s += ",\"bboxRel\":" + num(L.bboxRel);
        s += ",\"bboxMaxAbsDelta\":" + num(L.bboxMaxAbsDelta);
        s += ",\"faceDelta\":" + std::to_string(L.faceDelta);
        s += ",\"edgeDelta\":" + std::to_string(L.edgeDelta);
        s += ",\"vertexDelta\":" + std::to_string(L.vertexDelta);
        s += ",\"genusDelta\":" + std::to_string(L.genusDelta);
        s += ",\"shellDelta\":" + std::to_string(L.shellDelta);
        s += ",\"validityLost\":";
        s += L.validityLost ? "true" : "false";
        s += ",\"violations\":[";
        for (std::size_t i = 0; i < L.violations.size(); ++i) {
            if (i) s += ",";
            s += "\"" + esc(L.violations[i]) + "\"";
        }
        s += "]";
        emit(s);
    }

    forge::exchange::release(re.handle);
    forge::exchange::release(imp.handle);
    return 0;
}
