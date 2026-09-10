// ui/test/face_signature_test.cpp
//
// A FACE REFERENCE MUST SURVIVE AN EDIT THAT RENUMBERS FACES.
//
// EntityRef::persistentName is "face@<index>", and its own header comment used to
// claim it "survives index permutation". It does not, and that claim is very likely
// why nobody went looking. MEASURED against the kernel before this change: the same
// conceptual face is "cylinder face 6" before an earlier HOLE is inserted and
// "cylinder face 7" after; the face count goes 6 -> 7 -> 8 as holes are added.
// doc 04 calls exactly this the major product risk in a feature modeller.
//
// The fix is additive: EntityRef gains a `signature` derived from the face's own
// geometry, and resolution prefers it. persistentName, the .fpart TARGETNAME key
// and every gate asserting "face@N" are untouched.
//
// This test PERMUTES THE IDS ON PURPOSE -- identical geometry, different face
// numbers -- because that is the whole failure mode, and a fixture that never
// renumbers cannot tell a durable identity from a lucky one.
#include "forge/ui/MeasureModel.hpp"
#include "forge/ui/CameraModel.hpp"
#include "forge/ui/PickModel.hpp"
#include "forge/ui/Types.hpp"

#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::ui;

namespace {

int g_pass = 0;
int g_fail = 0;

void check(bool ok, const std::string& what, const std::string& detail = "") {
  std::printf("  %s  %s%s%s\n", ok ? "PASS" : "FAIL", what.c_str(),
              detail.empty() ? "" : " -- ", detail.c_str());
  ok ? ++g_pass : ++g_fail;
}

void quad(MeasureMesh& m, const double o[3], const double u[3], const double v[3],
          std::uint32_t faceId) {
  const double a[3] = {o[0], o[1], o[2]};
  const double b[3] = {o[0] + u[0], o[1] + u[1], o[2] + u[2]};
  const double c[3] = {o[0] + u[0] + v[0], o[1] + u[1] + v[1], o[2] + u[2] + v[2]};
  const double d[3] = {o[0] + v[0], o[1] + v[1], o[2] + v[2]};
  m.addTriangle(a, b, c, faceId);
  m.addTriangle(a, c, d, faceId);
}

// A box-like soup of six distinct quads. `ids` chooses the face numbering, which is
// the only thing that differs between the two meshes below.
MeasureMesh sixFaces(const std::vector<std::uint32_t>& ids) {
  MeasureMesh m;
  const double X[3] = {40, 0, 0}, Y[3] = {0, 25, 0}, Z[3] = {0, 0, 10};
  const double o0[3] = {0, 0, 0};
  const double oZ[3] = {0, 0, 10};
  const double oY[3] = {0, 25, 0};
  const double oX[3] = {40, 0, 0};
  quad(m, o0, X, Y, ids[0]);   // bottom
  quad(m, oZ, X, Y, ids[1]);   // top
  quad(m, o0, X, Z, ids[2]);   // front
  quad(m, oY, X, Z, ids[3]);   // back
  quad(m, o0, Y, Z, ids[4]);   // left
  quad(m, oX, Y, Z, ids[5]);   // right
  return m;
}

}  // namespace

int main() {
  std::printf("== a signature is produced, and it is not an index ==\n");
  const MeasureMesh before = sixFaces({1, 2, 3, 4, 5, 6});
  const std::string sigTop = faceSignature(before, 2);
  check(!sigTop.empty(), "faceSignature returns a signature for a known face", sigTop);
  check(sigTop.find("face@") == std::string::npos, "and it embeds no face index");
  check(faceSignature(before, 999).empty(), "an unknown face yields an empty signature");

  std::printf("== THE PERMUTATION: same geometry, every id shifted by one ==\n");
  // Exactly the shape of inserting an earlier feature: the top face was 2, now 3.
  const MeasureMesh after = sixFaces({2, 3, 4, 5, 6, 7});
  check(faceSignature(after, 3) == sigTop,
        "the SAME face carries the SAME signature under a different id");

  std::uint32_t resolved = 0;
  const SignatureMatch m = resolveFaceSignature(after, sigTop, resolved);
  check(m == SignatureMatch::Exact, "the signature resolves on the renumbered mesh");
  check(resolved == 3, "and it resolves to the NEW id",
        "got " + std::to_string(resolved) + ", want 3");

  std::printf("== RED-THEN-GREEN: the index form gets it WRONG on the same mesh ==\n");
  std::printf("   (without this the pass above could just mean nothing moved)\n");
  std::uint32_t byIndex = 0;
  check(faceIdFromKey("face@2", byIndex), "the old form still parses");
  check(byIndex == 2, "and still yields 2");
  check(byIndex != resolved,
        "the index now names a DIFFERENT face than the signature does",
        "index=" + std::to_string(byIndex) + " signature=" + std::to_string(resolved));
  check(faceSignature(after, byIndex) != sigTop,
        "and face@2 on the new mesh is genuinely not the face that was tagged");

  std::printf("== ambiguity is REPORTED, never guessed ==\n");
  // Two faces with identical geometry: coincident duplicates of the same quad.
  MeasureMesh twins;
  const double X[3] = {10, 0, 0}, Y[3] = {0, 10, 0};
  const double o[3] = {0, 0, 0};
  quad(twins, o, X, Y, 1);
  quad(twins, o, X, Y, 2);  // same place, same size, same normal
  const std::string dup = faceSignature(twins, 1);
  check(faceSignature(twins, 2) == dup, "two identical faces DO collide by construction");
  std::uint32_t amb = 0;
  check(resolveFaceSignature(twins, dup, amb) == SignatureMatch::Ambiguous,
        "and the collision is reported as Ambiguous, not resolved to the first hit");

  std::printf("== a signature absent or unknown is Missing, not a wrong answer ==\n");
  std::uint32_t none = 0;
  check(resolveFaceSignature(after, "", none) == SignatureMatch::Missing,
        "an empty signature is Missing");
  check(resolveFaceSignature(after, "fsig1:plane:a999:c0,0,0:n0,0,1", none) ==
            SignatureMatch::Missing,
        "a signature matching nothing is Missing");

  std::printf("== sparse face ids are not silently skipped ==\n");
  // A first version of resolveFaceSignature looped 1..faceCount, assuming dense ids.
  const MeasureMesh sparse = sixFaces({1, 5, 9, 13, 17, 21});
  const std::string sigSparse = faceSignature(sparse, 17);
  std::uint32_t sp = 0;
  check(resolveFaceSignature(sparse, sigSparse, sp) == SignatureMatch::Exact,
        "a face with a high, sparse id still resolves");
  check(sp == 17, "and to the right id", "got " + std::to_string(sp));

  std::printf("\nRESULT: %d passed, %d failed\n", g_pass, g_fail);
  return g_fail == 0 ? 0 : 1;
}
