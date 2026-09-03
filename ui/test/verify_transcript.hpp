// ui/test/verify_transcript.hpp
//
// THE READER FOR forge_verify's TRANSCRIPT -- and it lives here, kernel-free, so
// it can be GATED without one.
//
// forge-desktop/test/differential_solid_gate.cpp runs the forge_verify BINARY as
// its fourth arm: a separate artifact, driven over the stdin protocol, because
// the other three arms are three entry points inside one process and the defect
// class this whole gate is named for is TWO ARTIFACTS built from one source.
//
// That arm's riskiest part is not the subprocess. It is this: a reader that
// silently fails to find a field reports the arm's default and the comparison
// then measures nothing, or measures a zero against a real number and goes red
// for a reason that has nothing to do with geometry. And the reader could only be
// exercised in the macOS `kernel` job, behind an OCCT build, which is the slowest
// possible place to discover a parsing mistake.
//
// So it is pure string handling with no kernel dependency, and
// ui/test/differential_gate_test.cpp checks it on every PR against a REAL
// forge_verify line -- captured verbatim from the pinned native verifier, not
// written from memory of what the protocol looks like. That distinction matters
// here: the captured line carries `"bodies"`, `"vertexCount"` and a `"bores"`
// array holding its own `"cx"`, `"at"` and `"axis"` values, none of which appear
// in the protocol comment at the top of forge_verify.cpp.
//
// Deliberately NOT a JSON library: the verifier itself refuses to acquire a
// dependency to write this protocol, and its reader has no better excuse.
#ifndef FORGE_UI_TEST_VERIFY_TRANSCRIPT_HPP
#define FORGE_UI_TEST_VERIFY_TRANSCRIPT_HPP

#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <string>

namespace forge {
namespace difftest {

// Every accessor reports FOUND separately from the value. A field this reader
// cannot find must not read as 0.0 and silently agree with an arm that measured
// zero -- a green produced by an absence is the shape of every gate in this
// programme that turned out to be measuring nothing.
inline bool jsonNumberField(const std::string& line, const std::string& key, double& out) {
  const std::string needle = "\"" + key + "\":";
  const std::size_t at = line.find(needle);
  if (at == std::string::npos) return false;
  const char* p = line.c_str() + at + needle.size();
  if (std::strncmp(p, "null", 4) == 0) return false;  // forge_verify's num() on a non-finite
  char* end = nullptr;
  const double v = std::strtod(p, &end);
  if (end == p) return false;
  out = v;
  return true;
}

inline bool jsonBoolField(const std::string& line, const std::string& key, bool& out) {
  const std::string needle = "\"" + key + "\":";
  const std::size_t at = line.find(needle);
  if (at == std::string::npos) return false;
  const char* p = line.c_str() + at + needle.size();
  if (std::strncmp(p, "true", 4) == 0) { out = true; return true; }
  if (std::strncmp(p, "false", 5) == 0) { out = false; return true; }
  return false;
}

// The three numbers of `"com":[x,y,z]`, or of a bbox corner.
inline bool jsonTripleField(const std::string& line, const std::string& key, double out[3]) {
  const std::string needle = "\"" + key + "\":[";
  const std::size_t at = line.find(needle);
  if (at == std::string::npos) return false;
  const char* p = line.c_str() + at + needle.size();
  for (int i = 0; i < 3; ++i) {
    char* end = nullptr;
    const double v = std::strtod(p, &end);
    if (end == p) return false;
    out[i] = v;
    p = end;
    while (*p == ',' || *p == ' ') ++p;
  }
  return true;
}

inline std::string jsonStringField(const std::string& line, const std::string& key) {
  const std::string needle = "\"" + key + "\":\"";
  const std::size_t at = line.find(needle);
  if (at == std::string::npos) return std::string();
  const std::size_t from = at + needle.size();
  const std::size_t to = line.find('"', from);
  if (to == std::string::npos) return std::string();
  return line.substr(from, to - from);
}

// One parsed record.
struct VerifierLine {
  std::string id;
  bool present = false;
  bool ok = false;
  bool valid = false;
  double volume = 0.0;
  double area = 0.0;
  bool hasArea = false;
  double com[3] = {0, 0, 0};
  bool hasCom = false;
  double bboxMin[3] = {0, 0, 0};
  double bboxMax[3] = {0, 0, 0};
  bool hasBbox = false;
  double faceCount = -1;
  double edgeCount = -1;
  double genus = -1;
  double shellCount = -1;
  bool hasTopo = false;
};

inline VerifierLine parseVerifierLine(const std::string& line) {
  VerifierLine v;
  v.present = true;
  v.id = jsonStringField(line, "id");
  jsonBoolField(line, "ok", v.ok);
  jsonBoolField(line, "valid", v.valid);
  jsonNumberField(line, "volume", v.volume);
  v.hasArea = jsonNumberField(line, "area", v.area);
  v.hasCom = jsonTripleField(line, "com", v.com);
  jsonNumberField(line, "faceCount", v.faceCount);
  jsonNumberField(line, "edgeCount", v.edgeCount);
  v.hasTopo = jsonNumberField(line, "genus", v.genus);
  jsonNumberField(line, "shellCount", v.shellCount);
  // The bbox corners are nested, and BOTH names are generic enough to collide:
  // the `bores` array that follows carries `"at"` and `"axis"` triples, and a
  // future field named "min" anywhere earlier in the line would be found first.
  // Anchoring on `"bbox":` and searching only the REMAINDER is what keeps this
  // reading the bounding box rather than whatever else happens to be spelled the
  // same way.
  const std::size_t bb = line.find("\"bbox\":");
  if (bb != std::string::npos) {
    const std::string tail = line.substr(bb);
    const bool lo = jsonTripleField(tail, "min", v.bboxMin);
    const bool hi = jsonTripleField(tail, "max", v.bboxMax);
    v.hasBbox = lo && hi;
  }
  return v;
}

// A REAL line, captured verbatim from the pinned native verifier on
// `%1 = BOX(40, 30, 20) / %2 = CYL(6, 40) / %3 = CUT(%1, %2)`. Kept as a fixture
// because the protocol comment in forge_verify.cpp does not list every field the
// tool actually writes, and a reader tested against the COMMENT would be tested
// against the wrong thing.
inline const char* capturedVerifierLine() {
  return
      "{\"id\":\"t1\",\"ok\":true,\"error\":\"\",\"failedOpId\":-1,\"verify\":[],"
      "\"valid\":true,\"volume\":21738.053289,\"faceCount\":7,\"edgeCount\":15,"
      "\"bodies\":1,\"exported\":false,"
      "\"bbox\":{\"min\":[-20,-15,0],\"max\":[20,15,20]},"
      "\"genus\":1,\"shellCount\":1,\"vertexCount\":40,"
      "\"bores\":[{\"cx\":0,\"cy\":0,\"r\":6,\"span\":20,\"at\":[0,0,0],"
      "\"axis\":[0,0,1],\"faces\":1}]}";
}

// The same shape with the two fields this change ADDED to the tool, so the arm
// that requires them is exercised against a line that has them.
inline const char* capturedVerifierLineWithMassProps() {
  return
      "{\"id\":\"t1\",\"ok\":true,\"error\":\"\",\"failedOpId\":-1,\"verify\":[],"
      "\"valid\":true,\"volume\":21738.053289,\"faceCount\":7,\"edgeCount\":15,"
      "\"bodies\":1,\"exported\":false,"
      "\"bbox\":{\"min\":[-20,-15,0],\"max\":[20,15,20]},"
      "\"area\":6209.734156,\"com\":[-0.5,0.25,9.875],"
      "\"genus\":1,\"shellCount\":1,\"vertexCount\":40,"
      "\"bores\":[{\"cx\":0,\"cy\":0,\"r\":6,\"span\":20,\"at\":[0,0,0],"
      "\"axis\":[0,0,1],\"faces\":1}]}";
}

}  // namespace difftest
}  // namespace forge

#endif  // FORGE_UI_TEST_VERIFY_TRANSCRIPT_HPP
