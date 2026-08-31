#pragma once

// ExchangeService — OPTIONS-DRIVEN import / export, with diagnostics.
//
// forge/IoExchange.hpp is the raw codec layer: importStep(path) -> handle, and
// every decision about units, healing, tolerance and what to do with a body that
// is not quite right is somebody else's problem. This is that somebody. It is
// the kernel half of the application's Import/Export feature, and its contract
// is the one forge::ui::ExchangeModel describes:
//
//   * The CALLER decides the format. There is exactly one format sniffer in this
//     system and it lives in forge::ui::sniffFormat, which is compiled and
//     asserted under CI. A second sniff here would be a second answer to one
//     question, and the one that drifts is always the one with fewer users. A
//     request that arrives with Format::Unknown is answered with a NAMED error,
//     not a guess.
//
//   * ★ TOLERATE, DO NOT REFUSE. A body with degenerate faces IMPORTS, with
//     every bad face NAMED in the diagnostics so a repair loop can act on it.
//     `ok` means A BODY EXISTS, never "nothing went wrong". The one thing that
//     makes ok=false is that there is no body at all.
//
//   * Every measurement is a VECTOR. Volume cannot validate geometry — this
//     programme has four measured cases of a wrong solid reproducing a right
//     volume, and one where no single observable caught it. So `Observed`
//     carries mass properties, the B-rep census AND the tessellated topology,
//     and a caller comparing two bodies compares all of them.
//
// ── WHY THIS HEADER REACHES NO OCCT ─────────────────────────────────────────
// forge-desktop has exactly one file that may include an OCCT or forge-kernel
// geometry header (KernelScene.cpp); everything else must stay compilable
// without a kernel, which is what keeps the headless frame gate hermetic. So
// this header uses a plain uint32 handle and its own small structs, and the OCCT
// includes live in ExchangeService.cpp alone. A forge-desktop translation unit
// can include this file.

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace forge::exchange {

// The same uint32 ShapeRegistry issues. Spelled locally so this header does not
// have to include ShapeRegistry.hpp, which reaches TopoDS_Shape.hxx.
using Handle = std::uint32_t;
inline constexpr Handle kNoHandle = 0;

// The formats this service moves. It is deliberately SHORTER than
// forge::ui::ExchangeFormat: the ones missing from here are the ones this build
// cannot read or write at all, and their explanations belong in the capability
// table the UI shows, not in a switch that would have to throw.
enum class Format : std::uint8_t { Unknown = 0, Step, Iges, Brep, Stl, Obj };
const char* toString(Format f) noexcept;
Format formatFromString(const std::string& s) noexcept;

// 0 = info, 1 = warning, 2 = error — the same three levels as
// forge::ui::Severity, in the same order, so the adapter is a cast and not a
// mapping table that can be got wrong.
struct Diagnostic {
    int severity = 0;
    std::string code;
    std::string message;
    std::string entity;  // "face#12", "edge#7", "" when about the file
};

// The observable VECTOR. Every field is independently defended: a measurement
// that throws leaves its own field at the "not measured" sentinel and does not
// take the others with it.
struct Observed {
    bool measured = false;  // at least the mass properties came back
    bool valid = false;     // closed AND manifold AND oriented
    bool closed = false;
    bool manifold = false;
    bool oriented = false;
    double volume = 0.0;
    double area = 0.0;
    double com[3] = {0.0, 0.0, 0.0};
    double bboxMin[3] = {0.0, 0.0, 0.0};
    double bboxMax[3] = {0.0, 0.0, 0.0};
    // B-rep census (TopExp over the shape), -1 when it could not be taken.
    long solidCount = -1;
    long shellCount = -1;
    long faceCount = -1;
    long edgeCount = -1;
    long vertexCount = -1;
    // Tessellated weld-betti topology, -1 when the body could not be meshed.
    long genus = -1;
    long meshShellCount = -1;
    long meshVertexCount = -1;
};

struct ImportRequest {
    std::string path;
    // ★ REQUIRED. Unknown is answered with an error naming the caller's omission,
    // never with a guess — see the header note on the single sniffer.
    Format format = Format::Unknown;

    // The units factor, already computed by forge::ui::importScaleFactor. 1.0
    // means "the file's own unit is the document's".
    double scale = 1.0;

    // The healing plan, already resolved by forge::ui::resolveHealing. These are
    // NOT a policy — the policy was applied before this struct was filled in.
    bool sew = false;
    bool harmoniseNormals = false;
    bool unifyCoplanarFaces = false;
    bool fillMissingFaces = false;
    bool repairSelfIntersections = false;
    double tolerance = 1e-3;

    // ★ THE TOLERATE SWITCH. With it true (the default) a body whose validity
    // check reports bad faces is still handed back, with those faces named.
    bool tolerateDegenerate = true;

    bool measure = true;         // take the observable vector after importing
    std::size_t maxDiagnostics = 256;  // 0 = unlimited
};

struct ImportResult {
    bool ok = false;             // A BODY EXISTS. Not "nothing went wrong".
    Handle handle = kNoHandle;
    Format format = Format::Unknown;
    std::uint64_t fileBytes = 0;
    double scaleApplied = 1.0;
    Observed observed;
    std::vector<Diagnostic> diagnostics;
    std::size_t diagnosticsDropped = 0;  // suppressed by maxDiagnostics
    std::string error;                   // non-empty exactly when !ok
    double seconds = 0.0;
};

struct ExportRequest {
    std::string path;
    Handle handle = kNoHandle;
    Format format = Format::Step;
    double scale = 1.0;  // forge::ui::exportScaleFactor
    bool preferAnalytic = true;
    bool ascii = true;
    double linearTolerance = 0.05;
    double angularTolerance = 0.08;
    std::size_t maxDiagnostics = 256;
};

struct ExportResult {
    bool ok = false;
    Format format = Format::Unknown;
    std::uint64_t fileBytes = 0;
    double scaleApplied = 1.0;
    bool analytic = false;  // real surfaces were written, not triangles
    std::vector<Diagnostic> diagnostics;
    std::size_t diagnosticsDropped = 0;
    std::string error;
    double seconds = 0.0;
};

// Never throws. Every failure comes back as ok=false with a named `error`, and
// every survivable defect as a diagnostic on an ok=true result.
ImportResult importFile(const ImportRequest& req);
ExportResult exportFile(const ExportRequest& req);

// Measure an existing body. Exposed because the round-trip experiment measures
// the SAME handle before and after a write, and because a caller that already
// has geometry should not have to write it to a file to describe it.
Observed measure(Handle h);

// Drop a handle obtained from importFile(). A no-op on kNoHandle.
void release(Handle h);

// ── STL / OBJ export for an OCCT-BACKED body ────────────────────────────────
// forge::io::exportStl THROWS on an OCCT-backed handle ("no native tessellation
// exists for an arbitrary OCCT shape"), and EVERY imported foreign STEP is
// OCCT-backed — so "import a STEP, export an STL" was unreachable, which is the
// single most common thing a user does with a CAD exchange feature. This service
// closes that by tessellating the OCCT body with the SAME tessellator the STEP
// faceted-export route already uses and serialising the soup, and it SAYS in a
// diagnostic that the result is a tessellation. That is removing an impediment,
// not lowering a bar: the alternative on offer was an exception.
//
// exportFile() takes that route automatically; this is named here because it is
// a capability claim and a reader should be able to find the sentence that makes
// it.

}  // namespace forge::exchange
